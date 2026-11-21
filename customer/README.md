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
    verify/                the verification steps' building blocks: link-endpoint client (stepsApi.ts),
                           pretend steps (mockSteps.ts), live camera, Aadhaar QR scanner, ID panel, photo prep
    sheet/openSheet.ts     the secure browser sheet (documents and the e-Aadhaar PDF only; see below)
    screens/<Name>/        one folder per screen, with its tests
    components/            copied from Laboura Field (Button, Card, TextField, CodeInput, form pickers…)
    theme/                 copied from Laboura Field (one text size larger)
    i18n/                  en.ts — every word the app shows. English only (Master Guide rev 193, 17 Nov):
                           no other languages, no language setting
    push/                  notifications: inbox, the three notification switches, push token, deep links
```

Building blocks, API client pattern and theme are **copies** of Laboura Field's, not imports, so the two apps stay independent (proposal 8.2). Nothing in `field/` is used at run time.

## Screens

| Route | Screen | What it does |
| --- | --- | --- |
| `/welcome` | Welcome | One large “Get started” button (English only, rev 193) |
| `/sign-in` | SignIn | Continue with Google · Continue with mobile number · Sign in with Apple (iPhone, once the server supports it). Google is hidden when `GET /config` says it is off |
| `/sign-in-phone` | SignInPhone | +91 mobile, OTP (resend after 30 s, at most 3), the "Laboura may call me to help me finish" tick |
| `/verify-phone` | VerifyPhone | After Google/Apple: the mobile + OTP **before any profile**; says "We found your registration JS-…" when an agent already registered that number |
| `/role` | RolePicker | "I want a job" / "I need staff" / "I refer people and earn"; starts the sign-up on the server (tracker stage A) |
| `/profiles` | MyProfiles | Every profile of this account, switch, "+ Add another" |
| `/register/job-seeker` | RegisterJobSeeker | Date of birth first (under 18 stops, nothing kept), then the agent form's fields, saved on the phone as typed; a fresh OTP confirms; then consent → selfie → ID → ₹499 in the app's own screens (`/verify/registration`) |
| `/register/business` | RegisterBusiness | Contact person, business, address and pin, optional documents, staff rows (become draft vacancies), billing email, preferred visit time; fresh OTP; then the agreement in the app (`/verify/business_agreement`). Households hidden (C24) |
| `/register/referral` | RegisterReferral | Individual or business, area, language, WhatsApp; fresh OTP; then terms, selfie, ID, UPI in the app (`/verify/referral_registration`) |
| `/vacancy/new` | AddVacancy | Vacancy draft with the market range and the **legal minimum wage warning + tick**; confirmed by a fresh OTP; `?vacancyId=` confirms a draft from registration |
| `/home` | Home | By profile kind — job seeker: steps, "Paid — confirming", day X of 30, hits, interview (business name **only once booked**), refund status · business: tracker, visit, approval, vacancies, counts (no candidate data, never a phone number) · partner: link + QR + WhatsApp text, people referred (first name + stage only), money due/approved/paid statement |
| `/workers` | WorkerLeft | A business tells us a worker left: picks the worker (first name, paid placements only), the day and why from the claim reasons. The call team calls and files the claim; a Team Lead decides. Shown only when the server switches it on (`CUSTOMER_WORKER_LEFT_REPORTS=on`, contract 8.2) |
| `/referral-lead` | ReferralLead | Referral partner sends a lead: name and mobile (needs a job / needs staff and area optional), and a tick that the person agreed to be called. No daily limit. Our call team calls; the partner sees first name and stage only. Shown only when the server switches it on (`CUSTOMER_REFERRAL_LEADS=on`, contract 7.3b) |
| `/help` | Help | "Call me back" (topic; now or a time window 9 AM–9 PM) and short answers |
| `/privacy` | Privacy | What is kept and never kept, grievance contact, policy link, "Delete my account" |
| `/delete-account` | DeleteAccount | Big warning + tick while the ₹499 guarantee runs (ends the refund), fresh OTP, what the law keeps |
| `/settings` | Settings | App version, sign out. No language choice (English only) |
| `/inbox` | InboxScreen (`src/push/`) | Every notification, newest first, mark read, and the three switches (Service, Job updates, Promotions) |
| — | UpdatedTerms | Shown on top of Home when the terms changed: read "In short", accept with a fresh OTP |

Large-text friendly: one step larger than Field, 52 px touch targets, everything grows with the phone's font setting. Low data: no maps or images downloaded (the pin is one GPS reading), fonts bundled, answers cached 60 s, no refetch on every focus.

## The verification steps (native screens, 21 Nov)

Consent, the live selfie, the ID check, the terms and ₹499, the referral partner's terms / selfie / ID / UPI, and the business agreement are **the app's own screens** (`/verify/<purpose>?profileId=…`, `src/screens/Verify/`). Nothing new on the server:

- The screen asks the server for this person's own link (`POST /me/profiles/:id/links`, the same link an agent sends by SMS, no SMS sent) and keeps only its token (the last part of the URL).
- Every step calls **the link page's own endpoints** with that token (`src/verify/stepsApi.ts`; the same calls as `web/src/screens/public/shared/api.ts`), at the API root and without the customer token. So every server check is exactly the link page's: the code to the person's own number bound to that link (AC-3; it is kept in memory only and runs out 5 minutes after it was sent — then the code step comes back and finished steps stay finished), the live-camera rules, UIDAI's signature on the Aadhaar QR, the hash of the terms text shown, the bank confirming the ₹499.
- **Live camera only** (`expo-camera`): the selfie (front camera) and the photo of another ID card (back camera) are taken in the app; there is no gallery or file picker. Each picture is drawn again and saved as a new JPEG (`expo-image-manipulator`) so the camera's EXIF stays behind; an ID card is at most 1280 px on its longest side (the server takes 240–1280 px, ≤ 5 MB), with the one-time capture token (2 minutes). Uploads are sent with `captureSource=live_camera`.
- **Aadhaar QR:** the camera reads the Secure QR; only its text is sent — never a picture of the card. The **e-Aadhaar PDF** option opens the same step on the link page in the secure sheet (it needs the PDF's password and a PDF reader); the PDF stays on the phone.
- **₹499:** the UPI QR (`react-native-svg`) and "Pay with a UPI app" (`upi://` intent); "Someone else will pay" sends the payment-only link. Tapping Pay never says "done": the screen shows "Paid — confirming" and asks again every 5 seconds until the bank confirms, with the optional 12-digit UPI reference.
- **Referral partner:** three ticks (terms, call recording, the separate ID-check consent S2), then UPI or bank account in their own name; only the masked value is shown after saving.
- **Business agreement:** name (filled from the link), three ticks, then "Send code to sign"; typing the code signs. The signed copy opens from the API (`/consent/<token>/signed/copy`).
- Wording follows the link pages (`src/i18n/verify.en.ts`).

