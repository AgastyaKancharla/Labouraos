# Laboura web app (`web/`)

One React app for the CEO, Manager, Team Lead and Finance portals, the call
agent console and the public job seeker pages. The Nest API serves it at the
**site root** of `app.laboura.com` (and of the Render test address):
`/login`, `/ceo`, `/manager`, `/team-lead`, `/finance`, `/call-agent`, the
public pages at `/p/...`, and `/field-app` (the note that sends a field agent
to Laboura Field). See `src/modules/web-app/site-routing.middleware.ts`.

- The API shares some first segments with the portals (`/ceo/...`,
  `/finance/...`, `/manager/...`). The server tells them apart by what the
  browser asks for: a page the browser opens (`Accept: text/html`) gets the
  app; the app's own API calls send `Accept: application/json` (`lib/api`) and
  reach the API. Never fetch an API path without that header.
- A new top-level route must be added to the server's `WEB_APP_ROOTS` (and
  `WEB_ROOTS` in `vite.config.ts`); `src/App.root.test.tsx` checks the list.
- Old `/app/...` links (invites, resets, `/app/p/...` sent by SMS or WhatsApp)
  are redirected permanently by the server to the same path without `/app`.
- Links in screens: use router paths (`navigate('/ceo/refunds')`, `useHref`),
  never a hard-coded prefix.
- The old one-page consoles are retired (14 Nov): the server sends a browser
  opening `/admin`, `/console/admin`, `/map` or `/console/map` to `/login`,
  `/console/call-agent` to `/call-agent`, and `/field-agent` to Laboura Field
  (see `AGENTS.md`, "Retired consoles").

Field agents use the separate Laboura Field phone app (`field.laboura.com`,
or `/field` on the Render address).

React 19 · TypeScript (strict) · Vite 7 · React Router 7 · TanStack Query 5 ·
Vitest + Testing Library. Every version is pinned exactly in `package.json`.

## Commands (from the repository root)

| | |
| --- | --- |
| `npm run web:install` | install `web/` dependencies (its own lockfile) |
| `npm run web:dev` | Vite on http://localhost:5173/ (e.g. `/login`, `/ceo`) — API calls go to Nest on :3000 (`npm run dev`) |
| `npm run web:test` | Vitest, once (`npm run test:watch --prefix web` while working) |
| `npm run web:lint` | ESLint (same base rules as the API, plus React hooks) |
| `npm run web:build` | type-check and build into `web/dist`, which Nest serves |
| `npm run build` | API **and** web (what Render runs) |

CI runs lint, test and build for `web/` on every push.

## Where things are

```
src/
  App.tsx              providers + every route (generated from portals/)
  auth/                sign-in API, session store, keep-alive, RequireRole, roles
  components/          the design system (below)
  components/fields/   form fields
  i18n/                en.ts (source of keys), kn.ts, hi.ts, provider, switcher
  lib/api/             fetch wrapper + ApiError
  lib/format/          money, phone, date (IST) helpers
  lib/period.ts        Today / This week / This month / Custom
  portals/             sidebars, screen registry, nav icons, badges
  screens/<portal>/<DesignId>/index.tsx   one folder per screen
  styles/              tokens.css, design.css (classes from the designs), components.css
  test/utils.tsx       renderScreen, mockApi, signInAs
```

## Building a screen — the conventions

1. **Find your design id.** Every route is already in
   `src/portals/screens.ts`, named after its design file in
   `cc-canvas/project/<id>.dc.html` (e.g. `C-Refunds` → `/ceo/refunds`).
   Until you build it, the route shows a placeholder that names the design.
   `variants` lists other designs of the same screen in other states; build
   them into the same route.
2. **Create `src/screens/<portal>/<DesignId>/index.tsx`** with a default
   export. Portal folders: `ceo`, `manager`, `team-lead`, `finance`,
   `call-agent`, `public`. That is all the wiring there is — the route picks it
   up automatically (`screens/registry.ts`) and code-splits it. Don't edit
   `App.tsx` or any shared list, so parallel work never conflicts. A design
   used by two portals (`FN-Review`, `CA16-Search`) is built once in one
   folder and reused.
