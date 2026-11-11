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