### The secure browser sheet (documents and the e-Aadhaar PDF)

Documents (a referral partner's papers) and the e-Aadhaar PDF still open the **existing link pages** inside the app.

- **Android: Chrome Custom Tabs** (`expo-web-browser` `openAuthSessionAsync`). **iPhone: SFSafariViewController** (`openBrowserAsync` — the auth session would show a "wants to use … to sign in" prompt).
- **Why not a WebView: the camera.** Custom Tabs and the Safari sheet run the page in the real browser, which asks for camera permission itself, so the live selfie and the Aadhaar QR scan (`getUserMedia`) work. A WebView needs extra native permission code on both platforms. UPI links (`upi://…`) also open the UPI app from the browser, and the app cannot read the payment, Aadhaar or agreement pages.
- **Coming back:** every link gets `?app=1&returnTo=laboura://sheet-done`. When the page goes there, the sheet closes and Home shows. When the person just closes the sheet, Home reloads too. Home also reloads whenever the app comes back to the front.
- **Fallback:** a phone with no in-app browser opens the page in its normal browser; Home says "come back when done" and refreshes on return. *A "Back to the Laboura app" button on the link pages needs `web/` to honour `returnTo`. Checked 21 Nov: not done yet; asked of the office session (it is outside this folder).*
- Only `https` links on the link-pages address (`EXPO_PUBLIC_LINK_PAGES_URL`, default the API address) are opened.
- To be proven on real phones: the native camera, the QR scan and the UPI intent on a cheap Android and on iPhone.

## Data: live API or pretend data

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Server address. Test setup: `https://app.laboura.com`. The app calls `<this>/customer-api/v1` |
| `EXPO_PUBLIC_API_MODE` | `live` (default) or `mock` — pretend data, no server: every OTP is `123456`; a number ending `0000` "already has" JS-1234; the verification steps run on pretend link endpoints (`src/verify/mockSteps.ts`: any 6-digit code, the QR is always verified, the ₹499 confirms about 8 seconds after agreeing to the terms) |
| `EXPO_PUBLIC_LINK_PAGES_URL` | Where `/p/...` pages live (defaults to the API address) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Optional: otherwise taken from the server's `GET /config` |
| `GOOGLE_IOS_URL_SCHEME` | iPhone only, at build time: the iOS client id reversed |
| `LABOURA_ANDROID_PACKAGE`, `LABOURA_IOS_BUNDLE_ID` | Override the placeholder ids (`com.laboura.app`) |
| `EXPO_PUBLIC_PRIVACY_URL` | Privacy policy page (default `https://laboura.com/privacy`) |
| `GOOGLE_SERVICES_JSON` | Path to Firebase's `google-services.json` (Android push). On EAS a "file" environment variable; locally `./google-services.json` if present. Never committed; without it the app still builds, just without Android push |
| `EAS_PROJECT_ID` | The Expo project id from `eas init`; written to `extra.eas.projectId` (push tokens need it). Set it in the EAS project's environment variables or `eas.json` `env` |

The HTTP client sends `X-Laboura-Installation` (a random id per install) on every request, renews the 15-minute access token with the refresh token on `401 CUSTOMER_TOKEN_EXPIRED` (once, then retries), and signs out on any other 401. Screens never show the server's English `message`: they choose their own words from the error `code` (`src/api/errorText.ts`).

### Server items the app relies on (checked 21 Nov)

1. `GET /me/form-options` — done: areas, trades, market salary ranges and the legal minimum by zone and skill level (all 12 figures).
2. `POST /auth/apple` and `appleSignIn` in `GET /config` — done on the server; off until an Apple client id is set. The Apple button stays hidden until then.
3. Referral partner documents (`GET /me/profiles/:id/documents`) — done; Home shows them.
4. The landing page for the partner link `/r/<RF- code>` (the QR points there) — **not built yet**; asked of the office session (it lives in `web/`).

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
4. **Firebase for notifications**: in the same Firebase project add an Android app with package `com.laboura.app`, download `google-services.json`, and upload it to the Expo project as a **file** environment variable named `GOOGLE_SERVICES_JSON` (expo.dev → project → Environment variables). Never commit it (it is in `.gitignore`). Then give Expo the FCM key: `eas credentials -p android` → Push Notifications → upload the Firebase service-account key.
5. **EAS project id**: after `eas init`, set `EAS_PROJECT_ID` to the id it prints (Expo environment variables, or `env` in `eas.json`). Without it the app runs but cannot get a push token.
6. **Apple** (after testing, in the company's name): developer account → Sign in with Apple, iPhone push, TestFlight.

## Notifications (`src/push/`)

- `InboxScreen` is the default export of `app/(app)/inbox.tsx` (the bell in the header opens it). It also shows the three switches (`NotificationSettingsCard`).
- `PushBridge` is rendered once inside the signed-in layout (`app/(app)/_layout.tsx`): asks for permission, registers the token (`PUT /me/device`), opens the right screen when a notification is tapped.
- Sign-out calls `POST /auth/sign-out`, which removes this phone's push token on the server.
- Quiet hours (9 PM–9 AM, except sign-in codes and receipts) and the limit of 3 non-urgent a day are kept by the server. A push is never counted as a contact attempt.
- Android push needs Firebase's `google-services.json` and the EAS project id (see "What the owner sets up"). Without them the app still builds, just without Android push.
