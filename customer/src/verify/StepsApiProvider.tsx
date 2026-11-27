import { createContext, useContext, type ReactNode } from 'react';
import { apiBaseUrl, apiMode } from '@/api/config';
import { liveStepsApi, type StepsApi } from './stepsApi';

let defaultApi: StepsApi | null = null;
function defaultStepsApi(): StepsApi {
  // Pretend link endpoints only in local development; the release bundler drops them.
  defaultApi ??=
    __DEV__ && apiMode() === 'mock'
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('./mockSteps') as typeof import('./mockSteps')).mockStepsApi(
          300,
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('@/api/mockPersist') as typeof import('@/api/mockPersist')).fileMockPersist('laboura-mock-steps.json'),
        )
      : liveStepsApi(apiBaseUrl());
  return defaultApi;
}

const StepsApiContext = createContext<StepsApi | null>(null);

/** Tests pass a fake; the app uses the live link endpoints (or pretend ones in mock mode). */
export function StepsApiProvider({ api, children }: { api: StepsApi; children: ReactNode }) {
  return <StepsApiContext.Provider value={api}>{children}</StepsApiContext.Provider>;
}

export function useStepsApi(): StepsApi {
  return useContext(StepsApiContext) ?? defaultStepsApi();
}
