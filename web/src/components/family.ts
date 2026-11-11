import { createContext, useContext } from 'react';

/**
 * Which design family the current page belongs to (see styles/design.css):
 * 'portal' for the CEO/Manager/Team Lead/Finance sidebar screens, 'console'
 * for the call agent console, sign-in screens and public phone pages.
 * AppShell provides it; components read it to pick the matching look
 * (for example Button renders the portal's compact .btn2 or the console's
 * 44 px .btn).
 */
export type DesignFamily = 'portal' | 'console';

export const FamilyContext = createContext<DesignFamily>('console');

export function useFamily(): DesignFamily {
  return useContext(FamilyContext);
}
