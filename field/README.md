# Laboura Field — the field agent app

One codebase (Expo, React Native, TypeScript) for:

- **the installed web app** at `https://<laboura-site>/field` — what iPhone users (Sanket) use first, from Safari's *Add to Home Screen*;
- **the Android app** (APK, built later with EAS) and **the iPhone App Store app** (when Laboura buys the Apple account).

Designs: `FA01-Login` … `FA22-VisitProof` (phone screens, approved 9 Nov). The rules come from the Master Guide, "The field agent app (decided 9 Nov)".

```
field/
  app/                    routes (expo-router). Files here are thin: they export a screen.
    (auth)/login.tsx        → src/screens/FA01-Login
    (auth)/login-code.tsx   → src/screens/FA02-LoginCode
    (app)/(tabs)/index.tsx  → src/screens/FA03-Home   (tabs: Home · Visits · Job seekers · Vacancies · Map · Targets)
    (app)/...               other screens (placeholders until built)
  src/
    screens/<FA id>/        one folder per design: index.tsx, hooks, <FA id>.test.tsx
    components/             design-system pieces (Button, Card, ListRow, StatusChip, TopBar, TabBar, …)
    theme/                  colours, fonts, spacing from the FA designs
    api/                    typed API client, endpoints, TanStack Query setup
    auth/                   session (kept on the phone), login, device id
    i18n/                   en.ts (reference), kn.ts, hi.ts, switcher
    device/                 camera (live only, stamped), location (GPS + accuracy), offline-queue
    navigation/routes.ts    every screen's URL
    test/                   Jest setup, renderWithApp(), router mock
  public/icons/           home-screen icons (from the Laboura logo)
  scripts/pwa.js          makes the export installable (manifest, iPhone tags, service worker)
```

## Commands (from the repository root)

| Command | What it does |
| --- | --- |
| `npm run field:install` | Installs the app's packages (`field/node_modules`) |
| `npm run field:dev` | Runs the app in a browser on your computer (`http://localhost:8081/field`) |
| `npm run field:lint` | ESLint + TypeScript check |
| `npm run field:test` | Jest tests (phone, web and script projects) |
| `npm run field:build-web` | `expo export --platform web` → `field/dist`, then `scripts/pwa.js` |
| `npm run build` | The API, the office web app **and** this app (what Render runs) |

The API (Nest) serves `field/dist` at `/field` (`src/modules/field-app/`). Run the API locally and open `http://localhost:3000/field` to use the built app against it. Add or update packages with **npm 11** (`npx npm@11 install …` inside `field/`) and pin exact versions at least two weeks old (`--save-exact --before=<date two weeks ago>`).

## Conventions for screen agents

### 1. One folder per design

Build design `FA05-Visits` in `src/screens/FA05-Visits/`:

- `index.tsx` — the screen (default export). Start with `<AppHeader title=… />` and put the body in `<Screen>`.
- `useVisits.ts` (or similar) — data hooks for this screen.
- `FA05-Visits.test.tsx` — tests (see below).

Then point the route at it: replace the placeholder in `app/(app)/(tabs)/visits.tsx` with
`export { default } from '@/screens/FA05-Visits';`. New URLs go in `src/navigation/routes.ts` with the design id in a comment. Navigate with `router.push(routes.x)` from `expo-router`.

Use the components in `src/components` and the tokens in `src/theme` — never raw hex colours or font names. Everything tappable is at least 48 px tall (`touch.min`). Mobile numbers, money and dates follow the guide's "Forms: rules for every screen" (masked numbers, ₹ boxes, pickers — never typed dates).

### 2. Data fetching

