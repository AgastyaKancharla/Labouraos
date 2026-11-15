import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { account, bizProfile, jsProfile } from '@/test/fixtures';
import { renderWithApp } from '@/test/render';
import { createMemoryStore } from '@/lib/storage';
import { routes } from '@/navigation/routes';
import { InboxScreen, PushBridge, targetFor } from './index';
import { PROMPT_LATER_KEY } from './PushBridge';
import type { InboxMessage, NotificationSettings, PushApi } from './pushApi';
import { registerDevice } from './registration';
import { PUSH_STRINGS } from './strings';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const listeners: { response?: (r: unknown) => void } = {};
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-phone-123456]' })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn((fn: (r: unknown) => void) => {
    listeners.response = fn;
    return { remove: jest.fn() };
  }),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponse: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', extra: { eas: { projectId: 'test-project-id' } } } },
}));

const message = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  id: 'm-1',
  profileId: null,
  kind: 'refund_paid',
  category: 'service',
  priority: 'normal',
  title: 'ಮರುಪಾವತಿ ಮಾಡಲಾಗಿದೆ',
  body: 'ನಿಮ್ಮ ಮರುಪಾವತಿ ಮಾಡಲಾಗಿದೆ.',
  deepLink: '/home',
  data: {},
  createdAt: '2026-11-20T05:30:00.000Z',
  readAt: null,
  ...over,
});

const settings = (over: Partial<NotificationSettings> = {}): NotificationSettings => ({
  service: true, jobUpdates: true, promotions: false, quietStart: '21:00', quietEnd: '09:00', dailyCap: 3, serviceLocked: false, ...over,
});

function fakePushApi(over: Partial<PushApi> = {}): jest.Mocked<PushApi> {
  return {
    inbox: jest.fn(async () => ({ items: [], nextCursor: null, unreadCount: 0 })),
    markRead: jest.fn(async () => undefined),
    markAllRead: jest.fn(async () => undefined),
    putDevice: jest.fn(async () => undefined),
    removePushToken: jest.fn(async () => undefined),
    settings: jest.fn(async () => settings()),
    updateSettings: jest.fn(async (change) => settings(change)),
    ...over,
  } as jest.Mocked<PushApi>;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete listeners.response;
});

describe('push: where a tap goes', () => {
  it('maps the server deep link to an app route, and never to an unknown address', () => {
    expect(targetFor({ deepLink: '/home', profileId: 'p-js' })).toEqual({ route: routes.home, profileId: 'p-js' });
    expect(targetFor({ deepLink: '/inbox' }).route).toBe(routes.inbox);
    expect(targetFor({ deepLink: 'https://evil.example', kind: 'promotion' }).route).toBe(routes.inbox);
    expect(targetFor({ kind: 'interview_booked' }).route).toBe(routes.home);
    expect(targetFor(null)).toEqual({ route: routes.inbox, profileId: null });
  });

  it('has every push and inbox word in Kannada, Hindi and English', () => {
    const keys = Object.keys(PUSH_STRINGS.en).sort();
    expect(Object.keys(PUSH_STRINGS.kn).sort()).toEqual(keys);
    expect(Object.keys(PUSH_STRINGS.hi).sort()).toEqual(keys);
    for (const key of keys as (keyof typeof PUSH_STRINGS.en)[]) {
      expect(PUSH_STRINGS.kn[key]).not.toBe(PUSH_STRINGS.en[key]);
      expect(PUSH_STRINGS.hi[key]).not.toBe(PUSH_STRINGS.en[key]);
    }
  });
});

describe('push: registering this phone', () => {
  it('sends the Expo push token with the project id from the app config', async () => {
    const api = fakePushApi();
    await expect(registerDevice(api)).resolves.toBe('ExponentPushToken[test-phone-123456]');
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project-id' });
    expect(api.putDevice).toHaveBeenCalledWith(
      expect.objectContaining({ pushToken: 'ExponentPushToken[test-phone-123456]', pushPermission: 'granted', appVersion: '1.0.0' }),
    );
  });

  it('reports a refused permission without a token', async () => {
    const api = fakePushApi();
    await registerDevice(api, 'denied');
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(api.putDevice).toHaveBeenCalledWith(expect.objectContaining({ pushToken: null, pushPermission: 'denied' }));
  });

  it('never throws when the token cannot be had', async () => {
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValueOnce(new Error('no play services'));
    await expect(registerDevice(fakePushApi())).resolves.toBeNull();
  });
});

