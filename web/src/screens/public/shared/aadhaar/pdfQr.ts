import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { decodeQrImage } from './qrDecoder';

/**
 * "Aadhaar: open e-Aadhaar PDF" — the PDF is opened with pdf.js in this
 * browser tab, with the password he types (UIDAI's e-Aadhaar password: the
 * first 4 letters of the name in capitals and the year of birth). The page is
 * drawn on a canvas in memory and the QR on it is read; only the QR's text
 * leaves the phone. The PDF itself is never uploaded.
 */
export type PdfQrResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'password_needed' | 'password_wrong' | 'no_qr' | 'not_pdf' };

const MAX_PAGES = 2;
const SCALE = 3;

export async function readQrFromPdf(data: ArrayBuffer, password: string): Promise<PdfQrResult> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(data), password: password || undefined });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    const e = error as { name?: string; code?: number };
    if (e?.name === 'PasswordException') {
      return { ok: false, reason: e.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'password_wrong' : 'password_needed' };
    }
    return { ok: false, reason: 'not_pdf' };
  }
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      // The whole page first, then each quarter (the QR is in one corner of the e-Aadhaar).
      const regions: Array<[number, number, number, number]> = [[0, 0, canvas.width, canvas.height]];
      const hw = Math.ceil(canvas.width / 2);
      const hh = Math.ceil(canvas.height / 2);
      for (const [x, y] of [[0, 0], [hw, 0], [0, hh], [hw, hh]] as const) regions.push([x, y, Math.min(hw, canvas.width - x), Math.min(hh, canvas.height - y)]);
      for (const [x, y, w, h] of regions) {
        const text = await decodeQrImage(ctx.getImageData(x, y, w, h));
        if (text) return { ok: true, text };
      }
      canvas.width = 0;
      canvas.height = 0;
    }
    return { ok: false, reason: 'no_qr' };
  } finally {
    // Nothing of the PDF is kept: the document and its worker are closed.
    await task.destroy().catch(() => undefined);
  }
}
