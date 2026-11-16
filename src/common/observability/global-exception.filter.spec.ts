import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { codedError } from '../http/coded-error';
import { AlertService } from './alert.service';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * The error shape the apps really get (docs/api/field-redesign.md "Errors"): the
 * global filter wraps every error as `{ statusCode, message, details, requestId,
 * timestamp }`, so a coded error's `code` is at `details.code`.
 */
describe('GlobalExceptionFilter: error shape', () => {
  function run(exception: unknown) {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'POST', headers: {}, route: { path: '/field-work/businesses/:ref/agreement-link' }, baseUrl: '' }),
      }),
    } as unknown as ArgumentsHost;
    const alerts = { notifyException: jest.fn().mockResolvedValue(undefined) } as unknown as AlertService;
    new GlobalExceptionFilter(alerts).catch(exception, host);
    return { status: (status.mock.calls[0] as unknown as [number])[0], body: json.mock.calls[0][0] as Record<string, unknown> };
  }

  it('puts a coded 4xx error under details (details.code, details.retryAt …), with its message on top', () => {
    const { status, body } = run(codedError(HttpStatus.TOO_MANY_REQUESTS, 'AGREEMENT_RESEND_TOO_SOON', 'Wait a minute', { retryAt: '2026-11-16T05:32:00.000Z' }));
    expect(status).toBe(429);
    expect(body).toMatchObject({
      statusCode: 429,
      message: 'Wait a minute',
      details: { statusCode: 429, error: 'Too Many Requests', code: 'AGREEMENT_RESEND_TOO_SOON', message: 'Wait a minute', retryAt: '2026-11-16T05:32:00.000Z' },
    });
    expect(body.code).toBeUndefined();
  });

  it('keeps only the code of a coded 5xx error (502 AGREEMENT_SMS_FAILED), never its text', () => {
    const { status, body } = run(codedError(HttpStatus.BAD_GATEWAY, 'AGREEMENT_SMS_FAILED', 'The SMS could not be sent.'));
    expect(status).toBe(502);
    expect(body).toMatchObject({ statusCode: 502, message: 'Internal server error', details: { code: 'AGREEMENT_SMS_FAILED' } });
    expect(JSON.stringify(body)).not.toContain('SMS could not');
  });

  it('a plain 5xx error says nothing more than "Internal server error"', () => {
    const { status, body } = run(new Error('database password is hunter2'));
    expect(status).toBe(500);
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('an older error with no code keeps only its message (and Nest\'s own body under details)', () => {
    const { body } = run(new BadRequestException('Enter the owner\'s code'));
    expect(body).toMatchObject({ statusCode: 400, message: "Enter the owner's code", details: { statusCode: 400, message: "Enter the owner's code" } });
    expect((body.details as Record<string, unknown>).code).toBeUndefined();
  });
});
