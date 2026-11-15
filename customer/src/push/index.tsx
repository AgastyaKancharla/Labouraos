/**
 * Agent C's part of the Laboura app: push notifications and the inbox.
 * The rest of the app uses exactly these exports (customer/README.md,
 * "Hand-off to Agent C"):
 *   - InboxScreen: default export of app/(app)/inbox.tsx.
 *   - PushBridge: rendered once in the signed-in layout.
 * Also available: useUnreadCount (a badge for the bell) and
 * NotificationSettingsCard (the three switches, shown on the inbox screen;
 * Settings may show it too).
 *
 * Needs `expo-notifications` in customer/package.json and its plugin in
 * app.config.js (Agent B's files), plus the Firebase google-services.json for
 * Android push and the EAS project id (extra.eas.projectId).
 */
export { InboxScreen, NotificationSettingsCard, useUnreadCount } from './InboxScreen';
export { PushBridge } from './PushBridge';
export { targetFor } from './deepLinks';
