import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PortalKey } from '../portals';

/**
 * Finds the screen component for a design id — no central list to edit.
 * A screen lives at src/screens/<portal>/<DesignId>/index.tsx and default-
 * exports its page component; it is picked up automatically and code-split.
 * Until that file exists the route shows the Placeholder.
 *
 * A design used by two portals (FN-Review is also the CEO's "Month-end
 * review"; CA16-Search backs every portal's search) is built once: the
 * portal's own folder wins, otherwise any portal's folder with that id.
 */
type ScreenModule = { default: ComponentType };
const modules = import.meta.glob<ScreenModule>('./*/*/index.tsx');

const cache = new Map<string, LazyExoticComponent<ComponentType>>();

export function findScreenModulePath(portal: PortalKey, designId: string, available: readonly string[] = Object.keys(modules)): string | null {
  const own = `./${portal}/${designId}/index.tsx`;
  if (available.includes(own)) return own;
  return available.find((p) => p.endsWith(`/${designId}/index.tsx`)) ?? null;
}

export function screenComponent(portal: PortalKey, designId: string): LazyExoticComponent<ComponentType> | null {
  const path = findScreenModulePath(portal, designId);
  if (!path) return null;
  let component = cache.get(path);
  if (!component) {
    component = lazy(modules[path]);
    cache.set(path, component);
  }
  return component;
}
