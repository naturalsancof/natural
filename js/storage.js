const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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
      message: '图片不能超过 5 MB。'
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
