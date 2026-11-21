import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';
import { Banner } from '@/components';
import { useOptionalOfflineQueue } from '@/device/offline-queue';

/** How long "Saved — will send when online" stays after a tap was saved on the phone. */
export const QUEUED_NOTICE_MS = 6_000;

/**
 * Under the header of every signed-in screen (21 Nov, M11): "No signal…" while
 * the phone is offline, and "Saved — will send when online" for a few seconds
 * after a tap was saved on the phone instead of sent.
 */
export function OfflineNotices() {
  const { t } = useI18n();
  const queue = useOptionalOfflineQueue();
  const lastAt = queue?.lastQueued?.at ?? 0;
  // The notice for the tap at `lastAt` hides itself after a few seconds.
  const [hiddenFor, setHiddenFor] = useState(0);
  useEffect(() => {
    if (!lastAt) return;
    const timer = setTimeout(() => setHiddenFor(lastAt), QUEUED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [lastAt]);
  if (!queue) return null;
  const showQueued = lastAt > 0 && hiddenFor !== lastAt;
  if (queue.online && !showQueued) return null;
  return (
    <View style={styles.box}>
      {!queue.online ? <Banner tone="info" icon="wifi-off" message={t('common.offline')} testID="offline-banner" /> : null}
      {showQueued ? <Banner tone="ok" icon="wifi-off" message={t('common.savedOffline')} testID="queued-notice" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
});
