import { Injectable, Logger } from '@nestjs/common';
import { anyLiveVendor } from '../otp/otp-test-mode';

export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** A link in the message, logged in test mode only (the mock sends nothing). */
  link?: string;
}

export interface EmailSendResult {
  messageId: string;
  status: 'sent' | 'failed';
  error?: string;
  /** True when no real email went out (the pretend sender). */
  mock?: boolean;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** "a***@laboura.in": enough to tell addresses apart in a log, never the whole address. */
export function maskEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  return `${(local ?? '').slice(0, 1)}***@${domain}`;
}

/** The email sender in use: `mock` (pretend, the default) or `real`. */
export function emailMode(env: NodeJS.ProcessEnv = process.env): string {
  return emailModeOf(env);
}

/**
 * F1: the warning System Health shows while production runs on the pretend
 * sender (forgot-password links then reach nobody). Null when all is well.
 */
export function emailProductionWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV !== 'production' || emailModeOf(env) !== 'mock') return null;
  return 'Email is pretend (mock) in production: forgot-password links are not sent to anyone. Set EMAIL_PROVIDER_MODE=real with the email vendor.';
}

function emailModeOf(env: NodeJS.ProcessEnv): string {
  const raw = env.EMAIL_PROVIDER_MODE?.trim().toLowerCase();
  return raw && raw !== 'undefined' ? raw : 'mock';
}

/**
 * Email test mode, the same rules as OTP test mode: while the email vendor is
 * pretend (mock) nobody receives an email, so the mock writes the link into
 * the server log for the tester. On only when EMAIL_PROVIDER_MODE is mock (or
 * unset), EMAIL_TEST_MODE is not `off`, not production with any live vendor,
 * and not the automated tests (NODE_ENV=test) unless EMAIL_TEST_MODE=on.
 */
export function emailTestModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (emailModeOf(env) !== 'mock') return false;
  const setting = env.EMAIL_TEST_MODE?.trim().toLowerCase();
  if (setting === 'off') return false;
  if (env.NODE_ENV === 'production' && (anyLiveVendor(env) || emailModeOf(env) !== 'mock')) return false;
  if (env.NODE_ENV === 'test' && setting !== 'on') return false;
  return true;
}

/**
 * Pretend email (no vendor yet): sends nothing. Logs the masked address and
 * subject; in test mode also the link, so a tester can open it.
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);
  /** What was "sent", for the automated tests (newest last, at most 100). */
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!message.to || !message.subject) return { messageId: '', status: 'failed', error: 'missing address or subject' };
    this.sent.push(message);
    if (this.sent.length > 100) this.sent.shift();
    this.logger.log(`[MOCK EMAIL] "${message.subject}" to ${maskEmail(message.to)}`);
    if (message.link && emailTestModeEnabled()) {
      this.logger.log(`[MOCK EMAIL] Test mode link for ${maskEmail(message.to)}: ${message.link}`);
    }
    return { messageId: `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, status: 'sent', mock: true };
  }
}

/**
 * Real sender stub: no vendor is chosen yet (company email is to be set up).
 * It calls nothing until EMAIL_API_URL and EMAIL_API_KEY are set.
 */
export class RealEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const apiUrl = process.env.EMAIL_API_URL;
    const apiKey = process.env.EMAIL_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiUrl || !apiKey || !from) return { messageId: '', status: 'failed', error: 'Email provider is not configured' };
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }),
    });
    if (!response.ok) return { messageId: '', status: 'failed', error: `Email provider status ${response.status}` };
    const data = (await response.json().catch(() => ({}))) as { messageId?: string; id?: string };
    return { messageId: data.messageId ?? data.id ?? '', status: 'sent' };
  }
}
