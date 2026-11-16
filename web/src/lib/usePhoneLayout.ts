import { useSyncExternalStore } from 'react';

/**
 * True when the office portals use their phone layout (the blue LABOURA bar
 * with the menu button), matching the `max-width: 900px` rule in
 * components.css. Used so exactly one notification bell is on the page: the
 * one in the blue bar on a phone, the one in the page heading otherwise.
 * Without `matchMedia` (tests, very old browsers) it says false.
 */
export const PHONE_LAYOUT_QUERY = '(max-width: 900px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const list = window.matchMedia(PHONE_LAYOUT_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function snapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(PHONE_LAYOUT_QUERY).matches;
}

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
