import type { PortalDef } from '../../portals';
import type { ScreenDef } from '../../portals/types';
import { screenComponent } from '../registry';
import { Placeholder, PublicPlaceholder } from './Placeholder';

/** Renders the built screen for a route, or its placeholder. */
export function ScreenRoute({ portal, screen }: { portal: PortalDef; screen: ScreenDef }) {
  const Screen = screenComponent(portal.key, screen.id);
  if (Screen) return <Screen />;
  return portal.key === 'public' ? <PublicPlaceholder screen={screen} /> : <Placeholder screen={screen} />;
}
