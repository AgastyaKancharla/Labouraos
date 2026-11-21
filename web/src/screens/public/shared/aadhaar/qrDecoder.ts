import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/**
 * Reads a QR code from a picture, entirely in the browser (guide, 14 Nov: the
 * Aadhaar QR is read on the phone and only its text is sent).
 *
 * The Aadhaar Secure QR is very dense (a few thousand digits), so it uses
 * zxing-cpp compiled to WebAssembly (`zxing-wasm`) with "try harder", served
 * from this site (never a CDN). Where the browser has its own
 * BarcodeDetector (Android Chrome) that is tried first; zxing is the fallback.
 */
type ZxingReader = typeof import('zxing-wasm/reader');

let zxing: Promise<ZxingReader> | null = null;

function loadZxing(): Promise<ZxingReader> {
  if (!zxing) {
    zxing = import('zxing-wasm/reader').then((module) => {
      module.prepareZXingModule({
        overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path) },
      });
      return module;
    });
  }
  return zxing;
}

interface NativeDetector {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

let native: Promise<NativeDetector | null> | null = null;

function nativeDetector(): Promise<NativeDetector | null> {
  if (!native) {
    native = (async () => {
      const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
      if (!Detector) return null;
      try {
        const formats = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : ['qr_code'];
        return formats.includes('qr_code') ? new Detector({ formats: ['qr_code'] }) : null;
      } catch {
        return null;
      }
    })();
  }
  return native;
}

/**
 * 22 Nov (owner testing): which QR to send when the camera sees more than one (a UPI or shop QR next
 * to the card, the small QR on the back of a PVC card): the Aadhaar Secure QR first — one long run of
 * digits (thousands of them; UIDAI's sample has 3,181) — then an old XML Aadhaar QR (the server answers
 * with its own "older card" message), then anything else (the server answers "Couldn't read this QR").
 * The server checks UIDAI's signature on every code whatever is picked here.
 */
export const SECURE_QR_MIN_DIGITS = 500;

export function pickAadhaarQrText(texts: ReadonlyArray<string | null | undefined>): string | null {
  const found = texts.map((t) => (t ?? '').trim()).filter(Boolean);
  const secure = found.filter((t) => /^\d+$/.test(t) && t.length >= SECURE_QR_MIN_DIGITS).sort((a, b) => b.length - a.length)[0];
  if (secure) return secure;
  const oldXml = found.find((t) => /^(<\?xml|<PrintLetterBarcodeData|<QPDB|<QDA)/i.test(t));
  return oldXml ?? found[0] ?? null;
}

/** The QR's text, or null when there is no readable QR in the picture. */
export async function decodeQrImage(image: ImageData): Promise<string | null> {
  const detector = await nativeDetector();
  if (detector) {
    try {
      const found = await detector.detect(image);
      const text = pickAadhaarQrText(found.map((code) => code.rawValue));
      // A Secure QR from the phone's own detector is used at once; otherwise zxing looks too.
      if (text && /^\d+$/.test(text) && text.length >= SECURE_QR_MIN_DIGITS) return text;
      if (text) {
        const reader = await loadZxing();
        const results = await reader.readBarcodes(image, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 4 });
        return pickAadhaarQrText([text, ...results.filter((r) => r.isValid).map((r) => r.text)]);
      }
    } catch {
      // fall through to zxing
    }
  }
  const reader = await loadZxing();
  const results = await reader.readBarcodes(image, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 4 });
  return pickAadhaarQrText(results.filter((result) => result.isValid).map((result) => result.text));
}

/** Only for tests: forget the cached detectors. */
export function resetQrDecoderForTests(): void {
  zxing = null;
  native = null;
}
