/**
 * Rendered once inside the signed-in layout (app/(app)/_layout.tsx). It:
 * - explains, then asks for notification permission at the right moment:
 *   after sign-in with a verified mobile, never on the first screen, and
 *   again at most once a week after "Not now";
 * - registers this phone's push token with the server (PUT /me/device) and
 *   keeps it up to date; sign-out removes it on the server (POST /auth/sign-out);
 * - shows a push that arrives while the app is open, and refreshes the inbox;
 * - opens the right screen when a notification is tapped (deepLinks.ts),
 *   switching to the profile it is about, and marks the message read.
 * It renders nothing except the explanation sheet, when it is shown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, Text } from '@/components';
import { useI18n } from '@/i18n';
import { secureStorage, type KeyValueStore } from '@/lib/storage';
import { colors, space } from '@/theme';
import { targetFor } from './deepLinks';
import { defaultPushApi, type PushApi } from './pushApi';
import { askPermission, currentPermission, ensureAndroidChannels, registerDevice } from './registration';
import { pushText } from './strings';

export const PROMPT_LATER_KEY = 'laboura_push_prompt_later';
const ASK_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const INBOX_QUERY_KEY = ['push', 'inbox'] as const;

// While the app is open a push still shows as a banner (promotions stay silent).
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const category = (notification.request.content.data as Record<string, unknown> | undefined)?.category;
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: category !== 'promotions', shouldSetBadge: false };
  },
});

interface Props {
  api?: PushApi;
  storage?: KeyValueStore;
}

export function PushBridge({ api = defaultPushApi(), storage = secureStorage }: Props) {
  const { account, setActiveProfileId } = useAuth();
  const { language } = useI18n();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState(false);
  const handled = useRef(new Set<string>());
  const ready = Boolean(account?.phoneVerified) && Platform.OS !== 'web';
  const profileIds = account?.profiles.map((p) => p.id).join(',') ?? '';

  const openFromNotification = useCallback(
    (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      const target = targetFor(data);
      if (target.profileId && profileIds.split(',').includes(target.profileId)) setActiveProfileId(target.profileId);
      if (typeof data.messageId === 'string') void api.markRead(data.messageId).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
      router.push(target.route);
    },
    [api, profileIds, queryClient, setActiveProfileId],
  );

  // Permission and token, once signed in with a verified mobile.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      await ensureAndroidChannels(language).catch(() => undefined);
      const state = await currentPermission().catch(() => 'undetermined' as const);
      if (cancelled) return;
      if (state === 'undetermined') {
        const later = Number((await storage.getItem(PROMPT_LATER_KEY)) ?? 0);
        if (!cancelled && Date.now() - later >= ASK_AGAIN_AFTER_MS) setPrompt(true);
        await registerDevice(api, 'undetermined');
        return;
      }
      await registerDevice(api, state);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, api, storage, language]);

  // Arrivals, taps and token changes.
  useEffect(() => {
    if (!ready) return;
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
    });
    const tapped = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    const tokenChanged = Notifications.addPushTokenListener(() => {
      void registerDevice(api, 'granted');
    });
    // The tap that opened the app from closed.
    void Notifications.getLastNotificationResponseAsync()
      .then((last) => {
        if (last) {
          openFromNotification(last);
          Notifications.clearLastNotificationResponse?.();
        }
      })
      .catch(() => undefined);
    return () => {
      received.remove();
      tapped.remove();
      tokenChanged.remove();
    };
  }, [ready, api, queryClient, openFromNotification]);

  const allow = async () => {
    setPrompt(false);
    const state = await askPermission().catch(() => 'undetermined' as const);
    await registerDevice(api, state);
  };

  const later = async () => {
    setPrompt(false);
    await storage.setItem(PROMPT_LATER_KEY, String(Date.now()));
  };

  if (!prompt) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => void later()}>
      <View style={styles.overlay} testID="push-prompt">
        <Card>
          <View style={styles.body}>
            <Text variant="h2">{pushText(language, 'prompt.title')}</Text>
            <Text>{pushText(language, 'prompt.body')}</Text>
            <Button label={pushText(language, 'prompt.allow')} onPress={() => void allow()} fullWidth testID="push-allow" />
            <Button label={pushText(language, 'prompt.later')} variant="secondary" onPress={() => void later()} fullWidth testID="push-later" />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: colors.overlay },
  body: { gap: space.md },
});