- Add a typed endpoint group in `src/api/endpoints/<module>.ts` (types copied from the Nest service's return type), and register it in `useEndpoints()` (`src/api/ApiProvider.tsx`) and `src/api/endpoints/index.ts`.
- In screens: `const { visits } = useEndpoints();` then `useQuery({ queryKey: queryKeys.x, queryFn: () => visits.list() })`. Put query keys in `queryKeys` (`src/api/queryClient.ts`) so screens invalidate each other.
- Never handle 401: the client signs the agent out and FA01 explains why. Show `LoadingState`, `ErrorState` (with retry) and `EmptyState`.
- Where an endpoint does not exist yet, show `t('common.placeholderValue')` (—) and say so in the screen's doc comment and below. Do not invent numbers.

### 3. Weak signal: the offline queue

Forms and photos are saved on the phone and sent when the signal returns (guide: "Weak signal").

```tsx
const queue = useOfflineQueue();
const result = await queue.submit('Visit · Lakshmi Tiffins', {
  method: 'POST',
  path: `/businesses/${id}/visits`,
  json: { outcome: 'interested', revisitOn },
});
if (result.status === 'queued') showToast(t('fa03.waitingToSend')); // sent later, automatically
```

- Photos: `fields` + `files` instead of `json` (multipart). Use `stampFormFields(photo.stamp)` for the time/GPS fields and `{ field: 'photo', name: 'shop.jpg', type: 'image/jpeg', uri: photo.uri }` for the file.
- A server refusal (4xx) while sending at once is thrown back to the form; one that happens later marks the item *failed* and Home shows it.
- Every queued request carries `Idempotency-Key: <item id>`. **Backend endpoints that accept queued writes should treat a repeated key as a no-op** (not done on the server yet).
- **Steps that need the other person live — OTPs, calls, payment links, login — are never queued.** Wrap them in `queue.live(() => …)`, which throws `NeedsSignalError` without signal; show `t('common.needsSignal')`. The queue refuses those paths (`LIVE_ONLY_PATTERNS`).
- The phone keeps a queued item only until it is sent (the guide says the app keeps nothing on the phone otherwise).

### 4. Camera and GPS

- `<LiveCamera facing="back" label={business.code} onCapture={(photo) => …} />` — the live camera only, never the gallery (there is no image-picker package, and a test checks that). The photo is stamped with the time (IST) and the GPS reading, previewed, and handed over on "Use this photo". In the web app the stamp is drawn on the picture; in the phone app it is sent as upload fields (drawing on the picture there needs a native image library — later).
- `useLocation()` → `read()` gives `{ latitude, longitude, accuracy, level: 'good' | 'fair' | 'poor' }` or an error key to show. Location is read **at events only** (login, visits, calls), never in the background.

### 5. Languages

- Every visible word is a key in `src/i18n/en.ts`, named `<design id lower-case>.<thing>` (e.g. `fa05.revisitDue`) or `common.*` / `status.*` / `tabs.*` / `device.*` for shared words. Add the same key to `kn.ts` and `hi.ts` — TypeScript and `i18n.test.tsx` fail otherwise (same keys, same `{slots}`, not left in English).
- In components: `const { t, tn } = useI18n(); t('fa03.lateBy', { minutes: 12 }); tn('queue.photos', count)`.
- The switcher (ಕನ್ನಡ / हिंदी / EN) is in the header; the choice is remembered on the phone.

### 6. Tests

- `npm run field:test`. Every screen gets a test that renders it with `renderWithApp(<Screen />, { signedInAs: kiran, route })` (`src/test/render.tsx`): `route(url, init)` answers the API calls, and the test checks what was sent and what is shown. Mock the router with `jest.mock('expo-router', () => require('@/test/expo-router-mock'))`.
- Testing Library 14: `await render(…)`, `await fireEvent.press(…)`, `await fireEvent.changeText(…)`.
- Files ending in `.web.test.ts(x)` run as the web app (jsdom); the rest run as the phone app.
- Give important elements a `testID`; tests should read like the guide's rules.

## What FA03 Home still needs from the backend

Real now: attendance (`GET /attendance/today`, `POST /attendance/login` with GPS), placements this month (`GET /targets/dashboard`), the offline queue row. Placeholders until endpoints exist: today's five numbers (shops visited, onboarded, vacancies added, candidates shown, interviews booked), alerts, and to-dos (revisits due, joinings, check-ins).

## Sign-in and the session

- FA01: staff code + password + this phone's id (`laboura_device_id`, the same id the old `/field-agent` console used, so an approved phone stays approved). A new phone must first be approved by the Team Lead; FA01 shows the phone's short id to read out.
- FA02: the 6-digit code the Team Lead reads out (works once, 5 minutes).
- Management accounts (e.g. the CEO) are asked for their authenticator code on FA01 instead of FA02.
- The session is kept on the phone (Keychain/Keystore in the phone app, localStorage in the web app), so closing the app does not sign the agent out. It still ends after **1 hour without activity**, **2 hours after login**, or when the 15-minute access token runs out while the app is closed (the token is refreshed every few minutes while the app is open) — the server enforces the same limits.
- Log out: tap the gold initials in the header → Log out.

## Installing on an iPhone (step by step)

1. On the iPhone, open **Safari** (it must be Safari, not Chrome).
2. Type the Laboura address followed by `/field` — for example `https://app.laboura.in/field` — and open it.
3. Tap the **Share** button (the square with an arrow pointing up, at the bottom of the screen).
4. Scroll down and tap **Add to Home Screen**.
5. The name shows as **Laboura Field**. Tap **Add** (top right).
6. Close Safari. Open **Laboura Field** from the home screen — it opens full screen like an app.
7. Sign in **from the home-screen icon** (not from Safari): the iPhone keeps the home-screen app's storage separate from Safari, so the phone approval and the login belong to the icon. The first time, the Team Lead approves the phone, then reads out the login code.
8. When the app asks for **Location** and **Camera**, tap **Allow** — they are needed for login, shop visits and photos.

To update: nothing to do — the app fetches the new version the next time it opens with signal.

## Android

- **Now:** open the same address in Chrome → menu (⋮) → **Add to Home screen / Install app**.
- **Later — the APK (no Play Store needed):**
  1. Create a free Expo account and install the tools: `npm install -g eas-cli`, then `eas login`.
  2. In `field/`, run `eas build:configure` once (creates `eas.json`), and set the API address for phone builds: `EXPO_PUBLIC_API_URL=https://app.laboura.in` (or `expo.extra.apiUrl` in `app.json`).
  3. Build an installable file: `eas build --platform android --profile preview` (in `eas.json`, the `preview` profile uses `"android": { "buildType": "apk" }`). Expo builds it in the cloud (free plan) and gives a download link.
  4. Send the APK on WhatsApp or copy it by USB; on the phone allow "Install unknown apps" for WhatsApp/Files and open it.
  5. For the Play Store later: `eas build --platform android` (an `.aab`) and `eas submit`, once Laboura's Google Play account exists. For the App Store: `eas build --platform ios` and `eas submit` with the Apple account.
- The phone builds use the same code. Before the first store build: screenshots are blocked on Android and recorded on iPhone (guide: "Field agents' own phones") — that needs a native module and is not in this web-first foundation yet.