describe('push: PushBridge', () => {
  it('after sign-in, registers the token when permission is already given', async () => {
    const api = fakePushApi();
    await renderWithApp(<PushBridge api={api} storage={createMemoryStore()} />, { account: account({ profiles: [jsProfile] }) });
    await waitFor(() => expect(api.putDevice).toHaveBeenCalledWith(expect.objectContaining({ pushPermission: 'granted' })));
    expect(screen.queryByTestId('push-prompt')).toBeNull();
  });

  it('explains first, then asks; "Not now" waits a week', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    const api = fakePushApi();
    const storage = createMemoryStore();
    await renderWithApp(<PushBridge api={api} storage={storage} />, { account: account({ profiles: [jsProfile] }), language: 'kn' });
    expect(await screen.findByText(PUSH_STRINGS.kn['prompt.title'])).toBeTruthy();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('push-later'));
    await waitFor(async () => expect(await storage.getItem(PROMPT_LATER_KEY)).toBeTruthy());
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  });

  it('"Allow" asks the phone and registers the token', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    const api = fakePushApi();
    await renderWithApp(<PushBridge api={api} storage={createMemoryStore()} />, { account: account({ profiles: [jsProfile] }) });
    fireEvent.press(await screen.findByTestId('push-allow'));
    await waitFor(() => expect(api.putDevice).toHaveBeenCalledWith(expect.objectContaining({ pushToken: 'ExponentPushToken[test-phone-123456]' })));
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  });

  it('a tap opens the right screen and marks the message read', async () => {
    const api = fakePushApi();
    await renderWithApp(<PushBridge api={api} storage={createMemoryStore()} />, { account: account({ profiles: [jsProfile, bizProfile] }) });
    await waitFor(() => expect(listeners.response).toBeDefined());
    listeners.response!({
      notification: { request: { identifier: 'n-1', content: { data: { messageId: 'm-9', deepLink: '/home', profileId: 'p-biz', kind: 'visit_booked' } } } },
    });
    expect(router.push).toHaveBeenCalledWith(routes.home);
    expect(api.markRead).toHaveBeenCalledWith('m-9');
  });
});

describe('push: InboxScreen', () => {
  it('lists messages in the person\'s language with the unread count, and opens one', async () => {
    const api = fakePushApi({
      inbox: jest.fn(async () => ({ items: [message(), message({ id: 'm-2', readAt: '2026-11-20T06:00:00.000Z', title: 'ಹಳೆಯದು' })], nextCursor: null, unreadCount: 1 })),
    });
    await renderWithApp(<InboxScreen api={api} />, { account: account({ profiles: [jsProfile] }), language: 'kn' });
    expect(await screen.findByText('ಮರುಪಾವತಿ ಮಾಡಲಾಗಿದೆ')).toBeTruthy();
    expect(screen.getByTestId('inbox-unread').props.children).toBe('1 ಓದದವು');
    fireEvent.press(screen.getByTestId('inbox-item-m-1'));
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith('m-1'));
    expect(router.push).toHaveBeenCalledWith(routes.home);
  });

  it('marks all read', async () => {
    const api = fakePushApi({ inbox: jest.fn(async () => ({ items: [message()], nextCursor: null, unreadCount: 1 })) });
    await renderWithApp(<InboxScreen api={api} />, { account: account({ profiles: [jsProfile] }) });
    fireEvent.press(await screen.findByTestId('inbox-mark-all'));
    await waitFor(() => expect(api.markAllRead).toHaveBeenCalled());
  });

  it('shows an empty inbox in Hindi', async () => {
    await renderWithApp(<InboxScreen api={fakePushApi()} />, { account: account({ profiles: [jsProfile] }), language: 'hi' });
    expect(await screen.findByText(PUSH_STRINGS.hi['inbox.empty'])).toBeTruthy();
  });

  it('the Service switch is locked while a guarantee runs; Promotions can be turned on', async () => {
    const api = fakePushApi({ settings: jest.fn(async () => settings({ serviceLocked: true })) });
    await renderWithApp(<InboxScreen api={api} />, { account: account({ profiles: [jsProfile] }) });
    const service = await screen.findByTestId('setting-service');
    expect(service.props.disabled).toBe(true);
    expect(screen.getByText(PUSH_STRINGS.en['settings.serviceLocked'])).toBeTruthy();
    fireEvent(screen.getByTestId('setting-promotions'), 'valueChange', true);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ promotions: true }));
  });
});
