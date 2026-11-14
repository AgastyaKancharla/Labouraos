/**
 * The in-app inbox (route /inbox, docs/customer-app-api.md section 9): every
 * notification, newest first, unread ones marked, tap to open (and mark read),
 * "Mark all as read", older pages on request, and the three notification
 * switches (Service, Job updates, Promotions). Kannada, Hindi and English.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Button, Card, EmptyState, ErrorState, LoadingState, Screen, StatusChip, Text } from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, type Language } from '@/i18n';
import { colors, space } from '@/theme';
import { targetFor } from './deepLinks';
import { INBOX_QUERY_KEY } from './PushBridge';
import { defaultPushApi, type InboxMessage, type NotificationSettings, type PushApi } from './pushApi';
import { pushText } from './strings';

const SETTINGS_QUERY_KEY = ['push', 'settings'] as const;
const LOCALE: Record<Language, string> = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN' };

function when(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(LOCALE[language], {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Unread count for a badge on the bell (the header may use it). */
export function useUnreadCount(api: PushApi = defaultPushApi()): number {
  const { data } = useQuery({ queryKey: [...INBOX_QUERY_KEY, 'unread'], queryFn: () => api.inbox(null, 1), staleTime: 60_000 });
  return data?.unreadCount ?? 0;
}

export function InboxScreen({ api = defaultPushApi() }: { api?: PushApi }) {
  const { language } = useI18n();
  const { account, setActiveProfileId } = useAuth();
  const queryClient = useQueryClient();
  const t = (key: Parameters<typeof pushText>[1], params?: Record<string, string | number>) => pushText(language, key, params);

  const inbox = useInfiniteQuery({
    queryKey: INBOX_QUERY_KEY,
    queryFn: ({ pageParam }) => api.inbox(pageParam, 20),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });

  const markRead = useMutation({ mutationFn: (id: string) => api.markRead(id), onSettled: refresh });
  const markAll = useMutation({ mutationFn: () => api.markAllRead(), onSettled: refresh });

  const open = (message: InboxMessage) => {
    if (!message.readAt) markRead.mutate(message.id);
    const target = targetFor({ ...message.data, deepLink: message.deepLink, kind: message.kind, profileId: message.profileId });
    if (target.profileId && account?.profiles.some((p) => p.id === target.profileId)) setActiveProfileId(target.profileId);
    if (target.route !== '/inbox') router.push(target.route);
  };

  const pages = inbox.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const unread = pages[0]?.unreadCount ?? 0;

  return (
    <View style={styles.flex} testID="inbox-screen">
      <AppHeader title={t('inbox.title')} onBack={() => router.back()} />
      <Screen onRefresh={() => void refresh()} refreshing={inbox.isRefetching}>
        {inbox.isLoading ? (
          <LoadingState />
        ) : inbox.isError ? (
          <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState message={t('inbox.empty')} />
        ) : (
          <View style={styles.list}>
            <View style={styles.toolbar}>
              <Text variant="muted" testID="inbox-unread">
                {t('inbox.unread', { count: unread })}
              </Text>
              {unread > 0 ? (
                <Button label={t('inbox.markAll')} variant="secondary" onPress={() => markAll.mutate()} testID="inbox-mark-all" />
              ) : null}
            </View>
            <Card>
              {items.map((message, index) => (
                <Pressable
                  key={message.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !message.readAt }}
                  onPress={() => open(message)}
                  testID={`inbox-item-${message.id}`}
                  style={({ pressed }) => [styles.row, index < items.length - 1 && styles.divider, pressed && styles.pressed]}
                >
                  <View style={[styles.dot, !message.readAt && styles.dotUnread]} />
                  <View style={styles.text}>
                    <Text variant={message.readAt ? 'body' : 'bodyStrong'}>{message.title}</Text>
                    <Text variant="muted">{message.body}</Text>
                    <Text variant="tiny" color={colors.faint}>
                      {when(message.createdAt, language)}
                    </Text>
                  </View>
                  {message.priority === 'urgent' && !message.readAt ? (
                    <StatusChip label={t('inbox.urgent')} tone="tomato" />
                  ) : !message.readAt ? (
                    <StatusChip label={t('inbox.new')} tone="blue" />
                  ) : null}
                </Pressable>
              ))}
            </Card>
            {inbox.hasNextPage ? (
              <Button label={t('inbox.loadMore')} variant="secondary" onPress={() => void inbox.fetchNextPage()} loading={inbox.isFetchingNextPage} testID="inbox-more" />
            ) : null}
          </View>
        )}
        <NotificationSettingsCard api={api} />
      </Screen>
    </View>
  );
}

/** The three switches (proposal 5.4). Service is locked while a guarantee runs. */
export function NotificationSettingsCard({ api = defaultPushApi() }: { api?: PushApi }) {
  const { language } = useI18n();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState(false);
  const t = (key: Parameters<typeof pushText>[1]) => pushText(language, key);
  const settings = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => api.settings() });
  const save = useMutation({
    mutationFn: (change: Partial<Pick<NotificationSettings, 'service' | 'jobUpdates' | 'promotions'>>) => api.updateSettings(change),
    onMutate: () => setSaveError(false),
    onSuccess: (next) => queryClient.setQueryData(SETTINGS_QUERY_KEY, next),
    onError: () => setSaveError(true),
  });
  if (!settings.data) return null;
  const s = settings.data;
  const row = (key: 'service' | 'jobUpdates' | 'promotions', label: string, help: string, disabled = false) => (
    <View style={styles.switchRow} key={key}>
      <View style={styles.text}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="muted">{help}</Text>
      </View>
      <Switch
        value={s[key]}
        disabled={disabled || save.isPending}
        onValueChange={(value) => save.mutate({ [key]: value })}
        accessibilityLabel={label}
        testID={`setting-${key}`}
      />
    </View>
  );
  return (
    <Card title={t('settings.title')} testID="notification-settings">
      {row('service', t('settings.service'), s.serviceLocked ? t('settings.serviceLocked') : t('settings.serviceHelp'), s.serviceLocked)}
      {row('jobUpdates', t('settings.jobUpdates'), t('settings.jobUpdatesHelp'))}
      {row('promotions', t('settings.promotions'), t('settings.promotionsHelp'))}
      <Text variant="tiny" color={colors.faint}>
        {t('settings.quiet')}
      </Text>
      {saveError ? (
        <Text variant="small" color={colors.tomato} testID="settings-error">
          {t('settings.saveError')}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: space.md },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { opacity: 0.7 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: 'transparent' },
  dotUnread: { backgroundColor: colors.blue },
  text: { flex: 1, gap: space.xxs },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
});
