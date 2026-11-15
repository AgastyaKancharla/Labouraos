import Constants from 'expo-constants';
import { prepareZXingModule } from 'barcode-detector/ponyfill';

/**
 * In the installed web app expo-camera reads QR codes with the browser's
 * BarcodeDetector, or — on iPhones and other browsers without one — with
 * zxing-cpp compiled to WebAssembly (the `barcode-detector` polyfill). That
 * file would come from a public CDN by default; scripts/pwa.js copies it into
 * both web builds instead, so it is served from Laboura's own address, under
 * the build's base path (/field/ or / on field.laboura.com).
 */
export const ZXING_WASM_FILE = 'zxing_reader.wasm';

/** "/field" → "/field/"; no base (the root build) → "/". */
export function qrDecoderBase(baseUrl: string | null | undefined): string {
  const trimmed = String(baseUrl ?? '').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

let prepared = false;

export function prepareQrDecoder(): void {
  if (prepared) return;
  prepared = true;
  const base = qrDecoderBase((Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl);
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `${base}${ZXING_WASM_FILE}` : prefix + path) },
  });
}
