import { createElement } from 'react';
import { StyleSheet, type ImageStyle, type StyleProp } from 'react-native';

/**
 * One OpenStreetMap tile in the installed web app: a plain <img> that sends
 * the site's address (origin only, never the page path) as the Referer, as
 * OSM's tile policy asks of web pages, whatever Referrer-Policy the page has.
 */
export function TileImage({ uri, style }: { uri: string; style: StyleProp<ImageStyle> }) {
  return createElement('img', {
    src: uri,
    alt: '',
    referrerPolicy: 'strict-origin-when-cross-origin',
    draggable: false,
    style: { ...(StyleSheet.flatten(style) as Record<string, unknown>), pointerEvents: 'none', userSelect: 'none' },
  });
}
