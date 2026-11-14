# Laboura — the customer app

One native app (Expo SDK 58, React Native, TypeScript — the same versions as Laboura Field) for **job seekers, businesses and referral partners**. Android and iPhone from one codebase, for the Play Store and the App Store (owner decision D1, 14 Nov). Not a web app.

The rules come from the confirmed customer app proposal (14 Nov, "All recommended OK": every recommendation and C1–C24) and the Master Guide. The server side is the contract in [`docs/customer-app-api.md`](../docs/customer-app-api.md) (`/customer-api/v1`).

```
customer/
  app/                     routes (expo-router); each file only exports a screen
    (auth)/welcome, sign-in, sign-in-phone      signed out
    (app)/...                                   signed in (guards: verified phone first)
    sheet-done.tsx         laboura://sheet-done — a link page sends the person back here
  src/
    api/                   typed client: customerApi.ts (the interface), live.ts (the contract),
                           mock.ts (pretend data), client.ts (HTTP, refresh, installation header),
                           errorText.ts (contract error codes → the app's own words)
    auth/                  session (tokens only, 90 days), Google, Apple, installation id
    sheet/openSheet.ts     the secure browser sheet (see below)
    screens/<Name>/        one folder per screen, with its tests
    components/            copied from Laboura Field (Button, Card, TextField, CodeInput, form pickers…)
    theme/                 copied from Laboura Field (one text size larger)
    i18n/                  en.ts (reference), kn.ts, hi.ts — copied set-up from Laboura Field
    push/                  OWNED BY AGENT C (notifications) — placeholder here
```

Building blocks, API client pattern, theme and language set-up are **copies** of Laboura Field's, not imports, so the two apps stay independent (proposal 8.2). Nothing in `field/` is used at run time.

## Screens

| Route | Screen | What it does |
| --- | --- | --- |
| `/welcome` | Welcome | Kannada / Hindi / English, three large buttons |
| `/sign-in` | SignIn | Continue with Google · Continue with mobile number · Sign in with Apple (iPhone, once the server supports it). Google is hidden when `GET /config` says it is off |
| `/sign-in-phone` | SignInPhone | +91 mobile, OTP (resend after 30 s, at most 3), the "Laboura may call me to help me finish" tick |
| `/verify-phone` | VerifyPhone | After Google/Apple: the mobile + OTP **before any profile**; says "We found your registration JS-…" when an agent already registered that number |
| `/role` | RolePicker | "I want a job" / "I need staff" / "I refer people and earn"; starts the sign-up on the server (tracker stage A) |
| `/profiles` | MyProfiles | Every profile of this account, switch, "+ Add another" |
| `/register/job-seeker` | RegisterJobSeeker | Date of birth first (under 18 stops, nothing kept), then the agent form's fields, saved on the phone as typed; a fresh OTP confirms; then consent → selfie → ID → ₹499 in the secure sheet |
| `/register/business` | RegisterBusiness | Contact person, business, address and pin, optional documents, staff rows (become draft vacancies), billing email, preferred visit time; fresh OTP; then the agreement in the sheet. Households hidden (C24) |
| `/register/referral` | RegisterReferral | Individual or business, area, language, WhatsApp; fresh OTP; then terms, selfie, ID, UPI in the sheet |
| `/vacancy/new` | AddVacancy | Vacancy draft with the market range and the **legal minimum wage warning + tick**; confirmed by a fresh OTP; `?vacancyId=` confirms a draft from registration |
| `/home` | Home | By profile kind — job seeker: steps, "Paid — confirming", day X of 30, hits, interview (business name **only once booked**), refund status · business: tracker, visit, approval, vacancies, counts (no candidate data, never a phone number) · partner: link + QR + WhatsApp text, people referred (first name + stage only), money due/approved/paid statement |
| `/help` | Help | "Call me back" (topic; now or a time window 9 AM–9 PM) and short answers |
| `/privacy` | Privacy | What is kept and never kept, grievance contact, policy link, "Delete my account" |
| `/delete-account` | DeleteAccount | Big warning + tick while the ₹499 guarantee runs (ends the refund), fresh OTP, what the law keeps |
| `/settings` | Settings | Language (also saved on the account), version, sign out |
| `/inbox` | Agent C's InboxScreen | Messages (placeholder until Agent C's PR) |

