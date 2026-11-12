import { api } from '../index';
import { attendanceApi } from './attendance';
import { authApi } from './auth';
import { targetsApi } from './targets';
import { fieldWorkApi } from './fieldWork';
import { visitsApi } from './visits';
import { registrationApi } from './registration';
import { sellingApi } from './selling';
import { myAttendanceApi } from './myAttendance';

/**
 * Typed endpoint groups bound to the app's API client. Add one file per
 * backend module (visits.ts, businesses.ts…) and register it here.
 */
export const endpoints = {
  auth: authApi(api),
  attendance: attendanceApi(api),
  targets: targetsApi(api),
  fieldWork: fieldWorkApi(api),
  visits: visitsApi(api),
  registration: registrationApi(api),
  selling: sellingApi(api),
  myAttendance: myAttendanceApi(api),
};

export * from './attendance';
export * from './auth';
export * from './targets';
export * from './fieldWork';
export * from './visits';
export * from './registration';
export * from './selling';
export * from './myAttendance';
