/** 图：最长边 2048、JPEG 0.85（对齐 App）。GIF 原样保留。 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file);
  const max = 2048;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) return file;
  const name = file.name.replace(/\.\w+$/, '.jpg');
  return new File([blob], name, { type: 'image/jpeg' });
}