Large-text friendly: one step larger than Field, 52 px touch targets, everything grows with the phone's font setting. Low data: no maps or images downloaded (the pin is one GPS reading), fonts bundled, answers cached 60 s, no refetch on every focus.

## The secure browser sheet (consent, selfie, ID, payment, agreement)

For this first version the verification steps are the **existing link pages** (`/p/register/…`, `/p/partner/…`, `/p/agreement/…`), opened inside the app. The server issues a fresh link for the signed-in person (`POST /me/profiles/:id/links`).

- **Android: Chrome Custom Tabs** (`expo-web-browser` `openAuthSessionAsync`). **iPhone: SFSafariViewController** (`openBrowserAsync` — the auth session would show a "wants to use … to sign in" prompt).
- **Why not a WebView: the camera.** Custom Tabs and the Safari sheet run the page in the real browser, which asks for camera permission itself, so the live selfie and the Aadhaar QR scan (`getUserMedia`) work. A WebView needs extra native permission code on both platforms. UPI links (`upi://…`) also open the UPI app from the browser, and the app cannot read the payment, Aadhaar or agreement pages.
- **Coming back:** every link gets `?app=1&returnTo=laboura://sheet-done`. When the page goes there, the sheet closes and Home shows. When the person just closes the sheet, Home reloads too. Home also reloads whenever the app comes back to the front.
- **Fallback:** a phone with no in-app browser opens the page in its normal browser; Home says "come back when done" and refreshes on return. *For a "Back to the Laboura app" button on the link pages, `web/` must honour `returnTo` — not done here (outside this folder).*
- Only `https` links on the link-pages address (`EXPO_PUBLIC_LINK_PAGES_URL`, default the API address) are opened.
- To be proven on real phones (day 3 of the plan): camera in the sheet on a cheap Android and on iPhone.

## Data: live API or pretend data

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Server address. Test setup: `https://app.laboura.com`. The app calls `<this>/customer-api/v1` |
| `EXPO_PUBLIC_API_MODE` | `live` (default) or `mock` — pretend data, no server: every OTP is `123456`; a number ending `0000` "already has" JS-1234; opening the sheet pretends the steps were done |
| `EXPO_PUBLIC_LINK_PAGES_URL` | Where `/p/...` pages live (defaults to the API address) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Optional: otherwise taken from the server's `GET /config` |
| `GOOGLE_IOS_URL_SCHEME` | iPhone only, at build time: the iOS client id reversed |
| `LABOURA_ANDROID_PACKAGE`, `LABOURA_IOS_BUNDLE_ID` | Override the placeholder ids (`com.laboura.app`) |
| `EXPO_PUBLIC_PRIVACY_URL` | Privacy policy page (default `https://laboura.com/privacy`) |
| `GOOGLE_SERVICES_JSON` | Path to Firebase's `google-services.json` (Android push). On EAS a "file" environment variable; locally `./google-services.json` if present. Never committed; without it the app still builds, just without Android push |
| `EAS_PROJECT_ID` | The Expo project id from `eas init`; written to `extra.eas.projectId` (push tokens need it). Set it in the EAS project's environment variables or `eas.json` `env` |

The HTTP client sends `X-Laboura-Installation` (a random id per install) on every request, renews the 15-minute access token with the refresh token on `401 CUSTOMER_TOKEN_EXPIRED` (once, then retries), and signs out on any other 401. Screens never show the server's English `message`: they choose their own words from the error `code` (`src/api/errorText.ts`).

### Asked of Agent A (not in the v1 contract yet)

1. **`GET /me/form-options` → `{ areas: [{name, pincode, latitude, longitude}], trades: [{id, name, salaryMinPaise, salaryMaxPaise, legalMinimumPaise}] }`** — the forms need the managed area and trade lists and the salary hints; today those endpoints are staff-only. Until it exists, the live forms show "not ready yet".
2. **`POST /auth/apple`** (`{ identityToken, fullName, device, language }` → session answer) and **`appleSignIn: true`** in `GET /config`. The Apple button stays hidden until then.
3. Referral home: signed terms and consent copies (`documents: [{id, kind, signedAt}]` and a link purpose `document`). The app shows them when present.
4. A landing page for the partner link `/r/<RF- code>` (in `web/`, per the contract note) — the QR points there.

## Commands (inside `customer/`)

