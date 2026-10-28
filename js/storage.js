const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// 压缩参数：长边不超过 1600px，JPEG 质量 0.82
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const SKIP_BYTES = 700 * 1024;

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
  })[file.type];
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
 * 上传前压缩图片：长边缩到 1600px 以内，JPEG 走 0.82 质量。
 * GIF 保持原样（保住动画），小图也直接放过。
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

    // 本来就不大，直接传原图
    if (scale === 1 && file.size <= SKIP_BYTES) {
      bitmap.close?.();
      return file;
    }

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');

    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    // PNG 截图保留 PNG，避免文字发糊
    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await toBlob(canvas, outputType, JPEG_QUALITY);

    if (!blob || blob.size >= file.size) {
      return file;
    }

    const extension = outputType === 'image/png' ? 'png' : 'jpg';

    return new File([blob], outputName(file, extension), {
      type: outputType,
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
