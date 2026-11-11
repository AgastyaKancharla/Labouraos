import { createContext, useContext } from 'react';
import type { PortalDef } from './index';
import { screenPath } from './index';

export const PortalContext = createContext<PortalDef | null>(null);

/** The portal the current screen belongs to. */
export function usePortal(): PortalDef {
  const portal = useContext(PortalContext);
  if (!portal) throw new Error('usePortal must be used inside a portal layout');
  return portal;
}

/** Link to another screen of the same portal by design id: `const to = useScreenPath(); to('C-Refunds')`. */
export function useScreenPath() {
  const portal = usePortal();
  return (screenId: string, params?: Record<string, string>) => screenPath(portal, screenId, params);
}
