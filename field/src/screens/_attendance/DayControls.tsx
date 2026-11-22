import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, ErrorState, Icon, IconTile, LoadingState, StatusChip, Text, type IconName } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { useAuth } from '@/auth/AuthProvider';
import { queryKeys } from '@/api/queryClient';
import { errorCode, type AttendanceToday } from '@/api/endpoints';
import { LOCATION_ERROR_KEYS } from '@/device/location/useLocation';
import { formatShiftTime, formatTimeIst } from '@/lib/format';
import { attendanceErrorText, isPickableStatus, PICKABLE_STATUSES, statusLabel, type PickableStatus } from '@/lib/status';
import { type Accent, colors, fonts, radius, tones, touch } from '@/theme';
import { ChoiceList } from '../_visits/ChoiceList';
import { isLocationError, useAttendanceLogin, useAttendanceToday } from '../FA03-Home/useHome';

/** The statuses the agent taps to change: exactly the ones a person may pick (fix list A2, lib/status). */
export const STATUS_CHOICES = PICKABLE_STATUSES;
const STATUS_ICON: Record<PickableStatus, { icon: IconName; accent: Accent }> = {
  available: { icon: 'check', accent: 'green' },
  team_meeting: { icon: 'users', accent: 'cyan' },
  training: { icon: 'document', accent: 'royal' },
  one_to_one: { icon: 'user', accent: 'navy' },
  system_problem: { icon: 'wifi-off', accent: 'red' },
  short_break: { icon: 'clock', accent: 'orange' },
  lunch: { icon: 'clock', accent: 'gold' },
};

/**
 * The server's answers that only mean "the day is not open" (17 Nov):
 * DAY_ENDED after Log out or the night job, DAY_NOT_STARTED before Log in,
 * DAY_ALREADY_ENDED for a second Log in. The screen then shows the day as it
 * really is (refetch), never an error.
 */
const DAY_STATE_CODES = new Set(['DAY_ENDED', 'DAY_NOT_STARTED', 'DAY_ALREADY_ENDED']);
export function isDayStateError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== null && DAY_STATE_CODES.has(code);
}

export type DayState = 'not_started' | 'open' | 'ended';
export function dayState(day: Pick<AttendanceToday, 'loginAt' | 'logoutAt'> | undefined | null): DayState {
  if (!day?.loginAt) return 'not_started';
  return day.logoutAt ? 'ended' : 'open';
}

/**
 * The working day, the same on Today (FA03), My day (FA04) and My attendance
 * (FA04e) — Master Guide rev 193, 17 Nov; since 22 Nov (rev 206) the day opens
 * at sign-in in Start of day (no Log in button; the GPS is saved right after,
 * or on "Save my location"), then the login time, on time or late, the status (tap to
 * change; only the seven a person may pick) and a clear Log out button (the
 * old "End my day": it ends the day). After Log out the day shows as ended,
 * with no button: log in again tomorrow. The status picker and Log out are
 * offered only while the day is open, so they never show an error for a day
 * that is not open; if the server says the day is not open (another screen
 * logged out, the night job closed it), the day is simply shown again.
 */
export function DayControls({ testID = 'attendance', compact = false }: { testID?: string; compact?: boolean }) {
  const { t } = useI18n();
  const attendance = useAttendanceToday();
  const login = useAttendanceLogin();
  const client = useQueryClient();
  const auth = useAuth();

  if (attendance.isPending) return <LoadingState compact />;
  if (attendance.isError) return <ErrorState error={attendance.error} onRetry={() => void attendance.refetch()} compact />;
  const day = attendance.data;
  const state = dayState(day);

  const loginError =
    login.error && !isDayStateError(login.error)
      ? isLocationError(login.error)
        ? `${t('fa03.loginNeedsLocation')} ${t(LOCATION_ERROR_KEYS[login.error.code])}`
        : attendanceErrorText(login.error, 'today.loginFailed', t)
      : null;

  if (state === 'not_started' && day.startsAtSignIn) {
    // 22 Nov: the day opens at sign-in (no Log in button); a sign-in from before that signs in again.
    return (
      <View style={styles.gap}>
        <Banner tone="warn" icon="clock" title={t('fa03.notLoggedIn')} message={t('day.signInStarts')} testID={`${testID}-sign-in-starts`} />
        <Button label={t('day.signInAgain')} variant="secondary" onPress={() => void auth.logout()} testID={`${testID}-sign-in-again`} />
      </View>
    );
  }

  if (state === 'not_started') {
    // The agent's own shift when a senior set one (decided 21 Nov), else the company shift.
    const shiftKey = day.ownShift ? 'fa03.ownShift' : 'fa03.shift';
    return (
      <View style={styles.gap}>
        <Banner
          tone="warn"
          icon="clock"
          title={t('fa03.notLoggedIn')}
          message={t(shiftKey, { start: formatShiftTime(day.clocks.shiftStart), end: formatShiftTime(day.clocks.shiftEnd) })}
          testID={`${testID}-not-logged-in`}
        />
        <Button
          label={login.isPending ? t('day.loggingIn') : t('day.login')}
          variant="success"
          icon={<Icon name="check" color={colors.white} />}
          loading={login.isPending}
          onPress={() =>
            login.mutate(undefined, {
              onError: (error) => {
                if (isDayStateError(error)) void client.invalidateQueries({ queryKey: queryKeys.attendanceToday });
              },
            })
          }
          testID={`${testID}-login`}
        />
        {loginError ? <Banner tone="error" message={loginError} testID={`${testID}-login-error`} /> : null}
      </View>
    );
  }

  if (state === 'ended') {
    return <EndedDay day={day} testID={testID} />;
  }

  return <OpenDay day={day} testID={testID} compact={compact} />;
}

