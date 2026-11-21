import { useState } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mapAvailable } from '@/api/config';
import type { Pin } from '@/api/types';
import { readPin } from '@/device/location';
import { useI18n } from '@/i18n';
import { Button } from '../Button';
import { Text } from '../Text';
import { colors, fonts } from '@/theme';

/** Bengaluru, where the map opens when neither GPS nor an area is known. */
const CITY_CENTRE = { latitude: 12.9716, longitude: 77.5946 };
/** About 300 m across: close enough to see the street and the building. */
const CLOSE = { latitudeDelta: 0.003, longitudeDelta: 0.003 };
const AREA = { latitudeDelta: 0.02, longitudeDelta: 0.02 };

/**
 * "Locate me" (Agastya, 22 Nov): one tap reads the phone's GPS, then a small
 * map opens on that spot and the person moves the map until the pin sits
 * exactly on their shop or home, and saves. Without GPS permission the map
 * opens on the chosen area (or the city) instead. The map only downloads
 * when it is opened. A build without a map (Android with no Maps key) keeps
 * the GPS-only pin.
 */
export function PinField({
  label,
  value,
  onChange,
  center,
  testID,
}: {
  label: string;
  value: Pin | null;
  onChange: (pin: Pin | null) => void;
  /** Where the map opens when GPS is not available: the chosen area's centre. */
  center?: { latitude: number; longitude: number } | null;
  testID?: string;
}) {
  const { t } = useI18n();
  const withMap = mapAvailable(Platform.OS);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'denied' | 'error' | null>(null);
  const [mapAt, setMapAt] = useState<Region | null>(null);

  const locate = async () => {
    setBusy(true);
    setProblem(null);
    const result = await readPin();
    setBusy(false);
    if (!withMap) {
      if (result.status === 'ok') onChange(result.pin);
      else setProblem(result.status);
      return;
    }
    if (result.status !== 'ok') setProblem(result.status);
    const start = value ?? (result.status === 'ok' ? result.pin : null);
    if (start) setMapAt({ latitude: start.latitude, longitude: start.longitude, ...CLOSE });
    else setMapAt({ ...(center ?? CITY_CENTRE), ...AREA });
  };

  return (
    <View style={styles.field}>
      <Text variant="small" style={styles.label}>
        {label}
      </Text>
      {value ? (
        <Text variant="small" testID={testID ? `${testID}-saved` : undefined}>
          {value.accuracyM ? t('form.pinSavedAccuracy', { meters: value.accuracyM }) : t('form.pinSaved')}
        </Text>
      ) : (
        <Text variant="muted">{withMap ? t('form.pinHintMap') : t('form.pinHint')}</Text>
      )}
      {problem ? (
        <Text variant="small" accessibilityRole="alert" style={styles.problem}>
          {problem === 'denied' ? (withMap ? t('form.pinDeniedMap') : t('form.pinDenied')) : withMap ? t('form.pinErrorMap') : t('form.pinError')}
        </Text>
      ) : null}
      <Button label={value ? t('form.pinAgain') : t('form.pinUse')} variant="secondary" loading={busy} testID={testID} onPress={() => void locate()} />
      {mapAt ? (
        <MapPicker
          start={mapAt}
          onCancel={() => setMapAt(null)}
          onSave={(pin) => {
            setMapAt(null);
            setProblem(null);
            onChange(pin);
          }}
          testID={testID ? `${testID}-map` : 'pin-map'}
        />
      ) : null}
    </View>
  );
}

/** The map with a pin fixed in the middle: the person moves the map under the pin. */
function MapPicker({ start, onCancel, onSave, testID }: { start: Region; onCancel: () => void; onSave: (pin: Pin) => void; testID: string }) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [region, setRegion] = useState<Region>(start);
  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.mapScreen, { paddingTop: insets.top }]} testID={testID}>
        <View style={styles.mapTop}>
          <Text variant="h2">{t('form.pinMapTitle')}</Text>
          <Text variant="muted">{t('form.pinMapHelp')}</Text>
        </View>
        <View style={styles.mapBox}>
          <MapView
            style={StyleSheet.absoluteFill}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={start}
            onRegionChangeComplete={setRegion}
            showsUserLocation
            showsMyLocationButton
            toolbarEnabled={false}
            testID={`${testID}-view`}
          />
          {/* The pin's point sits exactly on the centre of the map. */}
          <View pointerEvents="none" style={styles.pinWrap}>
            <Text style={styles.pin} accessibilityElementsHidden importantForAccessibility="no">
              📍
            </Text>
          </View>
        </View>
        <View style={[styles.mapActions, { paddingBottom: 16 + insets.bottom }]}>
          <Button
            label={t('form.pinMapSave')}
            onPress={() => onSave({ latitude: Number(region.latitude.toFixed(6)), longitude: Number(region.longitude.toFixed(6)), accuracyM: null })}
            testID={`${testID}-save`}
          />
          <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} testID={`${testID}-cancel`} />
        </View>
      </View>
    </Modal>
  );
}

const PIN_SIZE = 40;

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontFamily: fonts.body700, color: colors.soft, fontSize: 14 },
  problem: { color: colors.tomato },
  mapScreen: { flex: 1, backgroundColor: colors.bg },
  mapTop: { padding: 16, gap: 4 },
  mapBox: { flex: 1 },
  pinWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  // Lift the pin by half its height so its point, not its middle, marks the spot.
  pin: { fontSize: PIN_SIZE, lineHeight: PIN_SIZE + 4, transform: [{ translateY: -PIN_SIZE / 2 }] },
  mapActions: { padding: 16, gap: 10 },
});
