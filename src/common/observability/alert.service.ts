import { Injectable, Logger } from '@nestjs/common';
import { getRequestId } from './request-context';

export interface AlertPayload {
  title: string;
  message: string;
  severity?: 'critical' | 'error' | 'warning';
  requestId?: string;
  timestamp?: string;
  error?: string;
  stack?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private webhookUrl: string | null = null;
  private readonly dispatchedAlerts: AlertPayload[] = [];

  constructor() {
    this.webhookUrl = process.env.ALERT_WEBHOOK_URL || null;
  }

  setWebhookUrl(url: string | null): void {
    this.webhookUrl = url;
  }

  getDispatchedAlerts(): AlertPayload[] {
    return [...this.dispatchedAlerts];
  }

  clearDispatchedAlerts(): void {
    this.dispatchedAlerts.length = 0;
  }

  /**
   * Dispatches an alert to the configured webhook endpoint (e.g. Slack / alerting channel).
   * If ALERT_WEBHOOK_URL is not configured, logs the alert in mock mode.
   */
  async sendAlert(payload: AlertPayload): Promise<boolean> {
    const severity = payload.severity || 'error';
    const alert: AlertPayload = {
      ...payload,
      requestId: payload.requestId || getRequestId(),
      timestamp: payload.timestamp || new Date().toISOString(),
      severity,
    };

    this.dispatchedAlerts.push(alert);

    if (!this.webhookUrl) {
      this.logger.warn(
        `[ALERT:MOCK] [${severity.toUpperCase()}] ${alert.title}: ${alert.message} (requestId=${alert.requestId || 'none'})`,
      );
      return true;
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 *[${severity.toUpperCase()}] ${alert.title}*\n${alert.message}\n_Request ID_: \`${alert.requestId || 'none'}\`\n_Timestamp_: ${alert.timestamp}`,
          alert,
        }),
      });

      if (!response.ok) {
        this.logger.error(
          `Failed to post alert to webhook: HTTP ${response.status} ${response.statusText}`,
        );
        return false;
      }
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error sending alert webhook: ${msg}`);
      return false;
    }
  }

  /**
   * Helper to notify on unhandled errors / 500 exceptions.
   */
  async notifyException(
    err: unknown,
    contextInfo?: { context?: string; path?: string; method?: string },
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const title = contextInfo
      ? `Unhandled Exception in ${contextInfo.method || ''} ${contextInfo.path || contextInfo.context || 'App'}`
      : 'Unhandled Application Exception';

    await this.sendAlert({
      title,
      message,
      severity: 'error',
      stack,
      metadata: contextInfo ? { ...contextInfo } : undefined,
    });
  }
}
