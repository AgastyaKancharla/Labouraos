import { useState } from 'react';
import { Image, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { Button, Icon, Text, type IconName } from '@/components';
import { useI18n, type MessageKey } from '@/i18n';
import { routes } from '@/navigation/routes';
import { accents, colors, fonts, shadow, space, type Accent } from '@/theme';

const logo = require('../../../assets/logo-mark.png');

const POINTS: { key: string; icon: IconName; accent: Accent; title: MessageKey; body: MessageKey }[] = [
  { key: 'job', icon: 'briefcase', accent: 'royal', title: 'welcome.jobTitle', body: 'welcome.jobBody' },
  { key: 'staff', icon: 'store', accent: 'cyan', title: 'welcome.staffTitle', body: 'welcome.staffBody' },
  { key: 'refer', icon: 'users', accent: 'orange', title: 'welcome.referTitle', body: 'welcome.referBody' },
];

/**
 * Step 1 for everyone (proposal 2.1): the welcome, then one large button to
 * sign in. English only (Master Guide rev 193): no language choice.
 * Version 2: navy with the gold swoosh arc, the logo on a white tile, and
 * three swipeable cards saying what Laboura does for each kind of person.
 */
export default function Welcome() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(320, width - 70);
  const [page, setPage] = useState(0);
  return (
    <View style={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl }]} testID="welcome">
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
          <Circle cx={195} cy={230} r={140} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1.5} />
          <Circle cx={195} cy={230} r={205} fill="none" stroke="rgba(255,255,255,0.045)" strokeWidth={1.5} />
          <Path d="M-20 500 Q195 380 410 500" fill="none" stroke={colors.goldRaw} strokeWidth={3} opacity={0.9} />
          <Path d="M-20 520 Q195 400 410 520" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={2} />
        </Svg>
      </View>
      <View style={styles.brand}>
        <View style={styles.logoTile}>
          <Image source={logo} style={styles.logo} accessibilityLabel={t('common.brand')} />
        </View>
        <Text style={styles.brandName} accessibilityRole="header">
          {t('common.brand')}
        </Text>
        <Text style={styles.tagline}>{t('welcome.tagline')}</Text>
      </View>
      <View style={styles.flex} />
      <Text style={styles.title}>{t('welcome.title')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + 12}
        decelerationRate="fast"
        style={styles.scroller}
        contentContainerStyle={styles.cards}
        onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (cardWidth + 12)))}
        scrollEventThrottle={32}
        testID="welcome-points"
      >
        {POINTS.map((p) => (
          <View key={p.key} style={[styles.card, { width: cardWidth }]} testID={`welcome-point-${p.key}`}>
            <View style={[styles.tile, { backgroundColor: accents[p.accent].bg }]}>
              <Icon name={p.icon} size={24} color={accents[p.accent].fg} />
            </View>
            <Text style={styles.cardTitle}>{t(p.title)}</Text>
            <Text style={styles.cardBody}>{t(p.body)}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {POINTS.map((p, i) => (
          <View key={p.key} style={[styles.dot, i === page && styles.dotOn]} />
        ))}
      </View>
      <View style={styles.actions}>
        <Button label={t('welcome.start')} variant="light" arrow onPress={() => router.push(routes.signIn)} testID="welcome-start" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.navy },
  flex: { flex: 1, minHeight: 16 },
  brand: { alignItems: 'center', gap: 8, paddingTop: 40, paddingHorizontal: space.lg },
  logoTile: { width: 116, height: 116, borderRadius: 34, backgroundColor: colors.white, padding: 8, ...shadow.light },
  logo: { width: 100, height: 100, borderRadius: 28 },
  brandName: { fontFamily: fonts.display800, fontSize: 38, color: colors.white, marginTop: 10, letterSpacing: -0.5 },
  tagline: { fontFamily: fonts.body500, fontSize: 16, color: colors.navSoft },
  title: { fontFamily: fonts.display700, fontSize: 19, color: colors.white, paddingHorizontal: 24, marginBottom: 12 },
  scroller: { flexGrow: 0 },
  cards: { paddingHorizontal: 24, gap: 12, alignItems: 'flex-start' },
  card: { backgroundColor: colors.white, borderRadius: 24, padding: 20, gap: 8, ...shadow.light },
  tile: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  cardTitle: { fontFamily: fonts.display800, fontSize: 20, color: colors.navy },
  cardBody: { fontFamily: fonts.body400, fontSize: 15, lineHeight: 21, color: colors.soft },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 14, marginBottom: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { width: 20, backgroundColor: colors.goldRaw },
  actions: { paddingHorizontal: 20 },
});
