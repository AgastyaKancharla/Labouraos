import { CallStatus, normalizeCallStatus } from './call-status';

/** Provider-neutral call status. The webhook is the only writer of these fields. */
export interface CallStatusEvent {
  provider: string;
  providerCallId: string;
  status: CallStatus;
  answered: boolean;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  recordingUrl: string | null;
  direction: 'inbound' | 'outbound' | null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const found = asString(payload[key]);
    if (found) {
      return found;
    }
  }
  return null;
}

function asDate(value: unknown): Date | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  const text = asString(value);
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.trunc(parsed));
}

function asDirection(value: unknown): 'inbound' | 'outbound' | null {
  const text = asString(value)?.toLowerCase();
  if (text === 'inbound' || text === 'outbound') {
    return text;
  }
  return null;
}

function answeredFor(status: CallStatus, durationSec: number | null, explicit: unknown): boolean {
  if (typeof explicit === 'boolean') {
    return explicit;
  }
  if (status === 'answered') {
    return true;
  }
  return status === 'completed' && (durationSec ?? 0) > 0;
}

/** Maps an Exotel-style status payload onto CallStatusEvent. */
export function mapExotelCallStatus(
  payload: Record<string, unknown>,
  provider = 'exotel',
): CallStatusEvent | null {
  const providerCallId = firstString(payload, ['CallSid', 'call_sid', 'callSid']);
  const rawStatus = firstString(payload, ['DialCallStatus', 'Status', 'CallStatus', 'status']);
  if (!providerCallId || !rawStatus) {
    return null;
  }
  const status = normalizeCallStatus(rawStatus);
  if (!status) {
    return null;
  }
  const durationSec = asDuration(
    payload.DialCallDuration ?? payload.Duration ?? payload.duration ?? payload.durationSec,
  );
  return {
    provider,
    providerCallId,
    status,
    answered: answeredFor(status, durationSec, payload.answered),
    startedAt: asDate(payload.StartTime ?? payload.startedAt),
    answeredAt: asDate(payload.AnsweredTime ?? payload.answeredAt),
    endedAt: asDate(payload.EndTime ?? payload.endedAt),
    durationSec,
    recordingUrl: firstString(payload, ['RecordingUrl', 'recordingUrl']),
    direction: asDirection(payload.Direction ?? payload.direction),
  };
}

/** Accepts either the neutral event or an Exotel payload. */
export function toCallStatusEvent(payload: Record<string, unknown>): CallStatusEvent | null {
  const provider = asString(payload.provider);
  const providerCallId = asString(payload.providerCallId);
  const rawStatus = asString(payload.status);
  if (provider && providerCallId && rawStatus && !payload.CallSid) {
    const status = normalizeCallStatus(rawStatus);
    if (!status) {
      return null;
    }
    const durationSec = asDuration(payload.durationSec);
    return {
      provider,
      providerCallId,
      status,
      answered: answeredFor(status, durationSec, payload.answered),
      startedAt: asDate(payload.startedAt),
      answeredAt: asDate(payload.answeredAt),
      endedAt: asDate(payload.endedAt),
      durationSec,
      recordingUrl: asString(payload.recordingUrl),
      direction: asDirection(payload.direction),
    };
  }
  return mapExotelCallStatus(payload);
}