/**
 * The ended day. Ended with Log out today (decided 21 Nov): "Resume my day"
 * opens it again — the time in between is not counted and it is recorded.
 */
function EndedDay({ day, testID }: { day: AttendanceToday; testID: string }) {
  const { t } = useI18n();
  const { attendance } = useEndpoints();
  const client = useQueryClient();
  const resume = useMutation<AttendanceToday, Error>({
    mutationFn: () => attendance.resume(),
    onSuccess: (d) => {
      client.setQueryData(queryKeys.attendanceToday, d);
      void client.invalidateQueries({ queryKey: ['field-work'] });
    },
    onError: (error) => (isDayStateError(error) ? void client.invalidateQueries({ queryKey: queryKeys.attendanceToday }) : undefined),
  });
  const resumeError = resume.error && !isDayStateError(resume.error) ? attendanceErrorText(resume.error, 'day.resumeFailed', t) : null;
  return (
    <View style={styles.gap}>
      <Banner
        tone="info"
        icon="clock"
        title={t('day.ended', { start: formatTimeIst(day.loginAt!), end: formatTimeIst(day.logoutAt!) })}
        message={day.canResume ? t('day.resumeNote') : t('day.endedNote')}
        testID={`${testID}-ended`}
      />
      {day.canResume ? (
        <Button
          label={resume.isPending ? t('day.resuming') : t('day.resume')}
          variant="success"
          icon={<Icon name="check" color={colors.white} />}
          loading={resume.isPending}
          onPress={() => resume.mutate()}
          testID={`${testID}-resume`}
        />
      ) : null}
      {resumeError ? <Banner tone="error" message={resumeError} testID={`${testID}-resume-error`} /> : null}
    </View>
  );
}

/** Minutes the current lunch or short break has run, ticking every 30 seconds. */
function useBreakMinutes(status: string | null, since: string | null | undefined): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const onBreak = status === 'lunch' || status === 'short_break';
  useEffect(() => {
    if (!onBreak) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [onBreak, since]);
  if (!onBreak || !since) return 0;
  return Math.max(0, Math.floor((nowMs - Date.parse(since)) / 60_000));
}

/** The status change, so the header's error line can read it (22 Nov evening). */
const STATUS_MUTATION_KEY = ['attendance', 'set-status'] as const;

/** Changing the status: saved on the server, then Today, Visits and the month read again. */
function useStatusChange() {
  const { attendance } = useEndpoints();
  const client = useQueryClient();
  const after = (data: AttendanceToday) => {
    client.setQueryData(queryKeys.attendanceToday, data);
    void client.invalidateQueries({ queryKey: ['field-work'] });
    void client.invalidateQueries({ queryKey: ['attendance', 'month'] });
  };
  /** The day was not open after all (another screen, the night job): show it as it is. */
  const reread = () => void client.invalidateQueries({ queryKey: queryKeys.attendanceToday });
  const change = useMutation<AttendanceToday, Error, string>({
    mutationKey: STATUS_MUTATION_KEY,
    mutationFn: (status) => attendance.setStatus(status),
    onSuccess: after,
    onError: (error) => (isDayStateError(error) ? reread() : undefined),
  });
  return { change, after, reread };
}

/** The status picker: the seven a person may pick; an automatic status is explained first. */
function StatusSheet({ open, onClose, status, onPick }: { open: boolean; onClose: () => void; status: string | null; onPick: (s: string) => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={t('today.changeStatus')}>
      {status && !isPickableStatus(status) ? (
        <Text variant="muted" testID="status-automatic">
          {status === 'start_of_day' ? t('today.statusSignIn') : t('today.statusAutomatic', { status: statusLabel(status, t) })}
        </Text>
      ) : null}
      <ChoiceList
        choices={STATUS_CHOICES.map((s) => ({ value: s, label: statusLabel(s, t), ...STATUS_ICON[s] }))}
        value={isPickableStatus(status) ? status : null}
        onChange={(s) => {
          onClose();
          if (s !== status) onPick(s);
        }}
        testID="status-choice"
      />
    </Sheet>
  );
}

