// CEP exposes window.cep.fs.showOpenDialogEx. In jsdom tests this won't exist;
// callers should feature-detect.

export function pickFilesFromDisk({ multi, accept }) {
  const cep = window.cep;
  if (!cep || !cep.fs || !cep.fs.showOpenDialogEx) {
    return Promise.reject(new Error('cep.fs.showOpenDialogEx unavailable'));
  }
  // Per Adobe CEP docs: showOpenDialogEx(allowMultipleSelection, chooseDirectory, title, initialPath, fileTypes)
  const res = cep.fs.showOpenDialogEx(!!multi, false, 'Pick file', '', accept || []);
  if (res.err !== 0) return Promise.reject(new Error(`dialog err ${res.err}`));
  return Promise.resolve(res.data || []);
}

export async function readFileAsBlob(path) {
  // Use Node fs via the CEP node-enabled context.
  const fs = require('fs');
  const buf = fs.readFileSync(path);
  const ext = path.split('.').pop().toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    ext === 'png' ? 'image/png' :
    ext === 'mp4' ? 'video/mp4' :
    ext === 'mov' ? 'video/quicktime' :
    ext === 'wav' || ext === 'mp3' ? `audio/${ext === 'mp3' ? 'mpeg' : 'wav'}` :
    'application/octet-stream';
  return new Blob([buf], { type: mime });
}

export async function makeThumbDataURL(blob, max = 64) {
  if (!blob.type.startsWith('image/')) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const ratio = Math.min(max / img.width, max / img.height, 1);
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.6);
  } finally { URL.revokeObjectURL(url); }
}
