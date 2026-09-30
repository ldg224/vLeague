// Club crests: turn any picture into a 512 px square PNG (or WebP if the PNG is too big) and upload it.
//   prepareCrest(file) -> { blob, url, type }  (url is an object URL for previews; throws with a readable message)
//   uploadCrest(blob, code) -> the new path in the crests bucket, '<code lower case>/crest-<time>.png|webp'
// The picture is fitted inside the square on a transparent background, never cropped. Each upload gets a new file
// name, so the live crest is never overwritten (a new crest only goes live when the office approves it).
import { db } from './auth.js';

export const CREST_SIZE = 512;
export const CREST_MAX_BYTES = 500 * 1024;
const INPUT_MAX_BYTES = 20 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a picture we can read. Try a PNG or JPG.')); };
    img.src = url;
  });
}

const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));

export async function prepareCrest(file) {
  if (!file) throw new Error('Choose a picture first.');
  if (!/^image\//.test(file.type)) throw new Error('That file isn’t a picture. Use a PNG, JPG or WebP.');
  if (file.size > INPUT_MAX_BYTES) throw new Error('That picture is over 20 MB. Choose a smaller one.');
  const { img, url } = await loadImage(file);
  try {
    const w = img.naturalWidth || CREST_SIZE, h = img.naturalHeight || CREST_SIZE;
    if (Math.min(w, h) < 64) throw new Error('That picture is too small. Use one at least 256 px across.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CREST_SIZE;
    const ctx = canvas.getContext('2d');
    const scale = CREST_SIZE / Math.max(w, h);
    const dw = w * scale, dh = h * scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (CREST_SIZE - dw) / 2, (CREST_SIZE - dh) / 2, dw, dh);
    let blob = await toBlob(canvas, 'image/png');
    for (const q of [0.92, 0.85, 0.75]) {
      if (blob && blob.size <= CREST_MAX_BYTES) break;
      const webp = await toBlob(canvas, 'image/webp', q);
      if (webp?.type === 'image/webp') blob = webp;
    }
    if (!blob || blob.size > CREST_MAX_BYTES) throw new Error('That picture is too detailed to fit in 500 KB. Try a simpler version.');
    return { blob, url: URL.createObjectURL(blob), type: blob.type };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadCrest(blob, code) {
  const ext = blob.type === 'image/webp' ? 'webp' : 'png';
  const path = `${String(code).toLowerCase()}/crest-${Date.now()}.${ext}`;
  const { error } = await (await db()).storage.from('crests').upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
  if (error) throw new Error(/row-level|policy|unauthori/i.test(error.message || '') ? 'You can only upload a crest for your own club.' : 'The crest didn’t upload. Check your connection and try again.');
  return path;
}
