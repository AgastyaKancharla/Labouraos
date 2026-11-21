import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useEndpoints } from '@/api/ApiProvider';
import { errorCode, type LocatedPin } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { isNeedsSignalError } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import type { MessageKey } from '@/i18n/en';
import { colors } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';
import { TileMap } from './TileMap';

/** Server refusals with a message of their own in the app. */
const KNOWN_CODES = ['MAPS_TEXT_EMPTY', 'MAPS_LINK_INVALID', 'MAPS_LINK_NO_LOCATION', 'MAPS_LINK_UNREACHABLE', 'MAPS_ADDRESS_NOT_FOUND', 'MAPS_LOOKUP_UNAVAILABLE', 'TOO_MANY'] as const;

/**
 * "Set the map pin" (Master Guide rev 204, 21 Nov), the same reader as the
 * office console: a typed address (OpenStreetMap, Bengaluru first), any
 * Google Maps link including short maps.app.goo.gl links shared on WhatsApp,
 * or coordinates. The answer is shown on the map with the address line it
 * matched, and only "Yes, use this pin" passes it on.
 */
export function PinFinder({ label, hint, onConfirm, testID = 'pin-finder' }: { label?: string; hint?: string; onConfirm: (found: LocatedPin) => void; testID?: string }) {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<LocatedPin | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function find() {
    setProblem(null);
    setFound(null);
    if (!text.trim()) return setProblem(t('pin.err.MAPS_TEXT_EMPTY'));
    setBusy(true);
    try {
      setFound(await redesign.locatePin(text.trim()));
    } catch (e) {
      const code = errorCode(e);
      setProblem(
        isNeedsSignalError(e) || (isApiError(e) && e.isNetworkError)
          ? t('common.needsSignal')
          : code && (KNOWN_CODES as readonly string[]).includes(code)
            ? t(`pin.err.${code}` as MessageKey)
            : isApiError(e) && e.message
              ? e.message
              : t('pin.err.MAPS_LINK_UNREACHABLE'),
      );
    } finally {
      setBusy(false);
    }
  }

  const where = found ? `${found.latitude.toFixed(5)}, ${found.longitude.toFixed(5)}` : '';
  return (
    <View style={styles.box} testID={testID}>
      <TextField
        label={label ?? t('pin.label')}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setFound(null);
          setProblem(null);
        }}
        placeholder={t('pin.placeholder')}
        autoCapitalize="none"
        autoCorrect={false}
        hint={hint ?? t('pin.hint')}
        error={problem}
        testID={`${testID}-text`}
      />
      {found ? (
        <View style={styles.confirm} testID={`${testID}-confirm`}>
          <TileMap
            center={found}
            markers={[{ key: 'pin', latitude: found.latitude, longitude: found.longitude, color: colors.tomato, label: '📍' }]}
            attribution={t('fa13.attribution')}
            height={200}
            zoom={16}
            testID={`${testID}-map`}
          />
          <Text variant="bodyStrong">{t('pin.isRight')}</Text>
          <Text variant="small" testID={`${testID}-matched`}>
            {found.matched ?? found.placeName ?? where}
          </Text>
          <Text variant="muted">{t(found.source === 'address' ? 'pin.fromAddress' : found.source === 'link' ? 'pin.fromLink' : 'pin.fromCoords', { where })}</Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label={t('pin.searchAgain')} variant="secondary" onPress={() => setFound(null)} testID={`${testID}-again`} />
            </View>
            <View style={styles.flex}>
              <Button
                label={t('pin.useThis')}
                onPress={() => {
                  onConfirm(found);
                  setFound(null);
                  setText('');
                }}
                testID={`${testID}-use`}
              />
            </View>
          </View>
        </View>
      ) : (
        <Button label={busy ? t('pin.finding') : t('pin.find')} variant="secondary" loading={busy} disabled={!text.trim()} onPress={() => void find()} testID={`${testID}-find`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  confirm: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