3. **Keep the screen's pieces in its folder:** `index.tsx` (page), `useX.ts`
   (data hooks), pure logic in its own file (`money.ts`), and tests next to
   them. `screens/ceo/Main/` (CEO Command Center, top section) is the
   worked example of all of this.
4. **Link by design id**, never by hand-written URL:
   `const to = useScreenPath(); <Link to={to('C-Business', { id })}>`.

### Map the design to components

| In the design | Use |
| --- | --- |
| page header (back link, eyebrow, h1, subtitle, search, bell, Today/This week/This month/Custom) | `<TopBar title … period={period} onPeriodChange={setPeriod} />` — also sets the tab title |
| `.panel` / `.card` with an `h2` | `<Card title aside>` (`flush` for edge-to-edge tables) |
| `.stat` tiles with a coloured bar | `<StatGrid><StatTile label value tone to /></StatGrid>` |
| any list table | `<DataTable columns rows rowKey caption download="file-name" />` — sorting, filters, paging, empty/loading/error and the Excel download (hidden below Manager) |
| `.tabs` switching content | `<Tabs>`; tabs that are separate routes (`Money in / Money out / GST`) → `<LinkTabs>` |
| `.pill.good/.warn/.crit/.danger/.info`, `.tag.t*` | `<StatusPill tone="good">` (picks the family's look) |
| `.btn2` / `.btn.bp/.bs/.bd/.bg` | `<Button variant="primary\|secondary\|danger\|success">`, links: `<ButtonLink>` |
| toast at the bottom right | `useToast().success('…')` / `.error('…')` |
| confirm step / dialog | `<Modal open title footer>` |
| loading | `<Skeleton>`, `<SkeletonCard>`, or the component's `loading` prop |
| failed request | `<ErrorState error={query.error} onRetry={() => query.refetch()} />` |
| nothing to show | `<EmptyState title>` |

For one-off layout, the designs' own classes work as-is (`design.css`):
`money-grid`, `two-col`, `three-col`, `grid4`, `stage`, `track`/`fill`,
`kv`, `tl`, `hero`, `tile t-red`, `eyebrow`, `num-xl`… Five names mean
different things in the two design families (`.row`, `.bar`, `.dot`,
`.muted`, `.warn`); they are scoped under `.portal` (sidebar screens) and
`.console` (call agent, sign-in, public pages), which AppShell sets for you.
Colours, radii and spacing only through the variables in `tokens.css`.

### Forms (guide: "Forms: rules for every screen")

| Field | Component | Notes |
| --- | --- | --- |
| text | `TextField` | never for dates, money or phones |
| fixed list | `SelectField` | no free text |
| date | `DateField` | calendar only; `mode="dob"` blocks under-18 |
| mobile | `MobileField` | +91 fixed, exactly 10 digits, paste-safe |
| OTP | `OtpVerification` + `useStaffOtp(purpose)` | Send OTP → Verify → Resend after 30 s, max 3 resends; "Already registered — open it" on duplicates |
| digit boxes | `OtpInput` | paste fills all boxes |
| pincode | `PincodeField` | `onComplete` to fill the city |
| money | `MoneyField` | ₹ fixed, commas while typing, value is **integer paise**, optional per month / per day |

Every field takes `label`, `hint`, `error`, `required` and is wired for screen
readers (label, `aria-describedby`, `aria-invalid`, errors in `role="alert"`).
Drafts and "how did you hear about Laboura" are per-screen work.

## Data fetching

- One hook file per screen, built on TanStack Query and `api` from
  `lib/api/client.ts`:

  ```ts
  const refunds = useQuery({ queryKey: ['refunds-due'], queryFn: () => api.get<RefundDueRow[]>('/refunds/due') });
  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/payments/${id}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['refunds-due'] }),
  });
  ```

- **Query keys start with the resource** (`['payments', …]`,
  `['refunds-due']`) so a change anywhere can invalidate every screen that
  shows it.
- API paths are the Nest routes as they are (no prefix): `/payments`,
  `/targets/money-at-risk`… Read the controller (`src/modules/**/**.controller.ts`) for the roles and the response shape.
- Errors arrive as `ApiError` (`status`, `message`, `messages`,
  `requestId`, `isNetworkError`). Show them with `ErrorState`, or the toast
  for a failed action. **Never handle 401** — the client ends the session and
  the sign-in screen explains why.
- Period filters: `periodToUtcRange(period)` gives `fromDate`/`toDate` in UTC
  for IST calendar days.
- Never compute permissions in the UI to protect data — the API enforces RBAC.
  Hide what a role cannot use (e.g. `canExportLists(role)`), nothing more.
- Phone numbers come masked from the API for agents; display them as given.

## Money, phone and date helpers

```ts
formatINR(41260000)        // "₹4,12,600"   (paise only when non-zero: ₹499.50)
formatINR(-1193500)        // "− ₹11,935"
formatINRCompact(53700000) // "₹5.37L"
parseRupeesToPaise('4,12,600.50') // 41260050   (no floats anywhere)
formatMobile('9876543210') // "+91 98765 43210";  maskMobile(…) → "******3210"
formatDateIST(iso)         // "30 Oct 2026"   formatDateTimeIST → "30 Oct 14:02"
formatLongDateIST(iso)     // "Thursday, 30 Oct 2026"
istDateKey(date)           // "2026-10-30" (the IST day, for <input type=date>)
```

All amounts are integer paise end to end; the helpers throw on a non-integer.
All times from the API are UTC; show them only through the IST helpers.
For "now" use `useNow()` / `useClock()` so tests can fix the time.

## Auth and roles

- `/login` serves every role (designs M01/M02, MG01/MG02, F01/F02, TL01/TL02,
  CA01/CA02): staff code + password, then either the authenticator code
  (CEO, Manager, Finance) or the login code read out by a Team Lead/Manager.
  A management account without an authenticator is set up on first sign-in.
- The device id lives in `localStorage` (`laboura_device_id`, shared with the
  old consoles); the token in `sessionStorage`, so closing the browser signs out.
- Tokens last 15 minutes and are refreshed while the person is active; after
  60 idle minutes, at the 2-hour limit, or if the session is revoked, they
  land on sign-in with the reason.
- `RequireRole` keeps each role in its own portal; `ROLE_LANDING` decides where
  a fresh sign-in lands (call agents start on Attendance, per CA02).

## Languages

English, Kannada and Hindi. Add every new string to `src/i18n/en.ts` first,
then the same key to `kn.ts` and `hi.ts` — TypeScript fails the build until
all three match, and a test checks the `{placeholders}` too. Use it with
`const t = useT(); t('cc.netRevenue')`, `t('greeting.evening', { name })`.
Keys are grouped by prefix: `common.`, `form.`, `auth.`, `nav.`, `screen.`
(page titles, one per design id), and one prefix per screen (`cc.` for the
Command Center). Have a native speaker check new Kannada/Hindi text.
`<LanguageSwitcher />` is the ಕನ್ನಡ · हिंदी · EN control from the public pages.

## Testing

Each screen ships with a test next to it. Use `src/test/utils.tsx`:

```tsx
const api = mockApi({
  'GET /refunds/due': [{ id: 'd1', amount: 49900 }],
  'POST /payments/p1/approve': ({ body }) => ({ ok: true }),
  'GET /payments': apiError(500, 'Internal server error', 'req-1'),
});
signInAs('ceo');
renderScreen(<Refunds />, { portal: 'ceo', path: '/ceo/refunds', now: new Date('2026-11-11T06:00:00Z') });
expect(await screen.findByText('₹499')).toBeInTheDocument();
expect(api.calls('GET /refunds/due')).toHaveLength(1);
```

Cover at least: the data shown, loading, empty, error (with retry), and every
action's request body. Query by role and accessible name (that also checks
accessibility). Unmocked requests fail with 501 so nothing reaches a network.

## Accessibility and phone width

Everything works with a keyboard (skip link, focus rings, Tabs with arrow
keys, Modal focus trap, Escape closes popovers). Below 900 px the sidebar is a
drawer; below 760 px everything is one column with 16 px gutters and tables
scroll sideways (mark minor columns `hideOnPhone`). Check your screen at
390 px wide.
