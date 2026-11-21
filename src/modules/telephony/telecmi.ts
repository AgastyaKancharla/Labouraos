import { timingSafeEqual } from 'crypto';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CallStatusEvent } from '../call/call-status.event';
import { RealTelephonyProvider } from './real-telephony.provider';
import {
  InboundCallEvent,
  InboundCallResult,
  OutboundCallParams,
  OutboundCallResult,
  TelephonyCapacity,
  TelephonyProvider,
} from './telephony.interface';

/**
 * TeleCMI (21 Nov fixes, the calling company chosen by the owner), built from
 * TeleCMI's public docs (doc.telecmi.com/chub-india, read 21 Nov 2026):
 * - click to call: `POST https://piopiy.telecmi.com/v1/adminConnect` with
 *   `{ agent_id, token, to, custom }`; TeleCMI rings the agent first, then
 *   the person; the answer carries `request_id`;
 * - call reports (CDR) to our webhook as JSON: `type: "cdr"`, `direction`
 *   inbound / outbound, `status` answered / missed, `cmiuuid`, `from` / `to`,
 *   `user` (the TeleCMI agent), `time` (epoch ms), `answeredsec`, `record`,
 *   `filename`.
 *
 * TeleCMI documents no webhook signature, so the webhook URL carries a key of
 * our own (`?key=`, TELECMI_WEBHOOK_KEY, at least 32 characters) and the
 * `appid` must be ours (TELECMI_APP_ID). Selected by TELEPHONY_PROVIDER_MODE=telecmi.
 *
 * Settings (environment):
 * - TELECMI_APP_ID, TELECMI_SECRET (the app secret, sent as `token`);
 * - TELECMI_AGENTS: JSON from an agent's calling phone (10 digits) to their
 *   TeleCMI agent id, e.g. {"9812300001":"101_1111112"};
 * - TELECMI_WEBHOOK_KEY.
 */
export const TELECMI_CLICK_TO_CALL_URL = 'https://piopiy.telecmi.com/v1/adminConnect';
export const TELECMI_VENDOR = 'telecmi';

function tenDigits(phone: unknown): string {
  return String(phone ?? '').replace(/\D/g, '').slice(-10);
}

export function teleCmiAgentMap(raw: string | undefined = process.env.TELECMI_AGENTS): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [phone, agent] of Object.entries(parsed)) {
      if (typeof agent === 'string' && tenDigits(phone).length === 10) out.set(tenDigits(phone), agent);
    }
  } catch {
    // A broken setting means no agent can call; the error says so at the first call.
  }
  return out;
}

export interface TeleCmiOptions {
  appId?: string;
  secret?: string;
  agents?: Map<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class TeleCmiTelephonyProvider implements TelephonyProvider {
  private readonly logger = new Logger(TeleCmiTelephonyProvider.name);
  /** Missed calls are kept exactly as with the other vendor (idempotent CallbackTask). */
  private readonly inbound: RealTelephonyProvider;
  private readonly secret: string;
  private readonly agents: Map<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(prisma: PrismaService, audit: AuditService, options: TeleCmiOptions = {}) {
    this.inbound = new RealTelephonyProvider(prisma, audit, { vendor: TELECMI_VENDOR });
    this.secret = options.secret ?? process.env.TELECMI_SECRET ?? '';
    this.agents = options.agents ?? teleCmiAgentMap();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  handleInboundCall(event: InboundCallEvent): Promise<InboundCallResult> {
    return this.inbound.handleInboundCall(event);
  }

  async initiateOutboundCall(params: OutboundCallParams): Promise<OutboundCallResult> {
    const failed = (error: string): OutboundCallResult => ({ callId: '', status: 'failed', recordingEnabled: false, consentAnnounced: false, error });
    const agentId = this.agents.get(tenDigits(params.agentPhone));
    if (!agentId) return failed('No TeleCMI agent is set for this calling phone (TELECMI_AGENTS)');
    if (!this.secret) return failed('TELECMI_SECRET is not set');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(TELECMI_CLICK_TO_CALL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          token: this.secret,
          to: tenDigits(params.customerPhone),
          // Echoed back so the call report finds our call (to confirm with TeleCMI: see DEPLOY.md).
          custom: params.metadata?.callRecordId ?? '',
        }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; request_id?: string };
      if (!res.ok || (body.code !== undefined && body.code !== 200) || !body.request_id) {
        this.logger.warn(`TeleCMI click to call refused: ${res.status} ${body.msg ?? ''}`);
        return failed(`TeleCMI refused the call (${res.status}${body.msg ? `: ${body.msg}` : ''})`);
      }
      return { callId: body.request_id, status: 'initiated', recordingEnabled: params.recordCall ?? true, consentAnnounced: Boolean(params.announcement) };
    } catch (err) {
      this.logger.warn(`TeleCMI click to call failed: ${(err as Error).message}`);
      return failed('TeleCMI could not be reached');
    } finally {
      clearTimeout(timer);
    }
  }

