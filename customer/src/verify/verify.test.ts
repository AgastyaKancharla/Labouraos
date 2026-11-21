import { ImageManipulator } from 'expo-image-manipulator';
import { ApiError } from '@/api/errors';
import { stepProblemKey } from './errors';
import { preparePhoto } from './photo';
import { agreementCopyUrl, isCodeExpired, isLinkUsed, liveStepsApi, receiptUrl, tokenFromLink } from './stepsApi';

const TOKEN = 'f'.repeat(64);

function fakeFetch(answer: unknown = {}) {
  return jest.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as jest.Mock & typeof fetch;
}

describe('link token', () => {
  it('is the last part of the link the server issued', () => {
    expect(tokenFromLink(`https://app.laboura.com/p/register/${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromLink(`https://app.laboura.com/p/partner/${TOKEN}?app=1#x`)).toBe(TOKEN);
    expect(tokenFromLink('https://app.laboura.com/p/register/')).toBeNull();
    expect(tokenFromLink('laboura-mock://sheet')).toBeNull();
  });
});

describe('liveStepsApi', () => {
  it('calls the link endpoints at the API root with no customer token', async () => {
    const fetchImpl = fakeFetch({ requestId: 'r-1' });
    const api = liveStepsApi('https://api.test', fetchImpl);
    await api.sendLinkOtp(TOKEN);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.test/consent/send-otp');
    expect(JSON.parse(String(init!.body))).toEqual({ token: TOKEN });
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sends consent with the code, the ticked purposes and the hash of the text shown', async () => {
    const fetchImpl = fakeFetch({ success: true });
    await liveStepsApi('https://api.test', fetchImpl).submitConsent(TOKEN, 'r-1', ['job_matching'], 'h'.repeat(64));
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({ token: TOKEN, otpRequestId: 'r-1', purposes: ['job_matching'], language: 'en', textHash: 'h'.repeat(64) });
  });

  it('a photo goes as multipart, marked as a live camera capture, with the capture token for an ID card', async () => {
    const fetchImpl = fakeFetch({ verificationId: 'v', method: 'pan', status: 'pending', idNumberLast4: '234F' });
    const append = jest.spyOn(FormData.prototype, 'append').mockImplementation(() => undefined);
    const photo = { uri: 'file:///c.jpg', name: 'id-card.jpg', type: 'image/jpeg' as const };
    await liveStepsApi('https://api.test', fetchImpl).registrationOtherId(TOKEN, 'r-1', 'pan', 'ABCDE1234F', photo, 'nonce-1');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`https://api.test/registration/${TOKEN}/other-id`);
    expect(init!.body).toBeInstanceOf(FormData);
    // React Native's FormData takes the { uri, name, type } file part as is.
    expect(Object.fromEntries(append.mock.calls.map(([k, v]) => [k, v]))).toEqual({
      requestId: 'r-1', idType: 'pan', idNumber: 'ABCDE1234F', captureNonce: 'nonce-1', captureSource: 'live_camera', photo,
    });
    append.mockRestore();
  });

  it("the partner's terms tick three purposes; the agreement three including authority", async () => {
    const fetchImpl = fakeFetch({ success: true });
    const api = liveStepsApi('https://api.test', fetchImpl);
    await api.acceptPartnerTerms(TOKEN, 'r-1');
    await api.signAgreement(TOKEN, 'r-2', '123456', 'Manjunath');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).purposes).toEqual(['agreement_terms', 'call_recording', 'aadhaar_verification']);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body))).toEqual({ token: TOKEN, otpRequestId: 'r-2', otpCode: '123456', signedName: 'Manjunath', purposes: ['agreement_terms', 'agreement_authority', 'call_recording'] });
  });

  it('builds the signed copy and receipt addresses', () => {
    expect(agreementCopyUrl('https://api.test/', TOKEN)).toBe(`https://api.test/consent/${TOKEN}/signed/copy`);
    expect(receiptUrl('https://api.test', 'pay 1', 'tok')).toBe('https://api.test/payments/pay%201/receipt?token=tok');
  });
});

describe('problems', () => {
  const err = (status: number, message: string) => new ApiError({ status, messages: [message] });
  it('tells a code that ran out from a used link and other problems', () => {
    expect(isCodeExpired(err(400, 'OTP to the registered mobile is required'))).toBe(true);
    expect(isCodeExpired(err(409, 'OTP limit'))).toBe(false);
    expect(isCodeExpired(err(400, 'A valid 11-character IFSC code is required'))).toBe(false);
    expect(isCodeExpired(err(400, 'Valid owner OTP is required to sign referral terms'))).toBe(true);
    expect(isLinkUsed(err(400, 'This link has already been used'))).toBe(true);
    expect(stepProblemKey(err(409, 'Your registration is being checked by our team'))).toBe('verr.underReview');
    expect(stepProblemKey(err(400, 'This link has expired'))).toBe('verr.expired');
    expect(stepProblemKey(err(429, 'slow down'))).toBe('verr.tooMany');
    expect(stepProblemKey(err(503, 'down'))).toBe('verr.server');
    expect(stepProblemKey(new ApiError({ status: 0, messages: [], isNetworkError: true }))).toBe('verr.offline');
  });
});

describe('preparePhoto', () => {
  const manipulate = ImageManipulator.manipulate as jest.Mock;
  const mocked = jest.requireMock('expo-image-manipulator') as { __size: { width: number; height: number } };
  const deleted = (jest.requireMock('expo-file-system') as { __deleted: string[] }).__deleted;
  beforeEach(() => {
    manipulate.mockClear();
    deleted.length = 0;
    mocked.__size.width = 1600;
    mocked.__size.height = 1200;
  });

  it('sizes from the drawn picture: a portrait card over 1280 px is scaled along its height, saved as a fresh JPEG, and the camera file deleted', async () => {
    mocked.__size.width = 1200;
    mocked.__size.height = 1600;
    const photo = await preparePhoto('file:///shot.jpg', 'card');
    expect(manipulate).toHaveBeenCalledTimes(2);
    expect(manipulate.mock.results[1]!.value.resize).toHaveBeenCalledWith({ height: 1280 });
    expect(photo).toEqual({ uri: 'file:///cache/prepared.jpg', name: 'id-card.jpg', type: 'image/jpeg' });
    expect(deleted).toEqual(['file:///shot.jpg']);
  });

  it('a card already small enough is only saved again (no resize)', async () => {
    mocked.__size.width = 1024;
    mocked.__size.height = 768;
    await preparePhoto('file:///shot.jpg', 'card');
    expect(manipulate).toHaveBeenCalledTimes(1);
  });

  it('a selfie is kept at 960 px wide', async () => {
    mocked.__size.width = 3000;
    mocked.__size.height = 4000;
    await preparePhoto('file:///shot.jpg', 'selfie');
    expect(manipulate.mock.results[1]!.value.resize).toHaveBeenCalledWith({ width: 960 });
  });

  it('refuses a card whose shortest side is under 240 px, and still deletes the camera file', async () => {
    mocked.__size.width = 1000;
    mocked.__size.height = 200;
    await expect(preparePhoto('file:///shot.jpg', 'card')).rejects.toThrow('PHOTO_TOO_SMALL');
    expect(deleted).toEqual(['file:///shot.jpg']);
  });
});
