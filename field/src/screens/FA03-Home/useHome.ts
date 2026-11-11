import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import type { AttendanceToday, FieldHome, TargetDashboard } from '@/api/endpoints';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthProvider';
import { readLocation } from '@/device/location/location';
import { locationProvider } from '@/device/location/provider';
import { LocationError } from '@/device/location/types';

/** Attendance for today (login time, status, shift). */
export function useAttendanceToday() {
  const endpoints = useEndpoints();
  return useQuery<AttendanceToday>({
    queryKey: queryKeys.attendanceToday,
    queryFn: () => endpoints.attendance.today(),
  });
}

/** Today's five numbers, alerts, to-dos and the check-in point (GET /field-work/home). */
export function useFieldHome() {
  const { session } = useAuth();
  const endpoints = useEndpoints();
  return useQuery<FieldHome>({
    queryKey: queryKeys.fieldHome,
    queryFn: () => endpoints.fieldWork.home(),
    enabled: session?.staff.role === 'field_agent',
  });
}

/** This month's own targets. Only field and call agents have an "agent" view. */
export function useTargetDashboard() {
  const { session } = useAuth();
  const role = session?.staff.role;
  const endpoints = useEndpoints();
  return useQuery<TargetDashboard>({
    queryKey: queryKeys.targetDashboard,
    queryFn: () => endpoints.targets.dashboard(),
    enabled: role === 'field_agent',
  });
}

/**
 * The green Login button: reads GPS (field agents' location is saved at
 * login — guide, Attendance) and starts the day. Needs signal: attendance
 * times come from the server.
 */
export function useAttendanceLogin() {
  const client = useQueryClient();
  const endpoints = useEndpoints();
  return useMutation<AttendanceToday, Error>({
    mutationFn: async () => {
      const fix = await readLocation(locationProvider);
      const today = await endpoints.attendance.login({ latitude: fix.latitude, longitude: fix.longitude });
      // The day's check-in point with its accuracy (guide: "Check-in: at the start
      // of the day the app records the agent's GPS location"); used by the Team
      // Lead to send the nearest agent. Best effort: the login already counts.
      await endpoints.visits
        .checkIn({ latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: Math.round(fix.accuracy) })
        .catch(() => undefined);
      return today;
    },
    onSuccess: (today) => {
      client.setQueryData(queryKeys.attendanceToday, today);
      void client.invalidateQueries({ queryKey: queryKeys.fieldHome });
    },
  });
}

export function isLocationError(error: unknown): error is LocationError {
  return error instanceof LocationError;
}

/** Placements this month for the progress card. */
export function placementsProgress(dashboard: TargetDashboard | undefined) {
  const metric = dashboard?.agent?.metrics?.placementsClosed;
  const achieved = metric?.achieved ?? dashboard?.agent?.achieved.placementsClosed ?? null;
  const target = metric?.effectiveTarget ?? null;
  if (achieved === null) return null;
  return { achieved, target, ratio: target && target > 0 ? achieved / target : 0 };
}
