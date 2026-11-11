import { Logger } from '@nestjs/common';
import { AlertService, MAX_KEPT_ALERTS } from './alert.service';

describe('AlertService keeps a bounded list of recent alerts', () => {
  const originalWebhook = process.env.ALERT_WEBHOOK_URL;

  beforeEach(() => {
    delete process.env.ALERT_WEBHOOK_URL;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalWebhook === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = originalWebhook;
    jest.restoreAllMocks();
  });

  it(`never holds more than ${MAX_KEPT_ALERTS} alerts and keeps the newest ones`, async () => {
    const alerts = new AlertService();
    const total = MAX_KEPT_ALERTS + 75;
    for (let i = 0; i < total; i++) {
      await alerts.sendAlert({ title: `alert ${i}`, message: 'm', severity: 'warning' });
    }

    const kept = alerts.getDispatchedAlerts();
    expect(kept).toHaveLength(MAX_KEPT_ALERTS);
    expect(kept[0].title).toBe(`alert ${total - MAX_KEPT_ALERTS}`);
    expect(kept[kept.length - 1].title).toBe(`alert ${total - 1}`);
  });

  it('keeps every alert while under the cap', async () => {
    const alerts = new AlertService();
    await alerts.sendAlert({ title: 'one', message: 'm' });
    await alerts.sendAlert({ title: 'two', message: 'm' });
    expect(alerts.getDispatchedAlerts().map((a) => a.title)).toEqual(['one', 'two']);
  });
});
