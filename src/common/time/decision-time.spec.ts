import { BadRequestException } from '@nestjs/common';
import { decisionTime } from './decision-time';

describe('decisionTime: approvals use the server clock outside tests', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const serverNow = new Date('2026-11-11T10:00:00.000Z');
  const future = '2026-12-31T00:00:00.000Z';

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('ignores a caller date in production and development', () => {
    for (const env of ['production', 'development', undefined]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      expect(decisionTime(future, serverNow)).toBe(serverNow);
      expect(decisionTime(new Date(future), serverNow)).toBe(serverNow);
      expect(decisionTime('not a date', serverNow)).toBe(serverNow);
    }
  });

  it('uses the caller date only in test mode', () => {
    process.env.NODE_ENV = 'test';
    expect(decisionTime(future, serverNow).toISOString()).toBe(future);
    expect(() => decisionTime('not a date', serverNow)).toThrow(BadRequestException);
  });

  it('uses the server clock when no date is sent', () => {
    process.env.NODE_ENV = 'test';
    expect(decisionTime(undefined, serverNow)).toBe(serverNow);
    expect(decisionTime('', serverNow)).toBe(serverNow);
  });
});
