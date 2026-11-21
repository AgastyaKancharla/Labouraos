import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card, Text } from '@/components';
import { useI18n } from '@/i18n';
import { colors, fonts } from '@/theme';
import { htmlToText } from '@/lib/html';

/**
 * The legal text as the guide shows it everywhere (rev 176): "In short"
 * first, then "Read the full terms". Server HTML comes from its own
 * templates and is shown as plain words.
 */
export function LegalBox({ summaryHtml, bodyHtml, version, testID }: { summaryHtml?: string | null; bodyHtml?: string | null; version?: string | null; testID: string }) {
  const { t } = useI18n();
  const [full, setFull] = useState(false);
  return (
    <View style={styles.gap} testID={testID}>
      {summaryHtml ? (
        <Card title={t('verify.inShort')} accent="royal" testID={`${testID}-short`}>
          <Text>{htmlToText(summaryHtml)}</Text>
        </Card>
      ) : null}
      {bodyHtml ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setFull((v) => !v)} testID={`${testID}-toggle`}>
            <Text style={styles.link}>{full ? t('verify.hideFull') : t('verify.readFull')}</Text>
          </Pressable>
          {full ? (
            <Card testID={`${testID}-full`}>
              <Text variant="muted">{htmlToText(bodyHtml)}</Text>
            </Card>
          ) : null}
        </>
      ) : null}
      {version ? <Text variant="muted">{t('verify.version', { version })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  link: { color: colors.blue, fontFamily: fonts.body700, textDecorationLine: 'underline' },
});
