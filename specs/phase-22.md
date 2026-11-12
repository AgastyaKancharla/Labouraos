# Phase 22 — The Finance back office

The Finance portal designed on 9 Nov (design canvas v62): Money today · Money in (+ Match a payment) · Invoices · Credit notes · Refunds (+ one refund detail) · Payouts (paid daily) · Expenses & bills · Salaries · Bank · Tax · Reports & CA downloads · Approval limits · Month-end review · Notifications.

Built in two parts by separate agents. Part B (salaries/payroll from attendance, month-end review, tax and reports & CA downloads) is written by its own agent below Part A.

## Part A — money in, payouts, expenses, bank, invoices, limits, Money today

### Rules (Master Guide — quoted or summarised, nothing added)

- **Approval limits** (kept in Settings, only the CEO changes them): a job seeker's ₹499 refund the system marks eligible, referral payouts and joining rewards (after the 48-hour wait), and **expenses up to ₹10,000** are approved and paid by Finance directly. A **business refund up to ₹15,000** is approved and paid by Finance directly; above it needs the CEO. Any refund outside the rules always needs the CEO. Managers have no money powers. Everything Finance does is logged. (The limits and the refund rule were added in PR #94: `PricingPolicy.financeExpenseLimitPaise`, `financeBusinessRefundLimitPaise`, `GET/PUT /pricing/approval-limits`.)
- **Paid daily (decided 9 Nov night):** referral payouts and joining rewards are paid daily by Finance (no weekly batch), once due and after any 48-hour wait.
- **How money is collected:** money comes in by UPI straight into the company current account, each payment with its own reference. A screenshot is never proof; a payment counts only when it is in the bank. Refunds, payouts and rewards are sent by UPI from the company account by the CEO or Finance and the UPI reference (UTR) is recorded; the UPI app shows the receiver's name, which Finance checks.
- **Unclaimed money** (Match a payment design): is never kept or matched by guess — it is matched to what it was for, or returned to the same UPI ID.
- **TDS (to confirm with the CA):** a placement fee that arrives short by the TDS the business deducted is recorded as "TDS deducted" with the certificate to collect, not as a mismatch (PR #94's `TdsReceivable`). Referral payouts are commission: each partner's yearly total is tracked and **Finance is warned before it crosses the TDS limit (₹20,000 a year)**. The limit lives in Settings (`PricingPolicy.referralTdsYearlyLimitPaise`). Deducting the 2% waits for the CA — Part A only warns.
- **Expenses (decided 9 Nov):** some costs come in automatically — salaries from payroll, referral payouts and joining rewards, refunds (shown against revenue, not as a cost); the rest are entered by Finance or the CEO **with the bill attached**: rent, calling, SMS and WhatsApp, ID checks, hosting, ads and marketing (tagged to a channel), field agents' travel, office and other. Budget vs actual by category, revenue − expenses = profit or loss, cost per placement, placements needed to break even, spend per channel. Expenses above the amount in Settings need the CEO's approval. "No bill, no payment."
- **Our own books:** every rupee in and out is recorded in Laboura itself; bank matching line by line (Bank design: every line must match something in our books before the day is closed).
- Money in integer paise; times stored in UTC, shown in IST; every route has a role guard (Finance and CEO only — Managers see no money); every new table has row level security; every write is audit-logged with actor, time, reason and the fields that changed.

### What is built

1. **Expenses & bills** (`Expense`, `ExpenseBudget`)
   - Finance or the CEO records an expense: category (fixed list above), supplier, what for, amount, GST if any, bill date, paid-from, ad channel for ads, and the bill (photo or PDF, kept in the private document store, max 10 MB).
   - Approval by the limits: entered by the CEO → approved. Entered by Finance → up to the limit Finance approves it ("Approve and pay"); above the limit → waits for the CEO, who approves or rejects with a reason. Only the CEO approves above the limit. No bill → it cannot be approved or paid (a bill can be attached later).
   - Paying records paid-from, the bank/UPI reference and the date.
   - Automatic lines are **computed**, never stored, from payments already recorded: referral payouts and joining rewards paid (a cost), refunds paid (shown against revenue). So nothing is entered twice. Salaries come from payroll (Part B).
   - The CEO sets a monthly budget per category.
   - **Profit for a period** (C-Expenses): net revenue (₹499s + placement fees without GST − refunds), expenses (bills by bill date, approved or paid, + payouts and rewards paid), profit/loss, GST collected (not income), cost per placement, placements to break even, budget vs actual by category, spend per ad channel. CEO and Finance only.
2. **Payouts paid daily**: one list of everything Finance pays — referral payouts, joining rewards, refunds already raised that Finance may pay (job seeker ₹499 refunds, business refunds within the limit, and any refund the CEO approved), extra ₹499 duplicate refunds. Each row says Ready, Waiting 48 h (payable at), No payout details, Flagged, With the CEO, Failed, or crosses the TDS limit. "Pay and record" approves (the existing checks run: refund eligibility, limits, referral terms) and records the UTR with the name the UPI app showed; "Pay all ready" pays several, each with its own UTR, and reports each result. "Mark failed" records a bank failure with its reason; "Retry" puts a failed payout back to ready (payout details are checked again when it is paid).
3. **Money in · Match a payment · Bank**: every bank credit (bank feed or entered by Finance) and card payment in a period with what it was for, expected vs received, and status (matched automatically, matched by Finance, TDS recorded, less, wrong amount, not matched, duplicate refunded, returned, ignored). Possible matches for an unclaimed credit (same amount, waiting payments, reference/name/time hints); matching uses the existing confirm (`POST /payments/:id/confirm`, TDS-short included). "Return the money" records the return with its UTR. Bank: each IST day's opening balance, money in, money out and the closing balance in our books, against the bank's closing balance Finance types in from the statement; a day is closed only when they agree (or with a written reason).
4. **Invoices**: every placement fee (GST invoice once paid, waiting while unpaid) and every ₹499 receipt, with status (paid, waiting N days, TDS certificate due/received, less), filters, the invoice/receipt download link, "Mark certificate received" and "Send reminder" (re-sends the payment link; Finance added to the existing resend route).
5. **Approval limits** page: Finance sees, only the CEO saves (PR #94 endpoints).
6. **Money today**: received this month, paid out this month, balance in our books, refunds Finance can pay, last month's GST; the to-do list; money moving today; your limits.
7. **Screens**: FN-Home, FN-MoneyIn, FN-Match, FN-Invoices, FN-Payouts, FN-Expenses, FN-Bank, FN-Limits and the CEO's C-Expenses.

### Left for later (not Part A)
- Credit notes (waits for the CA's GST answer), Refunds pages, Notifications bell (Phase 21 bells), Salaries, Tax, Reports, Month-end review (Part B).
- Deducting 2% TDS from referral payouts (CA to confirm). Monthly fixed costs approved once (rent): each month's bill is entered and approved for now.
- An automatic bank statement feed: until the bank API exists, debits not recorded in Laboura cannot be listed; Finance types the statement's closing balance.

### Endpoints (all `ceo` + `finance` unless marked CEO only)
| Route | What |
| --- | --- |
| `GET /finance/home` | Money today |
| `GET /finance/expenses` · `POST /finance/expenses` (multipart, `bill`) | list (+ automatic lines) · record |
| `POST /finance/expenses/:id/bill` · `GET /finance/expenses/:id/bill` | attach · download the bill |
| `POST /finance/expenses/:id/approve` · `/pay` · `/reject` | approve (and pay) · pay · reject (CEO only for above-limit) |
| `GET /finance/profit` · `PUT /finance/expense-budgets` (CEO only) | P&L for a period · monthly budgets |
| `GET /finance/payouts` · `POST /finance/payouts/:id/pay` · `POST /finance/payouts/pay-all` · `POST /finance/payouts/:id/failed` · `POST /finance/payouts/:id/retry` | the day's payouts |
| `GET /finance/money-in` · `GET /finance/bank-credits/:id/matches` · `POST /finance/bank-credits/:id/return` | money in, match, return |
| `GET /finance/bank` · `POST /finance/bank/close-day` | daily reconciliation |
| `GET /finance/invoices` · `POST /finance/tds-receivables/:id/certificate-received` | invoices |

### Gate
- [ ] Every new table has `ENABLE ROW LEVEL SECURITY`; every route has a role guard; Managers, Team Leads and agents get 403 on every route.
- [ ] Expense limit: Finance approves ≤ limit, gets "needs the CEO" above it; the CEO approves/rejects with a reason; no bill → no approval or payment; all audited.
- [ ] Automatic lines come from payments, so a payout paid once appears once.
- [ ] Payouts: waiting 48 h is not payable; pay records the UTR; pay-all reports each result; failed → retry.
- [ ] Money in, match (incl. TDS short), return, bank close-day, invoices, limits — each with a test.

## Part B — salaries, tax, reports & CA downloads, month-end review, refunds, notifications

### Rules (Master Guide — quoted or summarised, nothing added)

- **Salary slips** (Attendance): "at month end the software works out paid days from attendance and approved leave; Finance checks and releases; each person downloads their own payslip in the standard corporate format. **PF and ESI** are added once the company is registered (a question for the CA, with Karnataka professional tax)."
- **Payroll comes only from attendance:** "the month's attendance (full days, half days, leave, shortfall not made up) becomes the salary sheet; Finance prepares it, the CEO approves the total, payslips go to staff."
- **Short days:** "Shortfall not made up by month end is **deducted from salary**." "No login and no approved leave is absent (unpaid)." Leave approved beyond the paid balance is unpaid leave (Phase 21). Weekly days off and public holidays are paid days off.
- **Staff pay:** "Monthly salary · No commission for anyone" (Money rules). So the payslip has no incentive line.
- **Paid on the 1st** (decided 9 Nov night): "Salaries are paid on the 1st of every month (may change to the 31st later)."
- **Who sees salaries:** the CEO and Finance. "A Manager does **not** see … anyone's salary" and gets no rupee figure in any answer (reconfirmed 11 Nov).
- **Month-end review:** "Everything Finance does is logged, and the CEO reviews and closes each month on a Month-end review page." The design: "after closing, October's money records can't be changed — corrections go into November with a note."
- **Our own books / Reports & CA downloads:** "GST and TDS registers, profit and loss and cash flow. The CA gets ready-made downloads (books, GST return data, TDS registers)."
- **Tax handling (to confirm with the CA):** every refund of a GST invoice gets a credit note; TDS a business deducted is "TDS deducted" with the certificate to collect; referral payouts are commission — "Finance is warned before it crosses the TDS limit (₹20,000 a year, 2%)". **No CA yet**: CA items are marked "to confirm". GSTR-1 by the 11th, GSTR-3B by the 20th (Finance portal paragraph).
- **Approval limits** (Part A, PR #94): Finance pays a job seeker's ₹499 refund the system marks eligible and a business refund up to ₹15,000; above it, or outside the rules, the CEO decides (C-Refunds).
- Money in integer paise; days in half days (no floats); times stored in UTC, shown in IST; every route has a role guard; every new table has row level security; every write is audit-logged.

### Owner decisions (11 Nov, in the Master Guide)

- **Day's pay = monthly salary ÷ 26, the same in every month** (Settings `payrollSalaryDays`, default 26). Loss of pay = salary ÷ 26 per absent or unpaid-leave working day, half that for a half day; a working day on the staff with no attendance at all is not paid either. **Someone who joins, leaves or is away part of the month is paid for the days actually on staff (owner decision 12 Nov, in the Master Guide): salary ÷ 26 × working days (Mon–Sat, not holidays) on staff, never more than the full salary. Then absences and unpaid leave are taken off. Someone on staff the whole month gets the full salary less absences**, whatever the number of working days. So joining on the last working day always pays one day. On ₹26,000 (₹1,000 a day): on staff all month in a 24-, 25-, 26- or 27-working-day month = ₹26,000; joined on the last working day of a 24- or a 27-working-day month = ₹1,000; joined on the 2nd working day of a 27-working-day month (26 on staff) = ₹26,000, of a 24-working-day month (23 on staff) = ₹23,000; joined 28 Oct 2026 (4 on staff) = ₹4,000; left 10 Oct 2026 (9 on staff) = ₹9,000; away 6 of 27 working days (21 on staff) = ₹21,000; joined mid-month with 10 days on staff and 2 absences = ₹8,000. (This replaces the 12 Nov re-check rule that took salary ÷ 26 off per working day *not* on staff.) In code: `earnedPaise` = the full salary when not a single working day is off staff, else `min(monthly, round(monthly × daysOnStaff ÷ 26))`; `notEmployedPaise` = monthly − earned (shown as "Working days not on the staff"); loss of pay and shortfall come off after, capped at what was earned; paid days = 26 on staff all month, else `min(26, days on staff)`, less loss of pay. **The leaving day is paid in full.** Net pay is never below ₹0 and keeps its paise.
- **Joining date** `Staff.joinedOn`, entered by the CEO when adding staff (C-Team) or later (`PUT /staff/:id/joined-on`); when empty, payroll uses the first login. A deactivation records a period away (`StaffAwayPeriod`), closed on reactivation; working days away are not paid.
- **Only the CEO sets or changes salaries**; Finance sees them. **Managers see their own payslip** (only theirs, once paid); every other answer to a Manager is still stripped of money.
- Payslip split stays Basic 50% / HRA 20% / Special the rest (display only); no incentive line (no commission for anyone).
- **Business refund: the fee only; the GST on it stays owed** in Tax, Money today and the GSTR-1 data until the CA answers (no credit note yet).
- **A closed month never changes.** Money that arrives (bank feed, a credit Finance enters) or is matched after its month is closed is booked in the current open month with a note giving the bank's date (`bookingNote`); a payout back-dated into a closed month, and ignoring or returning a closed month's credit, are refused. The closed month's `books.csv` still shows such a credit on its bank date, marked "Matched later, booked in <month>".
- **A holiday (or attendance) changed after a month's pay is approved** is carried as a correction on a later sheet; the approved sheet is never re-worked (re-check 12 Nov):
  - Each correction is its own `PayrollCorrection` row: person, the month it relates to, amount (+ pays back, − takes back), reason, and the sheet it was applied on (null until then). Every unapplied correction is picked up by the next prepared sheet, whatever month it relates to; preparing a sheet again releases and re-applies its rows, so nothing is applied twice.
  - Approved months of the last 12 are worked out again from today's holidays and attendance with **that sheet's frozen `salaryDays`** and the full-day minutes and weekly offs **kept on the sheet at Prepare** (`PayrollRun.fullDayMinutes`, `PayrollRun.weeklyOffDays`; a sheet prepared before they were kept, `fullDayMinutes` null, falls back to the Settings version in force at its `preparedAt`) — a later or even back-dated Settings change never creates a correction.
  - **Beyond the window:** a holiday added, moved or removed (one at a time or the year's list), a day change (directly, as a request, or undone by an overturn) and a joining-date change are **refused** when they fall in a month whose sheet is frozen (with the CEO, approved or paid) and each of the 12 months after it also has a frozen sheet — no sheet still to be prepared would work it out again, so the change would be silently ignored. The message asks for a manual correction instead (`src/modules/finance/payroll-window.ts`).
  - **No correction on two sheets:** Prepare applies a waiting row only if its `appliedRunId` is still null or one of the sheets it was read from (a returned sheet, or this month's own), and checks the count; otherwise it refuses with 409 ("Someone else just prepared a salary sheet…, reload"), so a carry-forward never lands on two sheets prepared at the same moment. Only the difference not already recorded becomes a new row. Any change to a frozen month's attendance counts the same way — a Team Lead portal day change (`StaffRequest` kind `day_change`, which updates the attendance day), a leave or attendance correction, or a holiday added or removed — because the month is worked out again from the stored attendance; nothing needs to call payroll when a day changes.
  - Someone no longer on the staff who is owed money gets a line of their own on the sheet (correction only), so Finance pays it like any salary. A leaver whose corrections add up to a take-back keeps them waiting.
  - A take-back larger than that month's net pay takes the net to ₹0 and the rest (`carryForwardPaise`) becomes a new row on approval, applied on the next sheet — never forgotten.

### Other decisions made while building
- PF, ESI and professional tax print as ₹0 lines "Added after company registration" (columns on every line, so turning them on needs no data change).
- **Prepare** is allowed only from the 1st of the next month: it first marks every working day with no attendance as absent (for everyone on the staff that day) and refuses while any day is still open. The CEO **approves exactly the total he saw** (the request carries `netPaise` and `preparedAt`; a sheet prepared again since is refused, 409).
- **One UTR check** for the whole books (`src/common/money/utr-registry.ts`): payments, bank credits and money returned, expenses paid from the bank, salaries. A clash — or a unique-index race — answers 409.
- Paying a salary is refused on a closed bank day (the closed day would no longer agree with the bank); the run is marked paid in the same transaction as the last line.
- GSTR-1 rows use exactly the CGST/SGST split of the stored invoice (`invoiceGstSplit`); place of supply and IGST wait for the CA.
- P&L salaries: a month's salaries count once the CEO has approved them, in the period that holds the month's last day.

### What is built

1. **Salaries** (`StaffSalary`, `PayrollRun`, `PayrollLine`, `StaffAwayPeriod`, `Staff.joinedOn`): monthly salary per person with history (the CEO sets it); the month's sheet worked out live from attendance (÷ 26; a part month pays ÷ 26 × working days on staff, never more than the monthly salary); Prepare (Finance, from the 1st of the next month, on final attendance; refuses while anyone has no salary or a day is open) → with the CEO → Approve exactly the total seen / Send back with a reason (CEO only) → Pay and record the UTR per person (Finance) → when all are paid, the month is paid. Salary sheet download. Payslip per person (standard format, printable to PDF) for Finance/CEO and for the person themselves (`/payroll/my-payslips`). "Send payslips again" re-rings each paid person's bell.
2. **Profit report** counts salaries from payroll (Part A had ₹0); bank movements and the books balance include salary payments.
3. **Tax**: GST from placement invoices per month (fee-only business refunds listed, their GST still owed); ₹499 receipts carry no GST; TDS businesses deducted (Part A); referral commission per partner this financial year against the TDS limit (warning only); filing dates as reminders (GSTR-1 11th, GSTR-3B 20th, TDS we take 7th, TDS returns quarterly — the CA confirms).
4. **Reports & CA downloads**: P&L and cash flow for a period; CSV (opens in Excel; negative amounts stay numbers) for the books, GST data in the GSTR-1 layout (B2B/B2C rows with the stored invoice's CGST/SGST split), TDS registers, the salary sheet and the tax summary.
5. **Month-end review** (`MonthClose`, `MonthReviewMark`): the checklist (all bank days closed, all credits matched, payouts and refunds done, salaries released, expenses with bills and settled), every money action in the month (refunds, payouts, expenses, salaries, returned money) with who did it, the proof and whether the CEO approved it; the CEO's "Looks right" / "Flag" (with a note); Close (CEO) and Reopen (CEO, with a reason), audited; review download.
6. **Refunds**: Finance's queue (refunds due by the rules, raised refunds to pay, those with the CEO, paid this month) and one refund with every check; approving and paying use the existing endpoints.
7. **Bells** (notification service): `salaries_to_release` (Finance: prepare last month / sent back / approved — pay it), `salaries_need_ceo` (CEO), `month_not_closed` (Finance and CEO: last month or a reopened month), `payslip_ready` (the person; cleared when seen).
8. **Screens**: FN-Salaries, FN-Tax, FN-Reports, FN-Review (also the CEO's Month-end review), FN-Refunds, FN-Refund, FN-Notifications, FN-CreditNotes (placeholder), CA14g-Payslip, and the CEO's salary approval and rupee columns on C-Team-Salaries.

### Endpoints (all `ceo` + `finance` unless marked)
| Route | What |
| --- | --- |
| `GET /finance/salaries?month=` · `GET /finance/salaries/sheet.csv?month=` | the month's sheet (live draft or prepared) · download |
| `POST /finance/salaries/:month/prepare` | freeze the sheet and send the total to the CEO |
| `POST /finance/salaries/:month/approve` (`{netPaise, preparedAt}`) · `/send-back` (CEO only) | approve the total seen · send back with a reason |
| `POST /finance/salaries/:month/lines/:lineId/pay` | pay one person, record the UTR |
| `POST /finance/salaries/:month/payslips/resend` · `GET /finance/salaries/:month/payslips/:staffId` | bells again · one payslip |
| `GET /finance/staff-salaries` · `PUT /finance/staff-salaries/:staffId` (CEO only) | salaries per person · set one (from a month) |
| `PUT /staff/:id/joined-on` (CEO only) | joining date |
| `GET /payroll/my-payslips` · `GET /payroll/my-payslips/:month` (the person: agents, Team Leads, Managers, Finance) | own released payslips |
| `GET /finance/tax?month=` | GST, TDS, referral TDS, dates |
| `GET /finance/reports?fromDate&toDate` | P&L and cash flow |
| `GET /finance/reports/{books,gstr1,tds,tax,salary-sheet}.csv?month=` | downloads for the CA |
| `GET /finance/month-end?month=` · `GET /finance/month-end/review.csv?month=` | the review · download |
| `POST /finance/month-end/:month/marks` · `/close` · `/reopen` (CEO only) | Looks right / Flag · close · reopen |
| `GET /finance/refunds` · `GET /finance/refunds/:ref` | refund queue · one refund (`js-`, `pl-`, `pay-` + id) |

### Left for later (not Part B)
- Credit notes as documents and GST on refunds (CA), deducting TDS from referral payouts (CA), PF/ESI/professional tax amounts (registration + CA), place of supply / IGST on invoices (CA), GST payments to the government as a recorded outflow, payslips in Laboura Field (no design yet), salaries moving to an HR portal (later).

### Gate
- [ ] Every new table has `ENABLE ROW LEVEL SECURITY`; every route has a role guard; Managers, Team Leads and agents get 403 on every `/finance` route; the payslip self-service returns only the caller's own released payslips.
- [ ] Pay from attendance at monthly ÷ 26: on staff all month = the monthly salary (weekly offs and holidays paid); part of the month = ÷ 26 × working days on staff, never more than the monthly salary; then loss of pay, half days, unpaid leave and shortfall are deducted; net never below ₹0; PF/ESI/PT are zero lines.
- [ ] Prepare (from the 1st, final attendance) → approve the exact total (CEO only) / send back → pay with UTR → paid in one transaction; payslip visible to the person (a Manager too) only after payment.
- [ ] P&L counts approved salaries; bank movements include salary payments.
- [ ] Month-end: checklist, CEO-only close (note when unticked) and reopen (reason), audited; a closed month refuses expense, bank-day, payroll, payout, ignore and return changes, and late money is booked in the open month with a note.
- [ ] One UTR check across the books (409).
- [ ] Bells: salaries to release, salaries need the CEO, month not closed, payslip ready.
