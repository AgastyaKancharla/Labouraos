import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toast';
import { useT } from '../i18n/I18nProvider';
import { isApiError } from '../lib/api/errors';
import { useLiveEvent } from '../lib/live/liveChannel';
import { useClock } from '../lib/useNow';
import { attendanceKeys, dayPhase, useAttendanceActions, useAttendanceToday, type AttendanceToday, type DayPhase } from './api';
import { EndDayDialog } from './EndDayDialog';
import { clockTime } from './format';
import { IdlePrompt } from './IdlePrompt';
import { BreakPrompt } from './BreakPrompt';
import { useAuth } from '../auth/AuthProvider';
import { isKnownStatus, statusLabelKey, type AttendanceAudience, type AttendanceStatus } from './statuses';
import './attendance.css';
import { formatLateMinutes } from '../lib/format/late';

/**
 * One attendance state per signed-in tab, shared by the header status menu,
 * the banner, the "Still there?" check and the CA14 screens. Mounted by the
 * call agent console and by the Team Lead, Manager and Finance portals
 * (owner decision 12 Nov: office staff mark attendance the same way).
 *
 * - The day comes from GET /attendance/today, polled every 30 s and refreshed
 *   at once when the live channel says the status changed (`attendance_status`:
 *   the phone system, the idle detector, the end of the day).
 * - While the day is open and the tab is visible, a presence heartbeat goes
 *   about once a minute without any input (decided 21 Nov: an open, visible
 *   console counts as present). Any click, key or mouse movement counts as
 *   activity and sends an activity heartbeat at most once a minute.
 * - Available with no call and no click for the "Still there?" setting (30
 *   minutes; a CEO setting) opens "Still there?" with one minute to answer;
 *   with no answer the server marks Idle (it counts the same minute), calls
 *   stop and the Team Lead's live board shows it. A console closed or hidden
 *   for 10 minutes is Idle too.
 * - Log out ends the working day and signs out (decided 21 Nov); signing in
 *   again the same day on this device needs no login code and offers
 *   "Resume my day".
 * - After the lunch or break allowance: "Back from lunch?" (BreakPrompt).
 */
export interface IdlePromptState {
  open: boolean;
  secondsLeft: number;
  quietMinutes: number;
}

interface AttendanceValue {
  audience: AttendanceAudience;
  today: AttendanceToday | undefined;
  loading: boolean;
  failed: boolean;
  phase: DayPhase | null;
  status: AttendanceStatus | null;
  busy: boolean;
  start: () => Promise<void>;
  pick: (status: AttendanceStatus) => Promise<void>;
  /** Opens the "End your day?" confirmation. */
  requestEnd: () => void;
  /** "Resume my day": the day ended with Log out today (today.canResume). */
  resume: () => Promise<void>;
  stayAvailable: () => void;
  idle: IdlePromptState;
}

const AttendanceContext = createContext<AttendanceValue | null>(null);

