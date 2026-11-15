import type { LegalDocumentSource } from '../legal-document.types';

/** Owner-approved English text (Master Guide rev 176, 15 Nov). Numbers in {{…}} come from Settings. */
export const REFERRAL_TERMS_EN: LegalDocumentSource = {
  title: "Referral Partner Terms",
  summary: [
    "You earn **{{referralReward}}** when a job seeker you referred **joins a job** through Laboura. You earn nothing when they only register or pay.",
    "There is **no payment yet for referring businesses**, and **never** for referring yourself.",
    "The {{referralReward}} is queued on the joining day, approved by the CEO or Finance, and **paid daily** by UPI or bank transfer from Laboura's company account, **only to an account in your own name**.",
    "Changing your payout details needs an OTP, and then there is a **{{coolingHours}}-hour wait** before the next payout.",
    "**TDS** may be deducted once your yearly total crosses the legal limit, and you may need to give your PAN.",
    "You are **not a Laboura employee or agent**. **Never take money from job seekers** and never promise anyone a job.",
    "Calls with Laboura are **recorded**. We check your ID and take a selfie.",
  ],
  body: `| | |
| --- | --- |
| **Company** | Laboura Private Limited ("Laboura", "we", "us") |
| **CIN** | {{company.cin}} |
| **Registered office** | {{company.office}} |
| **GSTIN** | {{company.gstin}} |
| **Grievance Officer** | {{grievance}} |
| **Document** | Referral Partner Terms |
| **Version** | 1.0 |
| **Effective date** | {{company.effective}} |
| **Languages** | Kannada, Hindi and English. If the versions differ, the version in the language you chose is the one you agreed to. |


---

### 1. What this is

1.1 These terms apply to anyone registered as a Laboura **referral partner** (an RF- ID), whether an individual (for example an auto driver, shop staff, security guard or existing worker) or a business.

1.2 A job seeker or an existing worker can also be a referral partner.

### 2. How you register

2.1 A Laboura call agent or field agent registers you: your mobile is checked by OTP, and your type (individual or business), area, pincode, location and message language are recorded. You get an **RF- ID** by SMS.

2.2 You then get **one link that resumes where you stopped**. It takes you through:
1. these **terms** and the **call-recording consent**;
2. a **live selfie**;
3. an **ID check**;
4. your **UPI ID or bank account**.

2.3 You must be **18 or older**.

2.4 If you cannot read these terms, a Laboura agent will read them aloud to you on a recorded call before you give your OTP.

### 3. What earns money

3.1 You earn **{{referralReward}}** when a job seeker **you referred** **joins a job through Laboura**. "Joins" means Laboura has confirmed with the business and the job seeker, on the joining day, that the person started work.

3.2 You earn **nothing** when a person you referred only **registers** or **pays** the {{fee}}.

3.3 **Referring businesses:** for now, referring a business earns nothing. Payment for business referrals has not been decided yet. If it is introduced, Laboura will tell you and update these terms.

3.4 **You never earn for referring yourself.**

3.5 A referral counts only if it is recorded on the job seeker's Laboura registration as referred by you (your RF- ID). Laboura's records decide which partner referred a job seeker.

### 4. When and how you are paid

4.1 The {{referralReward}} is **queued automatically on the joining day**.

4.2 **A person approves every payout.** The CEO or Finance releases it, and payouts are **sent every day** once due (after any {{coolingHours}}-hour wait under clause 5.3).

4.3 Payouts are sent **by UPI or to your bank account, from Laboura's company account**, and only to details **in your own name**, checked against the name on your ID. Finance checks the receiver's name before sending and records the UPI or bank reference.

4.4 Each payout is linked to the exact joining it is for.

### 5. Your payout details

5.1 You add your **UPI ID** (preferred) **or bank account** yourself, on your own phone, with an OTP.

5.2 The details must be **in your own name**. If the name doesn't match your ID, Finance checks it before any payout.

5.3 **Changing your details** needs an **OTP on your registered phone**, then a **{{coolingHours}}-hour wait** before the next payout, and Finance is told. This stops anyone quietly putting in their own UPI.

5.4 Laboura keeps your full UPI ID or account number **encrypted**. Only the CEO and Finance can see it in full, and every time they do it is logged. Other screens show only a masked version.

5.5 Payouts are held for checking if your UPI or account matches a Laboura staff member's, or if several partners share one account.

### 6. Tax

6.1 Laboura keeps a **yearly total** of what it pays you.

6.2 If your total in a financial year crosses the limit set by income-tax law for this kind of payment, Laboura will deduct **TDS** at the rate the law requires (currently understood to be 2% above ₹20,000 a year, to be confirmed by Laboura's chartered accountant). Laboura will ask for your **PAN**. Without a PAN, the law may require a higher deduction.

6.3 TDS deducted is paid to the government in your name, and you can get the certificate from Laboura.

### 7. What you can see

7.1 You see only the **first name** of each person you referred and **their stage** (registered, paid, joined). You never see their phone number, ID, salary or other details.

7.2 You get a **payout statement** showing each payout, its date, the joining it is for and its reference.

### 8. Your conduct

8.1 You are **not an employee, agent or representative of Laboura**. You cannot sign anything or make any promise for Laboura.

8.2 **Never collect money from job seekers**, for any reason. The only money a job seeker pays is the {{fee}}, and only through Laboura's own payment link or QR code to Laboura's company account.

8.3 **Never promise anyone a job**, a salary or a result. You may tell people only what Laboura's own terms say.

8.4 Refer only people who **know about and agree to** being referred. Give Laboura true information.

8.5 Do not use Laboura's name or logo in a way that misleads people, and do not pretend to be Laboura staff.

8.6 **Pausing.** The CEO can **pause** your partnership, with a written reason. While you are paused, new referrals naming you are not accepted, but **money you have already earned is still paid**. Unpausing restores referrals. Both are logged.

8.7 **Permanent ban.** A Laboura Manager or the CEO may permanently end your partnership for **fraud** (for example fake referrals, self-referrals or taking money from job seekers), **forged or altered IDs**, **theft** or **violence**. Laboura shares records with the police **only on a lawful request**. Money obtained by fraud is not paid.

### 9. Calls and your data

9.1 **Calls with Laboura are recorded**, and each call starts with an announcement. You agree to this with a separate tick.

9.2 **ID check:** the **Aadhaar Secure QR** on your card is read **on your own phone**, and only its data is sent to Laboura; no picture of your card ever reaches Laboura. We keep only: the result, the method, the date and time, the **last 4 digits**, your name, date of birth, gender, area and pincode. The QR photo is kept only until a Team Lead compares it with your selfie, **30 days at most**. **We never keep your full Aadhaar number or a picture of your Aadhaar card.** You can use a **PAN, driving licence or voter ID** instead: a live photo of the card is checked by a Team Lead and deleted after the check (30 days at most), and only the ID type and the last 4 characters of its number are kept. If a check fails, only the result is kept.

9.3 **What we record about you:** name, mobile, type, area, pincode and location, language, selfie, ID check result, payout details, referrals and payouts, call records and recordings, and consent records.

9.4 **Why:** to register and verify you, track your referrals, pay you, meet tax law, and prevent fraud.

9.5 **Who we share it with:** Laboura's service providers (hosting, calling, SMS and WhatsApp, our bank or payout provider), only on our instructions; and the police or authorities only on a lawful request. People you refer never see your payout details.

9.6 **Where:** on servers in **Singapore**.

9.7 **How long:** your partner profile is kept while active plus **23 months** after your last activity, then **anonymised**. Call recordings are kept **1 year**, or until a dispute is closed. Payout and tax records are kept about **8 years**.

9.8 **Your rights** under the Digital Personal Data Protection Act, 2023: to get a summary of your data, correct or erase it (except what the law requires us to keep), withdraw consent, nominate someone, and complain to the Grievance Officer, {{grievance}}, and then to the Data Protection Board of India. Withdrawing the call-recording or ID consent means Laboura can no longer work with you as a partner, but money already earned is still paid.

### 10. Ending, changes and law

10.1 You can stop being a partner at any time by telling Laboura. Money already earned is still paid.

10.2 Laboura may change these terms (including the reward amount) with notice to you by SMS, WhatsApp or the app. A change never reduces a reward already earned for a joining that has happened.

10.3 These terms are governed by the laws of India. The courts in **Bengaluru, Karnataka** have jurisdiction.

---

## Your consent

| | Consent | Required? |
| --- | --- | --- |
| ☐ | **I agree to these Referral Partner Terms**, including that I am not a Laboura employee or agent, that I will never take money from job seekers or promise jobs, and the payout and TDS rules. | **Required** |
| ☐ | **I consent to calls with Laboura being recorded** for verification, coordination and quality. | **Required** |
| ☐ | **I consent to Laboura checking my ID** (Aadhaar Secure QR or another ID) and taking a live selfie, keeping only what clause 9.2 lists. | **Required** |
| ☐ | **Laboura app only:** Laboura may call, SMS or WhatsApp me to help me finish registering. | *Optional* |

Consent is given **only by an OTP** on your registration link or in the Laboura app.`,
};
