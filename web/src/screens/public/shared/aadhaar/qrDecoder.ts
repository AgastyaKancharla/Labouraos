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

/** The QR's text, or null when there is no readable QR in the picture. */
export async function decodeQrImage(image: ImageData): Promise<string | null> {
  const detector = await nativeDetector();
  if (detector) {
    try {
      const found = await detector.detect(image);
      const text = found.find((code) => code.rawValue)?.rawValue;
      if (text) return text;
    } catch {
      // fall through to zxing
    }
  }
  const reader = await loadZxing();
  const results = await reader.readBarcodes(image, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
  return results.find((result) => result.isValid && result.text)?.text ?? null;
}

/** Only for tests: forget the cached detectors. */
export function resetQrDecoderForTests(): void {
  zxing = null;
  native = null;
}
