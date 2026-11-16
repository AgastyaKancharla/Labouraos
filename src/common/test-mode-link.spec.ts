import { Controller, Get, INestApplication, Module, Post, StreamableFile } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import {
  TestModeLinkInterceptor,
  collectTestModeLinks,
  recordTestModeLink,
  testModeLinkEnabled,
  withTestModeLinks,
} from './test-mode-link';

const TEST_SITE: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  LABOURA_SETUP: 'test',
  OTP_PROVIDER_MODE: 'mock',
  SMS_PROVIDER_MODE: 'mock',
  PAYMENT_PROVIDER_MODE: 'mock',
  WHATSAPP_PROVIDER_MODE: 'mock',
  TELEPHONY_PROVIDER_MODE: 'mock',
};

describe('testModeLinkEnabled (the gate for testModeLink)', () => {
  it('is on for the hosted test site (render.free.yaml: LABOURA_SETUP=test, NODE_ENV=production, every vendor mock)', () => {
    expect(testModeLinkEnabled(TEST_SITE)).toBe(true);
  });

  it('is off with LABOURA_SETUP=live', () => {
    expect(testModeLinkEnabled({ ...TEST_SITE, LABOURA_SETUP: 'live' })).toBe(false);
  });

  it('is off in the default production config (no LABOURA_SETUP)', () => {
    expect(testModeLinkEnabled({ NODE_ENV: 'production' })).toBe(false);
    const { LABOURA_SETUP: _setup, ...noSetup } = TEST_SITE;
    void _setup;
    expect(testModeLinkEnabled(noSetup)).toBe(false);
  });

  it('is off when SMS is real, even outside production', () => {
    expect(testModeLinkEnabled({ ...TEST_SITE, SMS_PROVIDER_MODE: 'real' })).toBe(false);
    expect(testModeLinkEnabled({ ...TEST_SITE, NODE_ENV: 'development', SMS_PROVIDER_MODE: 'real' })).toBe(false);
  });

  it('is off when any other vendor is live, or OTP test mode is off', () => {
    for (const key of ['OTP_PROVIDER_MODE', 'PAYMENT_PROVIDER_MODE', 'WHATSAPP_PROVIDER_MODE', 'TELEPHONY_PROVIDER_MODE']) {
      expect(testModeLinkEnabled({ ...TEST_SITE, NODE_ENV: 'development', [key]: 'real' })).toBe(false);
    }
    expect(testModeLinkEnabled({ ...TEST_SITE, OTP_TEST_MODE: 'off' })).toBe(false);
  });

  it('is off in the automated suite unless OTP_TEST_MODE=on', () => {
    expect(testModeLinkEnabled({ ...TEST_SITE, NODE_ENV: 'test' })).toBe(false);
    expect(testModeLinkEnabled({ ...TEST_SITE, NODE_ENV: 'test', OTP_TEST_MODE: 'on' })).toBe(true);
  });
});

describe('recordTestModeLink / withTestModeLinks', () => {
  it('collects only http(s) links sent inside a request, and only in test mode', () => {
    const { links } = collectTestModeLinks(() => {
      recordTestModeLink('consent_link', 'https://app.test/p/register/abc', TEST_SITE);
      recordTestModeLink('consent_link', 'javascript:alert(1)', TEST_SITE);
      recordTestModeLink('hit_notice', undefined, TEST_SITE);
      recordTestModeLink('agreement_link', 'https://app.test/p/agreement/x', { ...TEST_SITE, LABOURA_SETUP: 'live' });
    });
    expect(links).toEqual([{ template: 'consent_link', url: 'https://app.test/p/register/abc' }]);
    // Outside a request (a scheduled job) nothing is kept anywhere.
    expect(() => recordTestModeLink('consent_link', 'https://app.test/p/register/zzz', TEST_SITE)).not.toThrow();
  });

  it('adds the link to an object answer only, and never when the gate is off', () => {
    const links = [{ template: 'consent_link', url: 'https://app.test/p/register/abc' }];
    expect(withTestModeLinks({ success: true }, links, TEST_SITE)).toEqual({ success: true, testModeLink: 'https://app.test/p/register/abc' });
    expect(withTestModeLinks({ success: true }, links, { ...TEST_SITE, LABOURA_SETUP: 'live' })).toEqual({ success: true });
    expect(withTestModeLinks({ success: true }, links, { NODE_ENV: 'production' })).toEqual({ success: true });
    expect(withTestModeLinks({ success: true }, links, { ...TEST_SITE, SMS_PROVIDER_MODE: 'real' })).toEqual({ success: true });
    expect(withTestModeLinks([1, 2], links, TEST_SITE)).toEqual([1, 2]);
    expect(withTestModeLinks({ success: true }, [], TEST_SITE)).toEqual({ success: true });
    const two = [...links, { template: 'payout_details_link', url: 'https://app.test/payout-accounts/link/q' }];
    expect(withTestModeLinks({ ok: 1 }, two, TEST_SITE)).toEqual({ ok: 1, testModeLink: links[0].url, testModeLinks: two });
  });
});

@Controller('tml')
class FakeController {
  @Post('send')
  async send() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    recordTestModeLink('consent_link', 'https://app.test/p/register/tok');
    return { success: true };
  }

  @Get('file')
  file() {
    recordTestModeLink('consent_link', 'https://app.test/p/register/tok');
    return new StreamableFile(Buffer.from('x'));
  }

  @Get('quiet')
  quiet() {
    return { success: true };
  }
}

@Module({ controllers: [FakeController], providers: [{ provide: APP_INTERCEPTOR, useClass: TestModeLinkInterceptor }] })
class FakeModule {}

describe('TestModeLinkInterceptor', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [FakeModule] }).compile();
    app = ref.createNestApplication();
    await app.init();
  });
  afterEach(() => {
    for (const key of Object.keys(TEST_SITE).concat(['OTP_TEST_MODE'])) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  afterAll(() => app.close());

  function setEnv(env: NodeJS.ProcessEnv) {
    for (const key of Object.keys(TEST_SITE).concat(['OTP_TEST_MODE'])) delete process.env[key];
    Object.assign(process.env, env);
  }

  it('adds testModeLink to the answer of the request that sent the link (test site)', async () => {
    setEnv({ ...TEST_SITE });
    const res = await request(app.getHttpServer()).post('/tml/send').expect(201);
    expect(res.body).toEqual({ success: true, testModeLink: 'https://app.test/p/register/tok' });
    const quiet = await request(app.getHttpServer()).get('/tml/quiet').expect(200);
    expect(quiet.body).toEqual({ success: true });
  });

  it.each([
    ['LABOURA_SETUP=live', { ...TEST_SITE, LABOURA_SETUP: 'live' }],
    ['a real SMS vendor', { ...TEST_SITE, SMS_PROVIDER_MODE: 'real' }],
    ['the default production config', { NODE_ENV: 'production' }],
  ])('never adds it with %s', async (_name, env) => {
    setEnv(env as NodeJS.ProcessEnv);
    const res = await request(app.getHttpServer()).post('/tml/send').expect(201);
    expect(res.body).toEqual({ success: true });
  });

  it('leaves files alone', async () => {
    setEnv({ ...TEST_SITE });
    const res = await request(app.getHttpServer()).get('/tml/file').expect(200);
    expect(res.body.testModeLink).toBeUndefined();
  });
});
