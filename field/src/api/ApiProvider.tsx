import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ApiClient } from './client';
import { attendanceApi } from './endpoints/attendance';
import { authApi } from './endpoints/auth';
import { targetsApi } from './endpoints/targets';
import { api as appApi } from './index';

const ApiContext = createContext<ApiClient>(appApi);

/** Tests pass a client wired to a fake fetch; the app uses the default one. */
export function ApiProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  return useContext(ApiContext);
}

/**
 * Typed endpoint groups for screens: `const { attendance } = useEndpoints()`.
 * Add a group here when you add a file in src/api/endpoints/.
 */
export function useEndpoints() {
  const api = useApi();
  return useMemo(
    () => ({
      auth: authApi(api),
      attendance: attendanceApi(api),
      targets: targetsApi(api),
    }),
    [api],
  );
}
