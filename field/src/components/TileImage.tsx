import { Image, type ImageStyle, type StyleProp } from 'react-native';

/**
 * One OpenStreetMap tile in the phone apps. OSM's tile policy asks apps to
 * say who they are, so the request names Laboura Field and its address
 * (redesign, 16 Nov: "the map pictures are fixed by sending the site address
 * with map requests" — free OpenStreetMap, no sign-up).
 */
export const TILE_HEADERS = { 'User-Agent': 'LabouraField/1.0 (+https://field.laboura.com)', Referer: 'https://field.laboura.com/' };

export function TileImage({ uri, style }: { uri: string; style: StyleProp<ImageStyle> }) {
  return <Image source={{ uri, headers: TILE_HEADERS }} style={style} accessibilityIgnoresInvertColors />;
}
