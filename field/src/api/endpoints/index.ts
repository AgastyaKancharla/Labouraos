import { api } from '../index';
import { attendanceApi } from './attendance';
import { authApi } from './auth';
import { targetsApi } from './targets';

/**
 * Typed endpoint groups bound to the app's API client. Add one file per
 * backend module (visits.ts, businesses.ts…) and register it here.
 */
export const endpoints = {
  auth: authApi(api),
  attendance: attendanceApi(api),
  targets: targetsApi(api),
};

export * from './attendance';
export * from './auth';
export * from './targets';
