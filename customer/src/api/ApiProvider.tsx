import { createContext, useContext, type ReactNode } from 'react';
import type { CustomerApi } from './customerApi';
import { defaultCustomerApi } from './index';

const ApiContext = createContext<CustomerApi>(defaultCustomerApi);

/** Tests pass a fake CustomerApi; the app uses the live or mock one (EXPO_PUBLIC_API_MODE). */
export function ApiProvider({ api, children }: { api: CustomerApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

/** `const api = useCustomerApi(); api.home(profileId)` */
export function useCustomerApi(): CustomerApi {
  return useContext(ApiContext);
}
