import { prepareQrDecoder, qrDecoderBase, ZXING_WASM_FILE } from './prepareQrDecoder.web';

const mockPrepare = jest.fn();
jest.mock('barcode-detector/ponyfill', () => ({ prepareZXingModule: (...args: unknown[]) => mockPrepare(...args) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { experiments: { baseUrl: '/field' } } } }));

describe('the web app reads Aadhaar QR codes with zxing served from its own address', () => {
  it('uses the build base: /field/ on the office address, / on field.laboura.com', () => {
    expect(qrDecoderBase('/field')).toBe('/field/');
    expect(qrDecoderBase(undefined)).toBe('/');
    expect(qrDecoderBase('/')).toBe('/');
  });

  it('points the WebAssembly file at the build (never a CDN), once', () => {
    prepareQrDecoder();
    prepareQrDecoder();
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    const { locateFile } = mockPrepare.mock.calls[0][0].overrides as { locateFile: (path: string, prefix: string) => string };
    expect(locateFile(ZXING_WASM_FILE, 'https://fastly.jsdelivr.net/npm/zxing-wasm/')).toBe('/field/zxing_reader.wasm');
  });
});
