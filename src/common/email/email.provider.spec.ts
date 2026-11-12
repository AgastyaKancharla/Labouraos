import { Logger } from '@nestjs/common';
import { MockEmailProvider, RealEmailProvider, emailProductionWarning, emailTestModeEnabled, maskEmail } from './email.provider';

describe('email sender (mock until a vendor is chosen)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('masks addresses', () => {
    expect(maskEmail('agastya@laboura.in')).toBe('a***@laboura.in');
    expect(maskEmail('nope')).toBe('***');
  });

  it('test mode follows the OTP rules: off in the tests unless asked, off in production with a live vendor', () => {
    expect(emailTestModeEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(emailTestModeEnabled({ NODE_ENV: 'test', EMAIL_TEST_MODE: 'on' })).toBe(true);
    expect(emailTestModeEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(emailTestModeEnabled({ NODE_ENV: 'production', SMS_PROVIDER_MODE: 'real' })).toBe(false);
    expect(emailTestModeEnabled({ NODE_ENV: 'production', EMAIL_PROVIDER_MODE: 'real' })).toBe(false);
    expect(emailTestModeEnabled({ EMAIL_TEST_MODE: 'off' })).toBe(false);
  });

  it('the mock logs only the masked address, and the link only in test mode', async () => {
    const logs: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => {
      logs.push(String(m));
    });
    const mock = new MockEmailProvider();
    process.env.NODE_ENV = 'test';
    delete process.env.EMAIL_TEST_MODE;
    await mock.send({ to: 'priya@laboura.in', subject: 'Reset', text: 'x', link: 'https://x/reset/abc' });
    expect(logs.join('\n')).toContain('p***@laboura.in');
    expect(logs.join('\n')).not.toContain('priya@laboura.in');
    expect(logs.join('\n')).not.toContain('https://x/reset/abc');
    process.env.EMAIL_TEST_MODE = 'on';
    await mock.send({ to: 'priya@laboura.in', subject: 'Reset', text: 'x', link: 'https://x/reset/abc' });
    expect(logs.join('\n')).toContain('https://x/reset/abc');
    expect(mock.sent).toHaveLength(2);
  });

  it('the real sender calls nothing until it is configured', async () => {
    delete process.env.EMAIL_API_URL;
    const fetchSpy = jest.spyOn(global, 'fetch');
    expect(await new RealEmailProvider().send({ to: 'a@b.in', subject: 's', text: 't' })).toMatchObject({ status: 'failed' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Email in production (F1)', () => {
  it('warns while production runs on the pretend sender, and not otherwise', () => {
    expect(emailProductionWarning({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toMatch(/pretend/);
    expect(emailProductionWarning({ NODE_ENV: 'production', EMAIL_PROVIDER_MODE: 'real' } as NodeJS.ProcessEnv)).toBeNull();
    expect(emailProductionWarning({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('the mock says no real email went out', async () => {
    const result = await new MockEmailProvider().send({ to: 'a@laboura.in', subject: 'x', text: 'y' });
    expect(result).toMatchObject({ status: 'sent', mock: true });
  });
});
