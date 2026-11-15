import type { LegalDocumentSource } from '../legal-document.types';

/** Owner-approved English text (Master Guide rev 176, 15 Nov). Numbers in {{…}} come from Settings. */
export const BUSINESS_AGREEMENT_EN: LegalDocumentSource = {
  title: "Business Hiring Agreement",
  summary: [
    "Laboura introduces verified job seekers to you. **You are the employer**, not Laboura.",
    "**Fee:** **{{feePercent}}% of the agreed first month's gross salary, plus {{gstPercent}}% GST**, for each person you hire. Example: salary ₹10,000 → fee {{ex10.fee}} + GST {{ex10.gst}} = **{{ex10.total}}**.",
    "**Pay when you select** a candidate, within **{{paymentDueHours}} hours** of the payment link, by UPI to Laboura's company account. The joining date is confirmed only after your payment reaches our bank.",
    "**{{windowDays}}-day guarantee** from the first employee's joining date: up to **{{maxReplacements}} free replacements**. If we can't find a replacement within **{{searchDays}} days** of your report, you get **100% of the fee back**.",
    "**Report a worker leaving within {{claimDays}} days**, with a reason from the list in clause 11. Some reasons are not covered.",
    "**No bypass:** if you hire anyone Laboura introduced within **{{noBypassMonths}} months** without paying Laboura, you owe the **full fee plus {{penaltyPercent}}%, plus GST**.",
    "Candidates' phone numbers are hidden, and **calls go through Laboura's number and are recorded**.",
    "Keep candidates' details private and use them only to hire for your vacancy.",
  ],
  body: `| | |
| --- | --- |
| **Company** | Laboura Private Limited ("Laboura", "we", "us") |
| **CIN** | {{company.cin}} |
| **Registered office** | {{company.office}} |
| **GSTIN** | {{company.gstin}} |
| **Grievance Officer** | {{grievance}} |
| **Document** | Business Hiring Agreement |
| **Version** | 1.1 |
| **Effective date** | {{company.effective}} |
| **Languages** | Kannada, Hindi and English. If the versions differ, the version in the language the signer chose is the one agreed. |

This agreement is between **Laboura Private Limited** and the business, shop, firm, company, proprietor or household that registers with Laboura (**"the business"**, **"you"**).


---

### 1. Who signs and what this covers

1.1 The **contact person** (the owner, a manager, HR or another person the business authorises) signs this agreement **by OTP** on their own verified mobile and ticks to confirm that they **have authority to agree on the business's behalf**.

1.2 **One agreement covers all your branches.** Each branch can have its own address, map pin and contact person, who receives that branch's interview results and payment links.

1.3 A household hiring help uses the same agreement, under a family name and without GST or licence details.

### 2. What Laboura does, and what it does not do

2.1 Laboura finds and verifies job seekers, matches them to your vacancies, books interviews and follows up.

2.2 **Laboura is not the employer** of any candidate or employee, and is not a labour contractor or a staffing agency that supplies workers on its payroll. Once you hire someone, the employment is **only between you and that person**.

### 3. Verifying your business

3.1 **Documents are optional.** If you have them, we record your GSTIN (checked online), Udyam registration, Shops and Establishments or trade licence, FSSAI licence (for food businesses) or PAN.

3.2 **Verification visit.** A Laboura field agent visits your premises and records: the **GPS location**, a **live photo of your storefront** with its name board, **the agent's selfie** at the shop, and **your contact person's OTP**. A **Team Lead** then checks the visit.

3.3 **No candidates are shown until the visit is done and the Team Lead approves it.** The one exception: when a field agent onboards you **in person** (GPS check, live storefront photo, and this agreement signed by OTP during the visit), candidates may be shown and interviews booked in the same visit. The Team Lead reviews it the same day and can pause it if something is wrong.

3.4 **Businesses with no documents** are labelled **"No documents"** and get extra checks: the field agent must be at the shop, the shop photo is taken live in the app, the Team Lead checks the photo and pin and calls you through Laboura's system, and a field agent attends your interviews in person.

3.5 Laboura may refuse or pause a business that gives false details or whose premises or business cannot be verified.

### 4. Your vacancies

4.1 Each vacancy records the role, number of openings, salary range, extras, hours, shift, weekly off, job location, requirements, start date and interview window.

4.2 **Every vacancy is confirmed by your contact person's OTP.** Nobody can add a vacancy for you without it.

4.3 **Minimum wage.** If the salary offered is below the legal minimum wage, Laboura shows you the legal minimum and records that you were told about it before the vacancy is saved. **Paying at least the legal minimum wage is your responsibility** (clause 13).

4.4 Ask for an age range or gender only where the law allows it and the job genuinely needs it.

### 5. Candidates and interviews

5.1 Laboura shows you **2 or 3 matching candidates at a time**. Each card shows the candidate's first name, photo, age, experience, languages, distance, expected salary and verified status, and why they match. **Every profile shown to you is logged**, with the date.

5.2 **Candidates' phone numbers are hidden.** Calls with candidates go through Laboura's company number and are **recorded**, with an announcement at the start of each call. Your contact person agrees to this with a separate tick when signing.

5.3 **Interviews** are usually **walk-ins between 10:30 AM and 6 PM** on the booked day. A field agent may also connect you and a candidate on a recorded call in your shop, which counts as a first interview.

5.4 **A Laboura field agent attends your first interview** in person, and any interview of a business labelled "No documents" or flagged for a pattern of rejections.

5.5 **Recording the result.** After the interview you get a message to record the result in the Laboura page or app, confirmed by OTP, **by 8 PM the same day**:
- **Selected** (with the monthly salary you will pay and the joining date);
- **Not selected**, with a reason; or
- **The candidate didn't come.**

If we don't hear from you, an agent calls you. After {{resultEscalateHours}} hours a Team Lead is told. **Laboura does not use an "on hold" result:** each interview ends as one of the three results above.

5.6 Laboura also asks the candidate, **"Did they offer you the job?"** If the answers don't match, a Team Lead checks it the same day.

5.7 **Follow-up calls.** Laboura calls "not selected" candidates after about 7, 30 and 90 days to ask whether they are working, and where. Laboura calls you and the employee around **day 7 and day 30** after joining.

### 6. How you treat candidates (conduct rules)

6.1 **Rescheduling:** you may reschedule a confirmed interview **at most 2 times per vacancy**, and each time you must tell Laboura **at least 2 hours** before the interview.

6.2 **Attend to candidates within 30–45 minutes** of their arrival at a walk-in, and treat them with respect.

6.3 Do not ask a candidate for money, and do not keep a candidate's original ID documents, certificates or phone.

6.4 **Suspension.** If a business repeatedly cancels confirmed interviews, doesn't turn up to its own interviews, or misuses candidates' data, the CEO may suspend it for **30 to 90 days**, or permanently in serious cases (including forged documents or fraud). Laboura tells you the reason. Fees already owed remain payable.

### 7. The placement fee

7.1 **For each person you hire** through Laboura, you pay **{{feePercent}}% of the agreed first month's gross salary, plus {{gstPercent}}% GST**.

| Monthly salary | Fee ({{feePercent}}%) | GST ({{gstPercent}}%) | Total |
| --- | --- | --- | --- |
| ₹10,000 | {{ex10.fee}} | {{ex10.gst}} | **{{ex10.total}}** |
| ₹15,000 | {{ex15.fee}} | {{ex15.gst}} | **{{ex15.total}}** |

Hiring 3 people at ₹10,000 each costs 3 × {{ex10.total}} = {{ex10.total3}}.

7.2 The fee is worked out from **the salary actually agreed** with the employee. If it turns out the salary agreed was higher than the salary you recorded, the fee on the difference (plus GST) is payable.

7.3 There is **no advance and no deposit** per vacancy. You pay only when you select someone.

### 8. Paying the fee

8.1 **When:** as soon as you select a candidate, Laboura sends a payment link or QR code. **Pay within {{paymentDueHours}} hours of receiving it.**

8.2 **How:** by UPI, using Laboura's link or QR code, **to Laboura Private Limited's company account only**. Each code carries the exact amount and a reference. Never pay a Laboura staff member personally.

8.3 **A screenshot is not proof of payment.** A payment counts only when the money reaches Laboura's bank.

8.4 **The joining date is confirmed to the candidate only by Laboura, and only after your payment reaches our bank.** If the fee is not paid within {{paymentDueHours}} hours, Laboura does not confirm the joining date. Hiring the candidate without paying is a bypass (clause 9).

8.5 **Invoice:** a GST invoice is created automatically and sent to your billing email. If a refund is made, Laboura issues a **credit note**.

8.6 **TDS:** if you deduct TDS from the fee, you must send Laboura the **TDS certificate**. A payment that arrives short by exactly the TDS amount is recorded as "TDS deducted", and the certificate is still owed.

8.7 **What you get after paying:** the candidate's **full name and the joining details**. The candidate's phone number stays hidden, and calls go through Laboura's number, **until the joining day**. From the joining day, you and the employee may exchange numbers directly.

8.8 **Joining day:** Laboura calls you and the employee to confirm that they joined. This date starts the guarantee (clause 10).

### 9. No bypass

9.1 **Introduced** means Laboura showed you a candidate's profile or booked an interview with them. Every profile shown is logged.

9.2 If you hire, engage or employ **anyone Laboura introduced**, **within {{noBypassMonths}} months** of the introduction, **directly or through anyone else** (another branch, a related business, a relative, a contractor or an agency), without paying Laboura's fee, you must pay:

**the full fee + {{penaltyPercent}}% of the fee, plus GST.**

**Example:** salary ₹15,000 → fee {{ex15.fee}} + {{penaltyPercent}}% {{ex15.penalty}} = **{{ex15.bypass}} + GST**.

9.3 This applies even if you recorded the candidate as "not selected". Your OTP-confirmed "not selected" result is a signed record.

9.4 Laboura checks for bypass through follow-up calls, the "did they offer you?" question, the refund check with job seekers, and field agents' revisits.

9.5 **A person hired directly gets no guarantee and no replacement.**

### 10. The {{windowDays}}-day replacement guarantee

10.1 **The {{windowDays}} days start on the joining date of the first employee** for that placement. **The clock never restarts**, including when a replacement joins.

10.2 **Up to {{maxReplacements}} free replacements** within those {{windowDays}} days.

10.3 **To make a claim:**
- **report that the worker left within {{claimDays}} days** of their leaving, through Laboura (any Laboura agent or your account agent);
- pick **a reason from the list in clause 11**;
- **your fee must be fully paid**;
- only **one open claim per placement** at a time.

10.4 **How Laboura decides:** Laboura makes a **recorded exit call to the worker**. A Team Lead or Manager accepts or rejects the claim **within {{decisionHours}} hours**, with the reason recorded.

10.5 **Replacement within {{searchDays}} days.** If Laboura cannot provide a replacement within **{{searchDays}} days of your report**, you get a **flat 100% refund of the placement fee**. A person (Finance or the CEO) approves every refund. A credit note is issued.

10.6 **When the guarantee ends with no refund:**
- you **reject {{maxRejections}} replacement candidates**; or
- the **second replacement also leaves** within the {{windowDays}} days; or
- the {{windowDays}} days end.

Anyone you hire after that is a **new placement at the normal fee**, with a new guarantee.

10.7 **A selected candidate who never joins.** If a candidate you selected and paid for doesn't join on the joining day, Laboura calls them. If they are not joining, Laboura finds you a replacement at no extra cost. **This does not count toward your {{maxReplacements}} free replacements.**

10.8 **A higher-paid replacement.** If a replacement is hired at a higher salary than the highest salary you have already paid a fee on for this vacancy, you pay **{{feePercent}}% of the difference, plus GST**, before the replacement joins. Example: original salary ₹12,000, replacement salary ₹14,000 → you pay {{exUp.diff}} + GST. If a later replacement is paid ₹14,000 or less, there is nothing more to pay.

10.9 **Reporting again after a rejection:**
- If a claim was rejected for a **mistake that can be fixed** (for example a wrong leaving date, or the owner call didn't confirm it), you may report it **once more within the original {{claimDays}} days**.
- A claim rejected because the reason is **not covered**, it was **reported late**, or the **fee was not fully paid** cannot be reported again.
- A **Manager or the CEO** may overrule an automatic rejection, or reopen a reviewed one, with a reason.

10.10 **A reason that is not covered means only that the claim is not accepted.** The rest of your guarantee continues for any later claim on a covered reason within the {{windowDays}} days.

10.11 The remedies in this clause are replacement, or the refund in clause 10.5. Laboura does not offer hiring credit instead of a refund.

### 11. Claim reasons

| Covered: free replacement | Software code |
| --- | --- |
| The worker resigned or left | \`resigned\` |
| The worker stopped coming for 3 or more days without notice | \`absconded_3_days\` |
| The worker accepted but never joined (clause 10.7) | \`never_joined\` |
| Dismissed for serious misconduct, with evidence (for example theft, drunk on duty, violence) | \`serious_misconduct\` |
| Repeated unexplained absence | \`repeated_absence\` |
| Couldn't do the agreed work, within the first 15 days | \`skill_gap_15_days\` |
| Lied about their skills or experience | \`misrepresentation\` |
| Became medically unfit to work, or moved out of the city | \`medically_unfit_or_relocated\` |

| Not covered: no replacement for this claim | Software code |
| --- | --- |
| The business closed or downsized, the job no longer exists, or the business let the worker go because work was slow or a season ended | \`business_closed\` |
| The business changed the role, salary, hours, shift or location | \`role_changed\` |
| The business didn't pay the salary, or paid it late | \`salary_unpaid\` |
| Unsafe or abusive workplace (including keeping the worker's ID or phone) | \`unsafe_workplace\` |
| Fired with no reason, or with a reason the worker's account contradicts | \`fired_without_reason\` |
| The business hired a relative or its own person instead | \`hired_own_person\` |
| Reported more than {{claimDays}} days after the worker left | automatic: \`reported_late\` |
| The placement fee was not fully paid | automatic: \`fee_unpaid\` |

### 12. Verification limits and liability

12.1 **What Laboura checks:** a candidate's identity and age (Aadhaar Secure QR, or a PAN, driving licence or voter ID checked by a Team Lead) and a live selfie. **Laboura does not do police, court or background checks.**

12.2 A verified status is **not a guarantee** of a person's honesty, character or skill. Do your own skill test, and your own police verification where the role needs it, and supervise new staff before trusting them with cash, keys, vehicles or stock.

12.3 **Laboura is not responsible** for anything a candidate or employee does or fails to do, including theft, damage, fraud, accidents, disputes with customers, or leaving without notice. If a candidate commits a crime, Laboura will act under its own rules (which can include a permanent ban) and share its records with the police **on a lawful request**.

12.4 **Indemnity:** you will cover Laboura for claims, penalties and costs caused by your own breach of this agreement or of labour law (for example unpaid wages, PF, ESI or safety failures).

12.5 **Limit of liability:** Laboura's total liability to you for any placement is limited to the placement fee you paid for it. This limit does not apply where the law does not allow it, for example for fraud.

### 13. Your duties as the employer

You are the employer, and you are responsible for:
- paying at least the **legal minimum wage**, on time;
- **PF, ESI** and other statutory contributions where they apply;
- the **Karnataka Shops and Commercial Establishments Act** and other labour laws that apply to you;
- **never employing anyone under 18** through Laboura, and never employing children;
- a **safe workplace**, especially for women working late or night shifts;
- giving the employee the working terms agreed at selection.

### 14. Keeping candidates' data private

14.1 All candidate profiles, photos and verification details shared by Laboura are **confidential** and may be used **only to evaluate and hire for your declared vacancy**.

14.2 Under the **Digital Personal Data Protection Act, 2023**, you must not forward, sell, publish or share candidates' personal data with anyone else, including other shop owners or WhatsApp groups. Delete the details of candidates you did not hire once you no longer need them.

14.3 Misuse of candidates' data can lead to suspension (clause 6.4) and legal action.

### 15. Your business's data

15.1 **What we record:** business names and type; address, map pin and storefront photo; documents (if any); branches; the contact person's name, role and verified mobile; billing email; vacancies; visit records and photos; interview results; payments and invoices; call records and recordings; consent and signing records.

15.2 **Why:** to verify you, match candidates, run interviews and placements, take payments, provide the guarantee, prevent bypass and fraud, and keep tax records.

15.3 **Who sees it:** candidates who are booked for an interview get your business name, address, interview time and the name of the person to ask for. They never get the owner's personal phone number. Laboura's service providers (hosting, calling, SMS and WhatsApp, our bank) process data only on our instructions. The police or authorities get data only on a lawful request.

15.4 **Where:** on servers in **Singapore**.

15.5 **How long:** business and contact person records are kept while active plus **23 months** after the last activity, then **anonymised**. Call recordings are kept **1 year**, or until a dispute is closed. Invoices and payments are kept about **8 years**.

15.6 **Rights:** your contact person and any individual whose data we hold may ask to see, correct or erase their data (except what the law requires us to keep), withdraw consent, nominate someone, and complain to the Grievance Officer, {{grievance}}, and then to the Data Protection Board of India.

### 16. Ending this agreement

16.1 Either side can stop working together at any time by telling the other.

16.2 These continue after the end: fees already owed, the no-bypass rule ({{noBypassMonths}} months from each introduction), confidentiality of candidates' data, and any guarantee already running for a paid placement.

### 17. Changes, notices and law

17.1 Laboura may update this agreement. We will send the new version to your contact person by SMS or WhatsApp and to your billing email. A new version applies to vacancies added after you accept it; a placement already paid keeps the version it was paid under.

17.2 Notices to you go to your contact person's verified mobile and your billing email.

17.3 This agreement is governed by the laws of India. The courts in **Bengaluru, Karnataka** have jurisdiction.

17.4 If any part of this agreement is found unenforceable, the rest still applies.

---

## Signing by OTP

The contact person ticks each box, then enters the OTP sent to their verified mobile.

- ☐ **I agree to these terms** on behalf of the business, including the {{feePercent}}% fee plus GST, payment at selection, the {{windowDays}}-day guarantee and its claim reasons, and the no-bypass rule.
- ☐ **I have authority** to agree on the business's behalf (as owner, manager, HR or an authorised person).
- ☐ **I agree my calls with Laboura are recorded**, including calls Laboura connects with candidates, for quality, service and resolving disputes.

A Laboura agent can read this agreement aloud on a recorded call before the OTP is entered.`,
};