/** The attendance state, or null where attendance is not marked (CEO, public pages). */
export function useAttendance(): AttendanceValue | null {
  return useContext(AttendanceContext);
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart', 'scroll'] as const;
const HEARTBEAT_EVERY_MS = 60_000;
/** While the tab is visible it tells the server it is open this often (decided 21 Nov). */
export const PRESENCE_EVERY_MS = 60_000;

/** Pure idle arithmetic, so it can be tested without timers. */
export function idleState(input: {
  status: string | null;
  statusSince: string | null;
  lastActivityMs: number;
  nowMs: number;
  idleAfterMinutes: number;
  idlePromptMinutes: number;
}): IdlePromptState & { expired: boolean } {
  if (input.status !== 'available') return { open: false, secondsLeft: 0, quietMinutes: 0, expired: false };
  const since = Math.max(input.lastActivityMs, input.statusSince ? Date.parse(input.statusSince) : 0);
  const quietMs = Math.max(0, input.nowMs - since);
  const idleAfterMs = input.idleAfterMinutes * 60_000;
  const deadlineMs = idleAfterMs + input.idlePromptMinutes * 60_000;
  const open = quietMs >= idleAfterMs;
  const secondsLeft = Math.max(0, (deadlineMs - quietMs) / 1000);
  return { open, secondsLeft, quietMinutes: Math.floor(quietMs / 60_000), expired: open && quietMs >= deadlineMs };
}

export function AttendanceProvider({ audience, children }: { audience: AttendanceAudience; children: ReactNode }) {
  const t = useT();
  const toast = useToast();
  const clock = useClock();
  const qc = useQueryClient();
  const query = useAttendanceToday();
  const actions = useAttendanceActions();
  const today = query.data;
  const phase = today ? dayPhase(today) : null;
  const status = today && phase === 'open' && isKnownStatus(today.status) ? today.status : null;
  const [endOpen, setEndOpen] = useState(false);
  const auth = useAuth();

  const lastActivity = useRef(clock().getTime());
  const lastBeat = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const heartbeatRef = useRef(actions.heartbeat);
  heartbeatRef.current = actions.heartbeat;

  useLiveEvent('attendance_status', () => {
    void qc.invalidateQueries({ queryKey: attendanceKeys.today });
    void qc.invalidateQueries({ queryKey: ['call-work'] });
  });

  const beat = useCallback(() => {
    const now = clock().getTime();
    lastBeat.current = now;
    heartbeatRef.current.mutate('activity', { onError: () => undefined });
  }, [clock]);

  // Present while the console is open and visible, even without input (decided 21 Nov).
  useEffect(() => {
    const presence = () => {
      if (phaseRef.current !== 'open' || document.visibilityState !== 'visible') return;
      heartbeatRef.current.mutate('presence', { onError: () => undefined });
    };
    const id = setInterval(presence, PRESENCE_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') presence();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const onActivity = () => {
      const now = clock().getTime();
      lastActivity.current = now;
      if (phaseRef.current === 'open' && now - lastBeat.current >= HEARTBEAT_EVERY_MS && !heartbeatRef.current.isPending) beat();
    };
    for (const name of ACTIVITY_EVENTS) document.addEventListener(name, onActivity, { capture: true, passive: true });
    return () => {
      for (const name of ACTIVITY_EVENTS) document.removeEventListener(name, onActivity, { capture: true });
    };
  }, [clock, beat]);

  // Ticks every second while Available, for the "Still there?" countdown.
  const [nowMs, setNowMs] = useState(() => clock().getTime());
  useEffect(() => {
    if (status !== 'available') return;
    setNowMs(clock().getTime());
    const id = setInterval(() => setNowMs(clock().getTime()), 1000);
    return () => clearInterval(id);
  }, [status, clock]);

  const policy = today?.policy;
  const idle = idleState({
    status,
    statusSince: today?.statusSince ?? null,
    lastActivityMs: lastActivity.current,
    nowMs,
    idleAfterMinutes: policy?.idleAfterMinutes ?? 30,
    idlePromptMinutes: policy?.idlePromptMinutes ?? 1,
  });

  // The minute ran out: the server has marked Idle (or does now) — read it back once.
  const expiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!idle.expired) return;
    const key = `${today?.statusSince}:${lastActivity.current}`;
    if (expiredFor.current === key) return;
    expiredFor.current = key;
    void qc.invalidateQueries({ queryKey: attendanceKeys.today });
  }, [idle.expired, today?.statusSince, qc]);

  const showError = useCallback(
    (error: unknown) => toast.error(isApiError(error) ? error.message : String(error)),
    [toast],
  );

  const start = useCallback(async () => {
    try {
      const next = await actions.start.mutateAsync();
      lastActivity.current = clock().getTime();
      lastBeat.current = lastActivity.current;
      const time = next.loginAt ? clockTime(next.loginAt) : '';
      toast.success(next.lateMinutes > 0 ? t('att.toast.startedLate', { time, late: formatLateMinutes(next.lateMinutes) }) : t('att.toast.started', { time }));
    } catch (error) {
      showError(error);
    }
  }, [actions.start, clock, t, toast, showError]);

  const pick = useCallback(
    async (next: AttendanceStatus) => {
      try {
        await actions.setStatus.mutateAsync(next);
        lastActivity.current = clock().getTime();
        toast.success(t('att.toast.status', { status: t(statusLabelKey(next, audience)) }));
      } catch (error) {
        showError(error);
      }
    },
    [actions.setStatus, audience, clock, t, toast, showError],
  );

  const end = useCallback(async () => {
    try {
      const next = await actions.end.mutateAsync();
      setEndOpen(false);
      toast.success(t('att.toast.ended', { time: next.logoutAt ? clockTime(next.logoutAt) : '' }));
      // Log out ends the working day and the sign-in with it (decided 21 Nov).
      await auth.signOut();
    } catch (error) {
      showError(error);
    }
  }, [actions.end, t, toast, showError, auth]);

  const resume = useCallback(async () => {
    try {
      await actions.resume.mutateAsync();
      lastActivity.current = clock().getTime();
      lastBeat.current = lastActivity.current;
      toast.success(t('att.toast.resumed'));
    } catch (error) {
      showError(error);
    }
  }, [actions.resume, clock, t, toast, showError]);

  const stayAvailable = useCallback(() => {
    lastActivity.current = clock().getTime();
    setNowMs(lastActivity.current);
    beat();
  }, [clock, beat]);

  const busy = actions.start.isPending || actions.end.isPending || actions.setStatus.isPending || actions.resume.isPending;
  const value = useMemo<AttendanceValue>(
    () => ({
      audience,
      today,
      loading: query.isPending,
      failed: Boolean(query.error),
      phase,
      status,
      busy,
      start,
      pick,
      requestEnd: () => setEndOpen(true),
      resume,
      stayAvailable,
      idle: { open: idle.open, secondsLeft: idle.secondsLeft, quietMinutes: idle.quietMinutes },
    }),
    [audience, today, query.isPending, query.error, phase, status, busy, start, pick, resume, stayAvailable, idle.open, idle.secondsLeft, idle.quietMinutes],
  );

  return (
    <AttendanceContext.Provider value={value}>
      {children}
      <IdlePrompt />
      <BreakPrompt />
      <EndDayDialog open={endOpen} onClose={() => setEndOpen(false)} onConfirm={() => void end()} busy={actions.end.isPending} />
    </AttendanceContext.Provider>
  );
}
