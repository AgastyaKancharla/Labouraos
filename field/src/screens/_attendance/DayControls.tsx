import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, ErrorState, Icon, IconTile, LoadingState, StatusChip, Text, type IconName } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { useAuth } from '@/auth/AuthProvider';
import { queryKeys } from '@/api/queryClient';
import { errorCode, type AttendanceToday } from '@/api/endpoints';
import { LOCATION_ERROR_KEYS } from '@/device/location/useLocation';
import { formatShiftTime, formatTimeIst } from '@/lib/format';
import { attendanceErrorText, isPickableStatus, PICKABLE_STATUSES, statusLabel, type PickableStatus } from '@/lib/status';
import { type Accent, colors, radius, touch } from '@/theme';
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
 * (FA04e) — Master Guide rev 193, 17 Nov: a clear Log in button (once a day,
 * GPS saved), then the login time, on time or late, the status (tap to
 * change; only the seven a person may pick) and a clear Log out button (the
 * old "End my day": it ends the day). After Log out the day shows as ended,
 * with no button: log in again tomorrow. The status picker and Log out are
 * offered only while the day is open, so they never show an error for a day
 * that is not open; if the server says the day is not open (another screen
 * logged out, the night job closed it), the day is simply shown again.
 */
export function DayControls({ testID = 'attendance' }: { testID?: string }) {
  const { t } = useI18n();
  const attendance = useAttendanceToday();
  const login = useAttendanceLogin();
  const client = useQueryClient();

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

  return <OpenDay day={day} testID={testID} />;
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

/** Logged in at …, on time or late, the status chip (tap to change) and Log out. */
function OpenDay({ day, testID }: { day: AttendanceToday; testID: string }) {
  const { t } = useI18n();
  const { attendance } = useEndpoints();
  const auth = useAuth();
  const client = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [ending, setEnding] = useState(false);
  const after = (data: AttendanceToday) => {
    client.setQueryData(queryKeys.attendanceToday, data);
    void client.invalidateQueries({ queryKey: ['field-work'] });
    void client.invalidateQueries({ queryKey: ['attendance', 'month'] });
  };
  /** The day was not open after all (another screen, the night job): show it as it is. */
  const reread = () => void client.invalidateQueries({ queryKey: queryKeys.attendanceToday });
  const change = useMutation<AttendanceToday, Error, string>({
    mutationFn: (status) => attendance.setStatus(status),
    onSuccess: after,
    onError: (error) => (isDayStateError(error) ? reread() : undefined),
  });
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
  // After the allowance: "Back from lunch?" — one tap and he is Available again (decided 21 Nov).
  const breakMinutes = useBreakMinutes(status, day.statusSince);
  const allowance = status === 'lunch' ? day.policy?.lunchMinutes : status === 'short_break' ? day.policy?.shortBreakMinutes : undefined;
  const breakOver = allowance !== undefined && breakMinutes >= allowance;
  const changeError = change.error && !isDayStateError(change.error) ? attendanceErrorText(change.error, 'today.statusFailed', t) : null;
  const endError = end.error && !isDayStateError(end.error) ? attendanceErrorText(end.error, 'day.logoutFailed', t) : null;
  return (
    <View style={styles.bar} testID={`${testID}-logged-in`}>
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
          <StatusChip label={status ? statusLabel(status, t) : t('today.pickStatus')} tone="green" dot />
          <Icon name="chevron-right" size={14} color={colors.greenText} />
        </Pressable>
      </View>
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
      <Button label={t('day.logout')} variant="secondary" icon={<Icon name="clock" color={colors.tomato} />} onPress={() => setEnding(true)} testID={`${testID}-logout`} />
      {changeError || endError ? <Banner tone="error" message={(changeError ?? endError)!} testID={`${testID}-error`} /> : null}

      <Sheet open={picking} onClose={() => setPicking(false)} title={t('today.changeStatus')}>
        {status && !isPickableStatus(status) ? (
          <Text variant="muted" testID="status-automatic">{t('today.statusAutomatic', { status: statusLabel(status, t) })}</Text>
        ) : null}
        <ChoiceList
          choices={STATUS_CHOICES.map((s) => ({ value: s, label: statusLabel(s, t), ...STATUS_ICON[s] }))}
          value={isPickableStatus(status) ? status : null}
          onChange={(s) => {
            setPicking(false);
            if (s !== status) change.mutate(s);
          }}
          testID="status-choice"
        />
      </Sheet>
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
  statusTap: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: touch.min, paddingLeft: 6 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: 16, paddingBottom: 32, gap: 12 },
});
