import { useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { colors, fonts } from '@/theme';
import { Text } from './Text';

export interface MapMarker {
  key: string;
  latitude: number;
  longitude: number;
  color: string;
  label?: string;
}

interface Props {
  center: { latitude: number; longitude: number };
  /** Blue "you are here" dot with its accuracy circle (metres). */
  me?: { latitude: number; longitude: number; accuracy: number | null } | null;
  markers: MapMarker[];
  height?: number;
  zoom?: number;
  attribution: string;
  testID?: string;
}

const TILE = 256;

function project(lat: number, lng: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/**
 * A small OpenStreetMap map (the guide: a free map service, not Google)
 * drawn from standard map tiles, with coloured shop markers and the agent's
 * blue dot. No map package needed, so it works the same in the phone app
 * and the installed web app.
 */
export function TileMap({ center, me, markers, height = 260, zoom = 16, attribution, testID }: Props) {
  const [width, setWidth] = useState(0);
  const c = project(center.latitude, center.longitude, zoom);
  const left = c.x - width / 2;
  const top = c.y - height / 2;
  const tiles: { x: number; y: number }[] = [];
  if (width > 0) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx += 1) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty += 1) tiles.push({ x: tx, y: ty });
    }
  }
  const metersPerPixel = (156_543.03392 * Math.cos((center.latitude * Math.PI) / 180)) / 2 ** zoom;
  const place = (lat: number, lng: number) => {
    const p = project(lat, lng, zoom);
    return { left: p.x - left, top: p.y - top };
  };
  return (
    <View
      style={[styles.box, { height }]}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
      testID={testID}
      accessibilityRole="image"
    >
      {tiles.map((t) => (
        <Image
          key={`${t.x}-${t.y}`}
          source={{ uri: `https://tile.openstreetmap.org/${zoom}/${t.x}/${t.y}.png` }}
          style={[styles.tile, { left: t.x * TILE - left, top: t.y * TILE - top }]}
          accessibilityIgnoresInvertColors
        />
      ))}
      {width > 0
        ? markers.map((m) => {
            const p = place(m.latitude, m.longitude);
            if (p.left < -20 || p.top < -20 || p.left > width + 20 || p.top > height + 20) return null;
            return (
              <View key={m.key} style={[styles.markerWrap, { left: p.left - 60, top: p.top - 9 }]} pointerEvents="none">
                <View style={[styles.marker, { backgroundColor: m.color }]} />
                {m.label ? (
                  <Text style={styles.markerLabel} numberOfLines={1}>
                    {m.label}
                  </Text>
                ) : null}
              </View>
            );
          })
        : null}
      {width > 0 && me ? (
        <>
          {me.accuracy ? (
            <View
              pointerEvents="none"
              style={[
                styles.accuracy,
                (() => {
                  const r = Math.max(10, Math.min(120, me.accuracy / metersPerPixel));
                  const p = place(me.latitude, me.longitude);
                  return { left: p.left - r, top: p.top - r, width: r * 2, height: r * 2, borderRadius: r };
                })(),
              ]}
            />
          ) : null}
          <View pointerEvents="none" style={[styles.me, { left: place(me.latitude, me.longitude).left - 8, top: place(me.latitude, me.longitude).top - 8 }]} />
        </>
      ) : null}
      <Text style={styles.attribution}>{attribution}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: '#E8EEF8' },
  tile: { position: 'absolute', width: TILE, height: TILE },
  markerWrap: { position: 'absolute', width: 120, alignItems: 'center' },
  marker: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: colors.white },
  markerLabel: {
    marginTop: 2,
    fontFamily: fonts.body700,
    fontSize: 10.5,
    color: colors.ink,
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  accuracy: { position: 'absolute', backgroundColor: 'rgba(0,85,192,0.15)', borderWidth: 1, borderColor: 'rgba(0,85,192,0.35)' },
  me: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: colors.blue, borderWidth: 3, borderColor: colors.white },
  attribution: { position: 'absolute', right: 4, bottom: 2, fontSize: 9, color: colors.soft, backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 3 },
});
