# Legal minimum wage — zones, skill levels and the check

Decided by the owner on 17 Nov 2026 (Master Guide rev 193, "Decisions of 17 Nov", item 8).
Code: `src/modules/trade/minimum-wage.ts` (figures, zone rule), `VacancyConfirmationService.checkLegalMinimum`
(the check), migration `20261203100000_minimum_wage_zones` (columns, backfill, trade levels).

## The rule

A vacancy's starting salary (a daily wage × `salaryDaysPerMonth`, 26 by default) is compared with
**the legal monthly minimum for the business's zone and the trade's skill level**. Below it is
allowed with a warning: the agent (or the owner in the app) ticks "owner told", and the vacancy is
marked for Team Leads, Managers and the CEO (`belowLegalMinimum`). Nothing else about the warning changed.

Trades at the same level share a minimum: that is the law, not a bug. The bug the owner saw was every
trade sitting at the column default (`unskilled`) and every business, wherever it is, getting the
Zone 1 figures.

## Figures (paise a month)

Karnataka minimum wages notification dated 22 May 2026, general rates for employments under
Schedules 1 and 3, in force from the notification date. All twelve are in `PricingPolicy` and the CEO
edits them on C-Pricing-MinWage (`PUT /pricing/legal-minimum-wages`). The four columns that existed
before (`legalMinimumWage{Unskilled,SemiSkilled,Skilled,HighlySkilled}Paise`) keep their meaning:
they are Zone 1. Zone 2 and Zone 3 have their own columns (`legalMinimumWageZone2…`, `…Zone3…`).

| Level          | Zone 1 (Greater Bengaluru) | Zone 2 (other corporations, district HQs) | Zone 3 (rest of Karnataka) |
| -------------- | -------------------------- | ----------------------------------------- | -------------------------- |
| Unskilled      | ₹23,376.43 (2337643)       | ₹21,251.30 (2125130)                      | ₹19,319.36 (1931936)       |
| Semi-skilled   | ₹25,714.07 (2571407)       | ₹23,376.43 (2337643)                      | ₹21,251.30 (2125130)       |
| Skilled        | ₹28,285.47 (2828547)       | ₹25,714.07 (2571407)                      | ₹23,376.43 (2337643)       |
| Highly skilled | ₹31,114.02 (3111402)       | ₹28,285.47 (2828547)                      | ₹25,714.07 (2571407)       |

The Zone 1 figures were stored rounded to the rupee (2337600, 2571400, 2828600, 3111400); the migration
corrects them to the exact paise wherever they still had those rounded values (a figure the CEO had
changed is left alone).

## Zones

From the notification: **Zone 1** — areas under the Greater Bengaluru Authority; **Zone 2** — other
municipal corporations of the state and all district headquarters; **Zone 3** — all other areas.

### The zone rule (how a business gets its zone)

`Business.minimumWageZone` (1, 2 or 3) and `Business.minimumWageZoneSource` (`auto` or `staff`).
When a business is created, and whenever an address field (pin code, address, street, locality,
landmark) is edited while the source is `auto`, the zone is worked out by `zoneForAddress`:

1. a 6-digit pin code starting **560** → Zone 1 (560xxx is the Bengaluru head post office's range,
   which is the Greater Bengaluru area);
2. the business's city is one of Karnataka's other city corporations or a district headquarters
   (`ZONE_2_CITY_NAMES`, with the old spellings such as Mysore, Belgaum, Gulbarga, Shimoga) → Zone 2;
3. a pin code outside 560xxx **and** an address line naming such a city (and not naming Bengaluru) → Zone 2.
   Address lines only count with a non-Bengaluru pin code, so "Mysore Road, Bengaluru" stays Zone 1;
4. anything else → **Zone 1**, the default when unsure (the guide says so: unsure → Zone 1, staff set it).

Zone 3 is never guessed: there is no reliable list of every other town, and a wrong Zone 3 would apply
a lower minimum than the law requires. Office staff (the business's Team Lead, a Manager or the CEO) set
Zone 2 or 3 on the business page (C-Business → "Minimum wage zone" → Change zone, with a reason;
`PATCH /businesses/:id/minimum-wage-zone`). The change is audit-logged (`business.minimum_wage_zone_set`),
the source becomes `staff` (later address edits no longer move it), and the business's vacancies that are
not filled, closed or cancelled are checked again against the new zone (`belowLegalMinimum` and
`legalMinimumPaise`; an owner-told tick already given is kept).

Existing businesses were backfilled by the migration with the same rule (written in SQL there).
A branch uses its business's zone; a business with a branch in another zone needs that branch as its
own business, or staff choose the zone of the branch that hires (not covered by this change).

Laboura launches in Bengaluru, so nearly every business is 560xxx and Zone 1.

## Trade levels

The notification defines the four skill categories but its schedules of job titles are in the Kannada
gazette, which is not reproduced in the public summaries (see Sources). The levels below follow the
owner's guidance in rev 193 (helpers, cleaners and housekeeping unskilled; waiters and packers
semi-skilled; cooks, drivers and electricians skilled; head cooks and supervisors highly skilled) and the
usual reading of the categories:

