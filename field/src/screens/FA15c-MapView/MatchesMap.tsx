import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import type { MatchCard } from '@/api/endpoints';
import { Text } from '@/components';
import { useI18n } from '@/i18n';
import { colors, fonts, radius } from '@/theme';

const SIZE = 340;
const KM_PER_DEG = 111.32;

/** Where a candidate sits around the business, in km east / north (rough area only). */
export function offsetKm(
  business: { latitude: number | null; longitude: number | null },
  match: MatchCard,
  index: number,
): { x: number; y: number } {
  const { latitude, longitude } = match.area;
  if (business.latitude !== null && business.longitude !== null && latitude !== null && longitude !== null) {
    const x = (longitude - business.longitude) * KM_PER_DEG * Math.cos((business.latitude * Math.PI) / 180);
    const y = (latitude - business.latitude) * KM_PER_DEG;
    if (Math.hypot(x, y) > 0.05) return { x, y };
  }
  // No usable area: put him at his distance, spread around the circle.
  const angle = (index * 2 * Math.PI) / 3 + Math.PI / 4;
  const d = Math.max(0.5, match.card.distanceKm);
  return { x: d * Math.cos(angle), y: d * Math.sin(angle) };
}

/** Two rings: a round step and twice it, so the farthest candidate is inside the outer ring. */
export function ringsFor(maxKm: number): [number, number] {
  const step = Math.max(1, Math.ceil(maxKm / 2));
  return [step, step * 2];
}

/**
 * FA15c — the 3 candidates around the business: the business in the middle,
 * each candidate at his rough area (about 1 km), never his home. Drawn
 * without map tiles, so it works on weak signal.
 */
export function MatchesMap({ business, matches, onOpen }: {
  business: { name: string; latitude: number | null; longitude: number | null };
  matches: MatchCard[];
  onOpen: (match: MatchCard) => void;
}) {
  const { t } = useI18n();
  const points = matches.map((m, i) => ({ m, ...offsetKm(business, m, i) }));
  const max = Math.max(1, ...points.map((p) => Math.hypot(p.x, p.y)));
  const [inner, outer] = ringsFor(max);
  const half = SIZE / 2;
  const scale = (half - 34) / outer;
  const bgs = [colors.cyan100, colors.amber100, colors.green100];
  return (
    <View style={styles.wrap} testID="matches-map" accessibilityLabel={t('fa15c.mapLabel')}>
      <Svg width="100%" height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={StyleSheet.absoluteFill}>
        {Array.from({ length: 11 }, (_, i) => (
          <Line key={`v${i}`} x1={i * 34} y1={0} x2={i * 34} y2={SIZE} stroke={colors.border} strokeWidth={1} />
        ))}
        {Array.from({ length: 11 }, (_, i) => (
          <Line key={`h${i}`} x1={0} y1={i * 34} x2={SIZE} y2={i * 34} stroke={colors.border} strokeWidth={1} />
        ))}
        <Circle cx={half} cy={half} r={inner * scale} stroke="#9DB3DE" strokeWidth={2} strokeDasharray="6 6" fill="none" />
        <Circle cx={half} cy={half} r={outer * scale} stroke="#9DB3DE" strokeWidth={2} strokeDasharray="6 6" fill="none" />
      </Svg>
      <View style={[styles.pin, { left: `${50}%`, top: half - 20 }]} pointerEvents="none">
        <View style={styles.biz}>
          <Text style={styles.bizText}>B</Text>
        </View>
        <Text style={styles.tag} numberOfLines={1}>
          {business.name}
        </Text>
      </View>
      {points.map(({ m, x, y }, i) => (
        <Pressable
          key={m.jobSeekerId}
          accessibilityRole="button"
          accessibilityLabel={`${m.card.firstName} · ${m.card.distanceKm} km`}
          onPress={() => onOpen(m)}
          style={[styles.pin, { left: `${((half + x * scale) / SIZE) * 100}%`, top: half - y * scale - 22 }]}
          testID={`map-candidate-${m.jobSeekerId}`}
        >
          <View style={[styles.person, { backgroundColor: bgs[i % 3] }, m.liked && styles.liked]}>
            <Text style={styles.personText}>{m.card.firstName[0]?.toUpperCase()}</Text>
          </View>
          <Text style={styles.tag} numberOfLines={1}>
            {`${m.card.firstName} · ${m.card.distanceKm} km`}
          </Text>
        </Pressable>
      ))}
      <Text style={styles.legend}>{t('fa15c.rings', { inner, outer })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: SIZE,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#E9EFFA',
    overflow: 'hidden',
  },
  pin: { position: 'absolute', alignItems: 'center', width: 140, marginLeft: -70 },
  biz: { width: 36, height: 36, borderRadius: 8, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  bizText: { color: colors.white, fontFamily: fonts.display700, fontSize: 15 },
  person: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liked: { borderColor: colors.tomato },
  personText: { fontFamily: fonts.display700, color: colors.navy },
  tag: {
    marginTop: 4,
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontFamily: fonts.body700,
    fontSize: 11.5,
    color: colors.ink,
    overflow: 'hidden',
  },
  legend: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 11,
    color: colors.soft,
  },
});