  getCapacity(): TelephonyCapacity {
    const channels = parseInt(process.env.TELEPHONY_CHANNELS || '60', 10);
    return { concurrentChannels: channels, maxAgentsSupported: channels, vendor: TELECMI_VENDOR };
  }

  supportsThreeWayCalls(): boolean {
    return false;
  }
}

// ------------------------------------------------------------------ webhook

/** The webhook key in the URL matches TELECMI_WEBHOOK_KEY (constant-time); no key set = refused. */
export function teleCmiKeyMatches(key: string | undefined, expected: string | undefined = process.env.TELECMI_WEBHOOK_KEY): boolean {
  if (!expected || expected.length < 32 || typeof key !== 'string') return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type TeleCmiReport =
  | { kind: 'missed_inbound'; callId: string; callerPhone: string; at: Date }
  | { kind: 'status'; event: CallStatusEvent; callRecordId: string | null; agentId: string | null }
  | { kind: 'ignored'; reason: string };

function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/**
 * One TeleCMI call report → what Laboura does with it. Live events are not
 * used yet (the CDR at the end of each call is enough for the lists).
 */
/** A report more than this far from now (either way) is refused: no replayed or forged old reports. */
export const TELECMI_REPORT_MAX_SKEW_MS = 24 * 60 * 60 * 1000;

/** 10 to 13 digits (a national number with or without 0 / 91): anything else is junk. */
export function plausiblePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return /^[+\d\s()-]+$/.test(value) && digits.length >= 10 && digits.length <= 13;
}

export function mapTeleCmiReport(
  payload: Record<string, unknown>,
  appId: string | undefined = process.env.TELECMI_APP_ID,
  now: Date = new Date(),
): TeleCmiReport {
  if (str(payload.type) !== 'cdr') return { kind: 'ignored', reason: 'not a call report' };
  const app = str(payload.appid) ?? str(payload.app_id);
  // Our app id is required: without it set, or for another app, nothing is accepted.
  if (!appId) return { kind: 'ignored', reason: 'app id not set' };
  if (app !== appId) return { kind: 'ignored', reason: 'another app' };
  const callId = str(payload.cmiuuid);
  if (!callId) return { kind: 'ignored', reason: 'no call id' };
  const direction = str(payload.direction);
  const status = str(payload.status);
  // Epoch milliseconds in TeleCMI's samples; epoch seconds accepted too (a value below 10^11 is seconds).
  const rawTime = Number(payload.time);
  const timeMs = Number.isFinite(rawTime) && rawTime > 0 && rawTime < 1e11 ? rawTime * 1000 : rawTime;
  if (!Number.isFinite(timeMs) || timeMs <= 0) return { kind: 'ignored', reason: 'no report time' };
  const at = new Date(timeMs);
  if (Math.abs(at.getTime() - now.getTime()) > TELECMI_REPORT_MAX_SKEW_MS) return { kind: 'ignored', reason: 'report time out of range' };
  const answered = status === 'answered';
  const seconds = Number(payload.answeredsec);
  const duration = Number.isFinite(seconds) && seconds >= 0 ? Math.trunc(seconds) : answered ? null : 0;
  if (direction === 'inbound' && status === 'missed') {
    const from = str(payload.from);
    if (!from || !plausiblePhone(from)) return { kind: 'ignored', reason: 'missed call with no valid number' };
    return { kind: 'missed_inbound', callId: `telecmi:${callId}`, callerPhone: from, at };
  }
  if (direction !== 'inbound' && direction !== 'outbound') return { kind: 'ignored', reason: 'unknown direction' };
  if (status !== 'answered' && status !== 'missed') return { kind: 'ignored', reason: `status ${status ?? 'missing'}` };
  const custom = str(payload.custom) ?? str((payload.extra_params as Record<string, unknown> | undefined)?.callRecordId);
  return {
    kind: 'status',
    callRecordId: direction === 'outbound' ? custom : null,
    agentId: str(payload.user),
    event: {
      provider: TELECMI_VENDOR,
      // Outbound: the click-to-call request id if TeleCMI echoes it, else the call's own id.
      providerCallId: direction === 'outbound' ? (str(payload.request_id) ?? callId) : `telecmi:${callId}`,
      status: answered ? 'completed' : 'no_answer',
      answered,
      startedAt: at,
      answeredAt: answered ? at : null,
      endedAt: duration !== null ? new Date(at.getTime() + duration * 1000) : at,
      durationSec: duration,
      // The recording file (`filename`) needs TeleCMI's download link: not wired yet (see DEPLOY.md).
      recordingUrl: null,
      direction,
    },
  };
}
