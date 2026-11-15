import { readFileSync } from 'node:fs';
import qrcode from 'qrcode-generator';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { beforeAll, describe, expect, it } from 'vitest';
import { UIDAI_SAMPLE_SECURE_QR } from './testing/uidaiSampleQr';

/**
 * A real decode, no mocks: UIDAI's own sample Secure QR text (3,181 digits) is
 * drawn as a QR code exactly as dense as the one on an Aadhaar card, and the
 * browser decoder library the pages use (zxing-cpp as WebAssembly, `zxing-wasm`)
 * must read it back digit for digit.
 */
function render(text: string, ecc: 'L' | 'M' | 'Q', moduleSize: number, rotate = false) {
  const qr = qrcode(0, ecc);
  qr.addData(text, 'Numeric');
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const side = (count + quiet * 2) * moduleSize;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (!qr.isDark(r, c)) continue;
      for (let y = 0; y < moduleSize; y += 1) {
        for (let x = 0; x < moduleSize; x += 1) {
          let px = (c + quiet) * moduleSize + x;
          let py = (r + quiet) * moduleSize + y;
          if (rotate) [px, py] = [side - 1 - py, px];
          const i = (py * side + px) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { image: { data, width: side, height: side, colorSpace: 'srgb' as const }, version: (count - 17) / 4 };
}

describe('zxing-wasm reads a dense Aadhaar Secure QR', () => {
  beforeAll(() => {
    // The same .wasm file the pages serve, handed over in memory (the test has no web server).
    const wasm = readFileSync(`${process.cwd()}/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm`);
    prepareZXingModule({ overrides: { wasmBinary: wasm.slice().buffer as ArrayBuffer } });
  });

  for (const [ecc, moduleSize, rotate] of [['M', 4, false], ['L', 3, false], ['Q', 3, true]] as const) {
    it(`decodes UIDAI's sample (error correction ${ecc}, ${moduleSize}px modules${rotate ? ', turned 90°' : ''})`, async () => {
      const { image, version } = render(UIDAI_SAMPLE_SECURE_QR, ecc, moduleSize, rotate);
      expect(version).toBeGreaterThanOrEqual(25);
      const results = await readBarcodes(image as unknown as ImageData, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
      expect(results[0]?.isValid).toBe(true);
      expect(results[0]?.text).toBe(UIDAI_SAMPLE_SECURE_QR);
    }, 30000);
  }
});
