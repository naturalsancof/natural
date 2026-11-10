const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// 压缩参数：长边 1280px，优先输出 WebP
const MAX_EDGE = 1280;
const TARGET_BYTES = 260 * 1024;

// 普通照片 / 文字截图各自的质量阶梯（不够小就往下走一档）
const QUALITY_STEPS = {
  photo: [0.72, 0.62, 0.52],
  text: [0.82, 0.72, 0.62]
};

export function validateImage(file) {
  if (!file) {
    return {
      valid: true,
      message: ''
    };
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return {
      valid: false,
      message: '请选择 JPEG、PNG、WebP 或 GIF 图片。'
    };
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return {
      valid: false,
      message: '图片不能超过 10 MB。'
    };
  }

  return {
    valid: true,
    message: ''
  };
}

function extensionFor(file) {
  return ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  })[file.type] || 'jpg';
}

function outputName(file, extension) {
  const base = (file.name || 'image').replace(/\.[^.]+$/, '');

  return `${base}.${extension}`;
}

function toBlob(canvas, type, quality) {
  return new Promise(resolve => {
    canvas.toBlob(resolve, type, quality);
  });
}

/**
 * 上传前压缩：长边 1280px，输出 WebP，单张尽量压到 260KB 以内。
 * GIF 保持原样（保住动画）；压完反而更大就用原图。
 */
export async function compressImage(file) {
  if (!file || !file.type) {
    return file;
  }

  // GIF 动图不压缩，避免掉帧
  if (file.type === 'image/gif') {
    return file;
  }

  if (typeof createImageBitmap !== 'function') {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');

    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    // PNG 多为截图，文字需要高一点的质量
    const steps = file.type === 'image/png'
      ? QUALITY_STEPS.text
      : QUALITY_STEPS.photo;

    let blob = null;

    for (const quality of steps) {
      const webp = await toBlob(canvas, 'image/webp', quality);

      // 个别浏览器给不出 WebP 时会退回 PNG，这时改用 JPEG
      const candidate = webp && webp.type === 'image/webp'
        ? webp
        : await toBlob(canvas, 'image/jpeg', quality);

      if (!candidate) {
        continue;
      }

      blob = candidate;

      if (candidate.size <= TARGET_BYTES) {
        break;
      }
    }

    if (!blob || blob.size >= file.size) {
      return file;
    }

    const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';

    return new File([blob], outputName(file, extension), {
      type: blob.type,
      lastModified: Date.now()
    });
  } catch (error) {
    console.warn('图片压缩失败，使用原图：', error);
    return file;
  }
}

export async function uploadImage(client, file) {
  const validation = validateImage(file);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const path = `images/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extensionFor(file)}`;

  const { data, error } = await client.storage
    .from('notes')
    .upload(path, file, {
      cacheControl: '31536000',
      contentType: file.type,
      upsert: false
    });

  if (error) {
    throw error;
  }

  return client.storage
    .from('notes')
    .getPublicUrl(data.path)
    .data
    .publicUrl;
}
