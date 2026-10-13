import { saveImageBlob } from './imageStore';
const MAX_SIDE = 2400;
const MAX_BYTES = 3 * 1024 * 1024;
export async function storeUploadedWallpaper(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件。');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片无法读取，请换一张试试。')); image.src = url;
    });
    let blob: Blob = file;
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale < 1 || file.size > MAX_BYTES) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('图片无法压缩，请换一张较小的图片。');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片压缩失败。')), 'image/jpeg', 0.85));
    }
    if (blob.size > MAX_BYTES) throw new Error('图片压缩后仍超过 3 MB，请换一张较小的图片。');
    return await saveImageBlob(blob, 'wallpaper');
  } finally { URL.revokeObjectURL(url); }
}
