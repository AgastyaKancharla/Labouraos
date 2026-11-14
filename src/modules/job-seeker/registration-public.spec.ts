import { RegistrationController } from './registration.controller';

describe('Registration link endpoints for the public pages', () => {
  const link = { id: 'link-1', purpose: 'registration', subjectType: 'job_seeker', subjectId: 'seeker-1', phone: '+919876512345', expiresAt: new Date(), language: 'kn', metadata: null };
  const payLink = { ...link, id: 'link-2', purpose: 'payment_only', phone: '+919811100000', metadata: { paymentId: 'pay-1' } };
  let publicLinks: { findByToken: jest.Mock; hashToken: jest.Mock };
  let otp: { isVerified: jest.Mock; verifyOtp: jest.Mock };
  let journey: { status: jest.Mock };
  let otherIds: { submitForJobSeeker: jest.Mock };
  let limiter: { claimSend: jest.Mock };
  let controller: RegistrationController;

  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    publicLinks = { findByToken: jest.fn().mockResolvedValue(link), hashToken: jest.fn((t: string) => `hash-${t}`) } as never;
    limiter = { claimSend: jest.fn().mockResolvedValue(undefined) };
    otp = { isVerified: jest.fn().mockResolvedValue(false), verifyOtp: jest.fn().mockResolvedValue(false) };
    journey = { status: jest.fn().mockResolvedValue({ otpRequired: true }) };
    otherIds = { submitForJobSeeker: jest.fn().mockResolvedValue({ verificationId: 'v-1', method: 'pan', status: 'pending', idNumberLast4: '234F' }) };
    controller = new RegistrationController(
      publicLinks as never, otp as never, {} as never, {} as never, {} as never, journey as never, limiter as never, {} as never, otherIds as never,
    );
  });

  it('shows the locked status until the OTP to his own number is verified', async () => {
    await controller.status('tok');
    expect(journey.status).toHaveBeenCalledWith('seeker-1', false);
    otp.isVerified.mockResolvedValue(true);
    await controller.status('tok', 'req-1');
    expect(otp.isVerified).toHaveBeenCalledWith('req-1', '+919876512345');
    expect(journey.status).toHaveBeenLastCalledWith('seeker-1', true);
  });

  it('refuses a wrong code and opens the journey for the right one', async () => {
    await expect(controller.verifyOtp('tok', { requestId: 'req-1', code: '111111' })).rejects.toThrow(/Wrong or expired code/);
    await expect(controller.verifyOtp('tok', { requestId: 'req-1' })).rejects.toThrow(/Type the code/);
    otp.verifyOtp.mockResolvedValue(true);
    otp.isVerified.mockResolvedValue(true);
    await controller.verifyOtp('tok', { requestId: 'req-1', code: '123456' });
    expect(journey.status).toHaveBeenCalledWith('seeker-1', true);
  });

  it('a code sent to another number does not open his link', async () => {
    otp.verifyOtp.mockResolvedValue(true);
    otp.isVerified.mockResolvedValue(false);
    await expect(controller.verifyOtp('tok', { requestId: 'req-1', code: '123456' })).rejects.toThrow(/Wrong or expired code/);
    expect(journey.status).not.toHaveBeenCalled();
  });

  it('another ID: only after his OTP, and the photo, type and number go to the Team Lead check (pending)', async () => {
    const photo = { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' };
    await expect(controller.submitOtherId('tok', photo, { requestId: 'req-1', idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' })).rejects.toThrow(/OTP/);
    expect(otherIds.submitForJobSeeker).not.toHaveBeenCalled();
    otp.isVerified.mockResolvedValue(true);
    await expect(controller.submitOtherId('tok', photo, { requestId: 'req-1', idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' }))
      .resolves.toMatchObject({ status: 'pending', idNumberLast4: '234F' });
    expect(otherIds.submitForJobSeeker).toHaveBeenCalledWith('seeker-1', { idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera', photo }, { channel: 'link' });
  });

  it('has no "SMS me when the ID service is back" any more (no outside ID company)', () => {
    expect((controller as unknown as Record<string, unknown>).waitForIdService).toBeUndefined();
  });

  it('payment-only info shows only the masked payer number and how long the link lasts', async () => {
    publicLinks.findByToken.mockResolvedValue(payLink);
    const info = await controller.paymentOnlyInfo('pay-tok');
    expect(info).toEqual({ maskedPhone: '******0000', language: 'kn', expiresAt: payLink.expiresAt });
  });

  it('the old payment-only URL sends a browser to the new page', async () => {
    const redirect = jest.fn();
    await controller.getPaymentOnlyPage('pay-tok', '', 'text/html', { redirect } as never);
    expect(redirect).toHaveBeenCalledWith(302, 'https://app.laboura.in/p/pay/pay-tok');
    expect(publicLinks.findByToken).not.toHaveBeenCalled();
  });

  it('limits payment-only codes on the server before any SMS is sent', async () => {
    publicLinks.findByToken.mockResolvedValue(payLink);
    const sendOtp = jest.fn().mockResolvedValue({ requestId: 'r' });
    (otp as unknown as { sendOtp: jest.Mock }).sendOtp = sendOtp;
    limiter.claimSend.mockRejectedValueOnce(Object.assign(new Error('A code was just sent. Wait 30 seconds before asking for another.'), { status: 429 }));
    await expect(controller.sendPaymentOnlyOtp('pay-tok')).rejects.toThrow(/Wait 30 seconds/);
    expect(sendOtp).not.toHaveBeenCalled();
    await controller.sendPaymentOnlyOtp('pay-tok');
    expect(limiter.claimSend).toHaveBeenLastCalledWith('hash-pay-tok', '+919811100000');
    expect(sendOtp).toHaveBeenCalledWith('+919811100000');
  });
});
