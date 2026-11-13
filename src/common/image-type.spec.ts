import { detectSelfieImageType } from './image-type';

describe('Selfie image type from the first bytes', () => {
  const pad = (head: number[]) => Buffer.from([...head, ...new Array(16).fill(0)]);
  it('knows JPEG, PNG and WebP', () => {
    expect(detectSelfieImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectSelfieImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectSelfieImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]))).toBe('image/webp');
  });
  it('refuses anything else, whatever it claims to be', () => {
    expect(detectSelfieImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectSelfieImageType(Buffer.from('%PDF-1.7 fake pdf body here'))).toBeNull();
    expect(detectSelfieImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectSelfieImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectSelfieImageType(undefined)).toBeNull();
  });
});