- **Unskilled** — work that needs no training or experience beyond simple instructions.
- **Semi-skilled** — some training or experience, routine work under supervision.
- **Skilled** — a trade learned through training or apprenticeship, done independently (often a licence).
- **Highly skilled** — extensive training plus judgement, or supervising skilled workers.

| Trade (managed list) | Before     | Now          | Why |
| -------------------- | ---------- | ------------ | --- |
| Housekeeping         | unskilled  | unskilled    | Cleaning work; the guide names housekeeping unskilled. |
| Kitchen helper       | unskilled  | unskilled    | Helper; the guide names helpers unskilled. |
| Helper / loader      | unskilled  | unskilled    | Helper / manual loading. |
| Waiter               | unskilled  | semi-skilled | The guide names waiters semi-skilled (service routine learned on the job). |
| Warehouse packer     | unskilled  | semi-skilled | The guide names packers semi-skilled. |
| Retail staff         | unskilled  | semi-skilled | Sales and billing counter work needs some training; shop sales staff are commonly semi-skilled. |
| Delivery rider       | unskilled  | semi-skilled | Needs a two-wheeler licence and route knowledge, but no trade training; not a "driver" of a motor vehicle in the skilled sense. |
| Security guard       | unskilled  | semi-skilled | Unarmed guard work needs basic training. The central sphere pays "watch and ward without arms" at a higher (skilled) rate; if Laboura's lawyer reads the Karnataka schedule that way, set it to Skilled on C-Pricing-Trades. |
| Caretaker / nanny    | unskilled  | semi-skilled | Child and elder care needs experience and responsibility beyond simple instructions. |
| Cook                 | unskilled  | skilled      | The guide names cooks skilled. |
| Driver               | unskilled  | skilled      | The guide names drivers skilled (motor vehicle licence). |
| Electrician          | unskilled  | skilled      | The guide names electricians skilled (licensed trade). |
| Plumber              | unskilled  | skilled      | Trade learned by apprenticeship / ITI. |
| Carpenter            | unskilled  | skilled      | Trade learned by apprenticeship / ITI. |
| Painter              | unskilled  | skilled      | Building painters are a skilled trade in the construction schedules. |
| AC technician        | unskilled  | skilled      | Technical trade (ITI refrigeration and air conditioning). |

No trade in the current list is highly skilled. A head cook, supervisor or similar trade added later
should be Highly skilled. A trade the managed list does not have ("Other") is checked against the
unskilled figure of the business's zone, as before.

The migration only changes trades still at the old default (`unskilled`), so a level the CEO already set is
kept. The seed (`prisma/seed.ts`) creates the trades with these levels.

## Where the check and the figures are used

- Vacancy create, update (trade, salary, period or headcount past the draft) and "send to the owner"
  (`VacancyService` → `legalMinimumFields(…, { businessId })`).
- Laboura Field's business page "send to owner" step (`field-redesign.service`, `nextStep.legalMinimumPaise`)
  and FA17 add vacancy (`GET /trades?businessId=` gives the business's zone figure for the warning).
- Office web CA09 add vacancy (`useTrades(businessId)`); CA13 / FA07 register a new business before it
  exists, so their warning uses Zone 1's figure (the default) and the server checks the real zone when the
  vacancy is sent to the owner.
- Customer app: `GET /me/form-options` gives every trade's `legalMinimumPaiseByZone`; the business profile
  carries `minimumWageZone` (`GET /me`), and the server's vacancy-draft warnings use the business's zone.
- CEO: C-Pricing-MinWage shows and edits all twelve figures and how many businesses are in each zone;
  C-Business shows and changes a business's zone.

## Sources

- Karnataka minimum wages notification dated 22 May 2026 — Futurex summary:
  https://futurexsolutions.com/minimum-wages-notification-dated-22-may-2026/ (zones and the twelve monthly
  figures above; it notes that the original Kannada gazette notification is authoritative).
- Legal 500 / Mondaq, "Decoding Karnataka's revised minimum wage notification":
  https://www.legal500.com/intelligence/india/employment-and-hr/decoding-karnatakas-revised-minimum-wage-notification
  (zone wording: Greater Bengaluru Authority; other municipal corporations and all district headquarters;
  all other areas; immediate effect).
- India Briefing, "Karnataka Minimum Wage Overhaul: 2026 Rates, Zones & Compliance Mandates" prints figures one
  step higher than the Futurex table. The guide (rev 193) uses the Futurex figures; if a lawyer confirms
  different figures, the CEO updates them on C-Pricing-MinWage — no code change is needed.
