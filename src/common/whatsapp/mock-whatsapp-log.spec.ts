import { Logger } from '@nestjs/common';
import { MockWhatsAppProvider, maskForLog } from './mock-whatsapp.provider';

describe('M5: the mock WhatsApp sender masks numbers and never logs link tokens', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs the template, the last 4 digits and the variable names only', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const token = 'tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0';
    const result = await new MockWhatsAppProvider().sendTemplateMessage('+919876543210', 'registration_link', {
      name: 'Ravi',
      link: `https://app.laboura.in/app/p/r/${token}`,
    });
    const line = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toContain("template 'registration_link'");
    expect(line).toContain('******3210');
    expect(line).toContain('[name, link]');
    expect(line).not.toContain('9876543210');
    expect(line).not.toContain(token);
    expect(line).not.toContain('Ravi');
    // What the code keeps in memory for tests is unchanged.
    expect(result.phone).toBe('+919876543210');
  });

  it('masks any spelling of a number', () => {
    expect(maskForLog('98765 43210')).toBe('******3210');
    expect(maskForLog('')).toBe('******');
  });
});