| Command | What it does |
| --- | --- |
| `npx npm@11 ci` | Install (use npm 11; pin exact versions at least two weeks old when adding: `npx npm@11 install --save-exact --before=<date>`) |
| `npm run start:mock` | Start with pretend data (open in a development build; Expo Go works except Google sign-in) |
| `npm run lint` · `npm run typecheck` · `npm test` | What CI runs (job "Customer app" in `.github/workflows/test.yml`) |

## Building the Android test app (APK)

`eas.json` profiles: `preview` (installable **APK**, live API on the test setup), `preview-mock` (APK with pretend data), `development` (dev client), `production` (Play Store bundle).

```
npm install -g eas-cli      # once
eas login                   # the Laboura Expo account
eas init                    # once: creates the Expo project; copy the project id it prints into
                            # EAS_PROJECT_ID (the config is dynamic, so eas init cannot write it itself)
eas build -p android --profile preview
```

EAS builds in the cloud (free plan: 15 Android builds a month) and gives a download link and QR code.

## What the owner sets up (plain words)

1. **Expo account** (free) at expo.dev with a Laboura email. Then Claude runs `eas init` once.
2. **Confirm the app ids.** Placeholders: Android package `com.laboura.app`, iPhone bundle id `com.laboura.app`. They can never change after the first store upload.
3. **Google project** (free) at console.firebase.google.com (or console.cloud.google.com), with a Google account made for Laboura. In "APIs & Services → Credentials" create OAuth client ids:
   - **Web application** — its id goes on the server as `GOOGLE_CLIENT_ID_WEB` (the app reads it from `GET /config`).
   - **Android** — package `com.laboura.app` plus the **SHA-1 fingerprint**: after the first `eas build`, run `eas credentials -p android` → the build profile → copy "SHA1 Fingerprint", paste it into the Android client. Put this id on the server as `GOOGLE_CLIENT_ID_ANDROID`. (Later, the Play Store's own "App signing" SHA-1 must be added too.)
   - **iOS** (later, with the Apple account) — bundle id `com.laboura.app`; id → `GOOGLE_CLIENT_ID_IOS`, and its reversed form → `GOOGLE_IOS_URL_SCHEME` for iPhone builds.
   - The OAuth consent screen needs the app name, a support email and the privacy policy link.
4. **Firebase for notifications** (Agent C): in the same Firebase project add an Android app with package `com.laboura.app`, download `google-services.json`, and upload it to the Expo project as a **file** environment variable named `GOOGLE_SERVICES_JSON` (expo.dev → project → Environment variables). Never commit it (it is in `.gitignore`). Then give Expo the FCM key: `eas credentials -p android` → Push Notifications → upload the Firebase service-account key.
5. **EAS project id**: after `eas init`, set `EAS_PROJECT_ID` to the id it prints (Expo environment variables, or `env` in `eas.json`). Without it the app runs but cannot get a push token.
6. **Apple** (after testing, in the company's name): developer account → Sign in with Apple, iPhone push, TestFlight.

## Hand-off to Agent C (notifications)

- `customer/src/push/` is **Agent C's**. This branch only has a placeholder `src/push/index.tsx`; on a merge conflict there, take Agent C's version.
- The rest of the app relies on exactly two exports from `@/push`:
  - `InboxScreen` — default export of `app/(app)/inbox.tsx` (the bell in the header opens it, route `routes.inbox`).
  - `PushBridge` — rendered once inside the signed-in layout (`app/(app)/_layout.tsx`); asks for permission, registers the token (`PUT /me/device`), routes taps (`deepLink`) with `router.push`. Renders nothing visible.
- They may use `useCustomerApi()` / `httpClient` from `@/api`, `useAuth()` from `@/auth/AuthProvider` (account, active profile, `sessionStore` token), `useI18n()` and `routes`. Notification wording lives in Agent C's files; screen wording here.
- Sign-out already calls `POST /auth/sign-out`, which removes this phone's push token on the server.
- Notification settings switches belong on Settings: Agent C may add a section there or a route.
- Done on this branch for Agent C: `expo-notifications` 58.1.7 (the SDK 58 version) in `package.json`; the `expo-notifications` plugin (`color #0055C0`, `defaultChannel: service`) and `android.googleServicesFile` (only when the file exists) in `app.config.js`; `extra.eas.projectId` from `EAS_PROJECT_ID`; Jest mocks for `expo-notifications` and `expo-constants` in `src/test/setup.tsx`.
