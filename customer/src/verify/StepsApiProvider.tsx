import { createContext, useContext, type ReactNode } from 'react';
import { apiBaseUrl, apiMode } from '@/api/config';
import { fileMockPersist } from '@/api/mockPersist';
import { mockStepsApi } from './mockSteps';
import { liveStepsApi, type StepsApi } from './stepsApi';

let defaultApi: StepsApi | null = null;
function defaultStepsApi(): StepsApi {
  defaultApi ??= apiMode() === 'mock' ? mockStepsApi(300, fileMockPersist('laboura-mock-steps.json')) : liveStepsApi(apiBaseUrl());
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
