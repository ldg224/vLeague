// Trophy pictures (0.66): 400 x 400 PNGs in the public `trophies` bucket, uploaded by the office in Editor -> History.
//   uploadTrophy(file) -> the new path in the bucket
// A 400 x 400 PNG goes up exactly as it is. Anything else is fitted inside 400 x 400 on a transparent background (never
// stretched or cropped) and saved as PNG. Each upload gets a new file name, so a picture already in use never changes.
import { db } from './auth.js';

export const TROPHY_SIZE = 400;
const MAX_BYTES = 1024 * 1024;   // the bucket's limit (0050_league_history.sql)

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a picture we can read. Use a PNG.')); };
    img.src = url;
  });
}

async function prepare(file) {
  if (!file) throw new Error('Choose a picture first.');
  if (!/^image\//.test(file.type)) throw new Error('That file isn’t a picture. Use a PNG.');
  const img = await loadImage(file), w = img.naturalWidth, h = img.naturalHeight;
  if (file.type === 'image/png' && w === TROPHY_SIZE && h === TROPHY_SIZE && file.size <= MAX_BYTES) return file;
  const cv = document.createElement('canvas'); cv.width = cv.height = TROPHY_SIZE;
  const s = Math.min(TROPHY_SIZE / w, TROPHY_SIZE / h), dw = Math.round(w * s), dh = Math.round(h * s);
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, Math.round((TROPHY_SIZE - dw) / 2), Math.round((TROPHY_SIZE - dh) / 2), dw, dh);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if (!blob || blob.size > MAX_BYTES) throw new Error('That picture is too big. Use a 400 × 400 PNG under 1 MB.');
  return blob;
}

export async function uploadTrophy(file) {
  const blob = await prepare(file);
  const path = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
  const { error } = await (await db()).storage.from('trophies').upload(path, blob, { contentType: 'image/png', upsert: false, cacheControl: '31536000' });
  if (error) throw new Error('The picture didn’t upload. Try again.');
  return path;
}
