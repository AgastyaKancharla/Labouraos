import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { apiMode } from '@/api/config';
import { useI18n } from '@/i18n';
import { colors, fonts } from '@/theme';
import { Text } from './Text';

/**
 * Version 2: where partner ads will go (a 3:1 banner, always marked
 * "Sponsored", never above what the person came to do). There are no ads
 * yet, so the live app shows nothing here; the test app shows the empty
 * space so the layout can be judged.
 */
export function AdSlot({ testID }: { testID?: string }) {
  const { t } = useI18n();
  if (apiMode() !== 'mock') return null;
  return (
    <View style={styles.ad} testID={testID} accessibilityLabel={`${t('ad.sponsored')}. ${t('ad.placeholderTitle')}`}>
      <View style={styles.art} pointerEvents="none">
        <Svg width={150} height={150} viewBox="0 0 150 150">
          <Circle cx={96} cy={92} r={70} fill="#FFD8A8" />
          <Circle cx={118} cy={56} r={32} fill="#FDBA74" />
          <Rect x={52} y={78} width={50} height={50} rx={14} fill="#FB923C" />
        </Svg>
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('ad.placeholderTitle')}</Text>
        <Text style={styles.body}>{t('ad.placeholderBody')}</Text>
      </View>
      <View style={styles.tag}>
        <Text style={styles.tagText}>{t('ad.sponsored')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ad: {
    height: 132,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#FFF1DE',
    justifyContent: 'center',
    paddingHorizontal: 20,
    boxShadow: '0 0 0 1px rgba(194,65,12,0.10), 0 12px 28px -18px rgba(194,65,12,0.45)',
  },
  art: { position: 'absolute', right: -14, bottom: -14 },
  text: { maxWidth: 200, gap: 4 },
  title: { fontFamily: fonts.display800, fontSize: 18, color: '#3B1D08' },
  body: { fontFamily: fonts.body500, fontSize: 13.5, color: '#6B3B17' },
  tag: { position: 'absolute', top: 10, right: 10, paddingHorizontal: 8, height: 22, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.88)', justifyContent: 'center' },
  tagText: { fontFamily: fonts.body600, fontSize: 11, color: colors.ink },
});