/**
 * The small status button IN the header, just left of the bell (Master Guide,
 * "Laboura Field lists, decided 22 Nov evening"; was under the bell, rev 207):
 * the current status (Travelling, On visit, Active, Start of day…) as a small
 * chip; tap it to open the status picker. Only while the day is open. It
 * shrinks and cuts long words with "…" so the header never scrolls sideways
 * at 360 px. A failed change shows under the header (HeaderStatusError).
 */
export function HeaderStatus({ testID = 'header-status' }: { testID?: string }) {
  const { t } = useI18n();
  const attendance = useAttendanceToday();
  const { change } = useStatusChange();
  const [picking, setPicking] = useState(false);
  const day = attendance.data;
  if (!day || dayState(day) !== 'open') return null;
  const status = day.status;
  const label = status ? statusLabel(status, t) : t('today.pickStatus');
  const tone = tones[status === 'start_of_day' ? 'navy' : 'green'];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('today.changeStatus')}: ${label}`}
        onPress={() => setPicking(true)}
        style={styles.headerTap}
        hitSlop={4}
        testID={testID}
      >
        <View style={[styles.headerChip, { backgroundColor: tone.bg }]} testID={`${testID}-chip`}>
          <View style={[styles.headerDot, { backgroundColor: tone.dot }]} />
          <Text style={[styles.headerChipText, { color: tone.fg }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </Pressable>
      <StatusSheet open={picking} onClose={() => setPicking(false)} status={status} onPick={(s) => change.mutate(s)} />
    </>
  );
}

/** Why the last status change failed, under the header (the chip itself is in the header). */
export function HeaderStatusError({ testID = 'header-status-error' }: { testID?: string }) {
  const { t } = useI18n();
  const latest = useMutationState({ filters: { mutationKey: STATUS_MUTATION_KEY }, select: (m) => ({ status: m.state.status, error: m.state.error }) });
  const last = latest[latest.length - 1];
  if (!last || last.status !== 'error' || !last.error || isDayStateError(last.error)) return null;
  return (
    <View style={styles.headerError}>
      <Text variant="tiny" color={colors.tomato} testID={testID}>
        {attendanceErrorText(last.error, 'today.statusFailed', t)}
      </Text>
    </View>
  );
}

/**
 * Logged in at …, on time or late, the status chip (tap to change) and Log out.
 * `compact` (Today, 22 Nov): only what needs the agent now — Start work,
 * Save my location, Back from lunch — since the status is in the header,
 * Log out in Me and the login time and lateness on My attendance.
 */
function OpenDay({ day, testID, compact = false }: { day: AttendanceToday; testID: string; compact?: boolean }) {
  const { t } = useI18n();
  const { attendance } = useEndpoints();
  const auth = useAuth();
  const [picking, setPicking] = useState(false);
  const [ending, setEnding] = useState(false);
  const { change, after, reread } = useStatusChange();
  const end = useMutation<AttendanceToday, Error>({
    mutationFn: () => attendance.logout(),
    onSuccess: (d) => {
      setEnding(false);
      after(d);
      // Log out ends the working day and the sign-in with it (decided 21 Nov).
      void auth.logout();
    },
    onError: (error) => (isDayStateError(error) ? (setEnding(false), reread()) : undefined),
  });
  const status = day.status;
  // 22 Nov: the day opened at sign-in; a sign-in without a location saves it now (once, then on a tap).
  const saveLocation = useAttendanceLogin();
  const triedLocation = useRef(false);
  const needsLocation = day.locationSaved === false;
  useEffect(() => {
    if (!needsLocation || triedLocation.current) return;
    triedLocation.current = true;
    saveLocation.mutate(undefined, { onError: () => undefined });
  }, [needsLocation, saveLocation]);
  const locationError =
    saveLocation.error && !isDayStateError(saveLocation.error)
      ? isLocationError(saveLocation.error)
        ? `${t('fa03.loginNeedsLocation')} ${t(LOCATION_ERROR_KEYS[saveLocation.error.code])}`
        : attendanceErrorText(saveLocation.error, 'today.loginFailed', t)
      : null;
  // After the allowance: "Back from lunch?" — one tap and he is Available again (decided 21 Nov).
  const breakMinutes = useBreakMinutes(status, day.statusSince);
  const allowance = status === 'lunch' ? day.policy?.lunchMinutes : status === 'short_break' ? day.policy?.shortBreakMinutes : undefined;
  const breakOver = allowance !== undefined && breakMinutes >= allowance;
  const changeError = change.error && !isDayStateError(change.error) ? attendanceErrorText(change.error, 'today.statusFailed', t) : null;
  const endError = end.error && !isDayStateError(end.error) ? attendanceErrorText(end.error, 'day.logoutFailed', t) : null;
  if (compact && status !== 'start_of_day' && !needsLocation && !breakOver && !changeError) return null;
  return (
    <View style={compact ? styles.gap : styles.bar} testID={compact ? `${testID}-prompts` : `${testID}-logged-in`}>
      {compact ? null : (
      <View style={styles.barTop}>
        <IconTile icon="clock" accent="green" size={34} />
        <View style={styles.flex1}>
          <Text variant="bodyStrong">{t('day.loggedIn', { time: formatTimeIst(day.loginAt!) })}</Text>
          <Text variant="small" color={day.lateMinutes > 0 ? colors.tomato : colors.greenText}>
            {day.lateMinutes > 0 ? t('fa03.lateBy', { minutes: day.lateMinutes }) : t('fa03.onTime')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('today.changeStatus')}
          onPress={() => setPicking(true)}
          style={styles.statusTap}
          testID={`${testID}-status`}
        >
          <StatusChip label={status ? statusLabel(status, t) : t('today.pickStatus')} tone={status === 'start_of_day' ? 'navy' : 'green'} dot />
          <Icon name="chevron-right" size={14} color={colors.greenText} />
        </Pressable>
      </View>
      )}
      {status === 'start_of_day' ? (
        <View style={styles.gap} testID={`${testID}-start-of-day`}>
          <Banner tone="warn" icon="clock" title={t('day.startOfDayTitle', { time: day.statusSince ? formatTimeIst(day.statusSince) : '' })} message={t('day.startOfDayBody')} />
          <Button
            label={t('day.startWork')}
            variant="success"
            icon={<Icon name="check" color={colors.white} />}
            loading={change.isPending}
            onPress={() => change.mutate('available')}
            testID={`${testID}-start-work`}
          />
        </View>
      ) : null}
      {needsLocation ? (
        <View style={styles.gap} testID={`${testID}-location`}>
          <Banner tone="warn" icon="clock" message={locationError ?? t('day.locationNeeded')} />
          <Button
            label={saveLocation.isPending ? t('day.savingLocation') : t('day.saveLocation')}
            variant="secondary"
            loading={saveLocation.isPending}
            onPress={() => saveLocation.mutate(undefined, { onError: () => undefined })}
            testID={`${testID}-save-location`}
          />
        </View>
      ) : null}
      {breakOver ? (
        <View style={styles.gap} testID={`${testID}-back-prompt`}>
          <Banner
            tone="warn"
            icon="clock"
            title={status === 'lunch' ? t('day.backFromLunch') : t('day.backFromBreak')}
            message={t('day.breakOver', { minutes: allowance! })}
          />
          <Button
            label={t('day.imBack')}
            variant="success"
            icon={<Icon name="check" color={colors.white} />}
            loading={change.isPending}
            onPress={() => change.mutate('available')}
            testID={`${testID}-back`}
          />
        </View>
      ) : null}
      {compact ? null : (
        <Button label={t('day.logout')} variant="secondary" icon={<Icon name="clock" color={colors.tomato} />} onPress={() => setEnding(true)} testID={`${testID}-logout`} />
      )}
      {changeError || endError ? <Banner tone="error" message={(changeError ?? endError)!} testID={`${testID}-error`} /> : null}

      <StatusSheet open={picking} onClose={() => setPicking(false)} status={status} onPick={(s) => change.mutate(s)} />
      <Sheet open={ending} onClose={() => setEnding(false)} title={t('day.logoutTitle')}>
        <Text variant="muted">{t('day.logoutBody')}</Text>
        <Button label={t('day.logout')} variant="danger" loading={end.isPending} onPress={() => end.mutate()} testID={`${testID}-logout-confirm`} />
        <Button label={t('common.cancel')} variant="secondary" onPress={() => setEnding(false)} />
      </Sheet>
    </View>
  );
}

/** A bottom sheet with a title. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text variant="h2">{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  flex1: { flex: 1 },
  bar: { gap: 10, padding: 12, borderRadius: radius.card, backgroundColor: colors.green100, borderLeftWidth: 4, borderLeftColor: colors.green },
  barTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // In the blue header: a 48 px tap area whose extra height does not grow the header.
  headerTap: { flexShrink: 1, minWidth: touch.min, minHeight: touch.min, marginVertical: -6, justifyContent: 'center', alignItems: 'flex-end' },
  headerChip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 112, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  headerDot: { width: 7, height: 7, borderRadius: 4 },
  headerChipText: { fontFamily: fonts.body700, fontSize: 11, flexShrink: 1 },
  headerError: { alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 4 },
  statusTap: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: touch.min, paddingLeft: 6 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: 16, paddingBottom: 32, gap: 12 },
});
