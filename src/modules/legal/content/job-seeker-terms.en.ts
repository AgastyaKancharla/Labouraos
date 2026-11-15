import type { LegalDocumentSource } from '../legal-document.types';

/** Owner-approved English text (Master Guide rev 176, 15 Nov). Numbers in {{…}} come from Settings. */
export const JOB_SEEKER_TERMS_EN: LegalDocumentSource = {
  title: "Job Seeker Terms, Consent and Privacy Notice",
  summary: [
    "You pay **{{fee}}** once to register. Laboura is **not your employer**. The business that hires you is your employer and sets your salary.",
    "**Our promise:** within **{{guaranteeDays}} days** of your {{fee}} reaching Laboura's bank, we give you at least **one suitable job offer** (a confirmed interview), **or you get the full {{fee}} back**, with nothing taken off.",
    "\"Suitable\" means: your trade, a salary at or above the floor you saw and ticked before paying, within your travel distance, your shift, and a real business with a real interview time.",
    "**Your refund ends** if you say no to a suitable offer, don't reply to an offer within **{{offerReplyHours}} hours**, don't go to a booked interview, find a job on your own, stop wanting a job, or work at a business Laboura introduced you to without going through Laboura.",
    "**{{maxHits}} \"hits\" switch off your profile.** A hit is: not picking up (a morning call, an evening call and a WhatsApp or SMS on the same day), saying no to a suitable offer, not replying in {{offerReplyHours}} hours, or not going to an interview. You can come back by paying {{fee}} again.",
    "All calls go through Laboura's number and are **recorded**. **Businesses never see your phone number.**",
    "We check your ID using your **Aadhaar Secure QR** or a **PAN, driving licence or voter ID**. We never keep your full Aadhaar number or a picture of your Aadhaar card.",
    "You get **{{joiningReward}}** after you have worked {{joiningRewardDays}} days in a job you joined through Laboura.",
    "You give six separate permissions (five required, one optional). You can withdraw them, but withdrawing the job permissions after paying ends your refund.",
  ],
  body: `| | |
| --- | --- |
| **Company** | Laboura Private Limited ("Laboura", "we", "us") |
| **CIN** | {{company.cin}} |
| **Registered office** | {{company.office}} |
| **GSTIN** | {{company.gstin}} |
| **Grievance Officer** | {{grievance}} |
| **Document** | Job Seeker Terms, Consent and Privacy Notice |
| **Version** | 1.1 |
| **Effective date** | {{company.effective}} |
| **Languages** | Kannada, Hindi and English. You choose the language. If the versions differ, the version in the language you chose is the one you agreed to. |


---

## Part A: Terms

### 1. What Laboura does

1.1 Laboura finds job seekers and introduces them to businesses that need salaried staff in Bengaluru. We match your profile to suitable vacancies, book interviews, and follow up with you and the business.

1.2 These terms apply when you register with a Laboura agent, through a Laboura registration link, or in the Laboura app.

### 2. Laboura is not your employer

2.1 Laboura introduces you to businesses. **We do not employ you**, we do not pay your salary, and we do not decide your working hours or conditions.

2.2 **The salary is offered by the business, not by Laboura.** Your job, salary, hours, leave and other working terms are agreed between you and the business.

2.3 The business, as your employer, is responsible for paying at least the legal minimum wage and for PF, ESI and its other legal duties. If you have a problem with your employer, please tell Laboura. We will record it and use it when deciding whether to keep working with that business, but your legal claim for wages or working conditions is against the employer.

### 3. Who can register

3.1 You must be **18 or older** and allowed to work in India.

3.2 If the ID check shows you are under 18, **registration stops before any payment is taken**. The stop stays even if you try another ID. Only a Laboura Manager or the CEO can lift it, for example if the date on the card was wrong or a family member's card was used by mistake.

3.3 **If you cannot read these terms**, a Laboura agent will read them aloud to you in your language on a recorded call before you give your OTP. The recording is kept as proof that the terms were explained to you.

### 4. How registration works

4.1 **With an agent.** A Laboura agent checks your mobile number with an OTP, fills in your profile with you, and reads you the consent explanation and the call-recording notice in your language. You get a Laboura ID (it starts with JS-).

4.2 **The registration link.** We send one link by SMS. It works for **{{linkHours}} hours** and opens only after an OTP sent to your registered number. You can open it on any smartphone (yours, a family member's or the agent's), but the OTP always goes to your number. It takes you through four steps in this order:
1. **Consent**: you tick each permission separately (Part B).
2. **Selfie**: a live camera photo. Gallery photos are not accepted.
3. **ID check**: Aadhaar Secure QR, or a PAN, driving licence or voter ID (clause 13).
4. **Terms and payment**: you see your exact guarantee terms, tick to agree, and pay {{fee}}.

Each step is saved as soon as you finish it. If you open the link again, or a new one, you carry on from the first unfinished step. Only one link works at a time: sending a new one switches off the old one.

4.3 **In the Laboura app.** You can sign in with **Google** or with your **mobile number and an OTP**. You give your consent inside the app, and the same steps and rules apply (clause 16).

4.4 **Someone else paying.** Once you reach the payment step, you or the agent can send a payment-only link to another number, such as a family member's. It shows only your first name, your Laboura ID and {{fee}}. It works for **{{payOnlyMinutes}} minutes**, and a fresh one can be sent with one tap.

4.5 **If your trade is not on our list**, you can finish consent, selfie and ID, but payment waits until Laboura adds your trade. Your {{guaranteeDays}} days never run while we cannot match you.

### 5. The {{fee}} registration fee

5.1 The fee is **{{fee}}**, paid once for each registration.

5.2 You pay by UPI to **Laboura Private Limited's company bank account**, using the QR code or UPI link Laboura gives you. Each code carries the exact amount and your reference. Never pay anyone's personal UPI, and never pay any agent or anyone else in cash.

5.3 **A screenshot is not proof of payment.** Your payment counts only when the money reaches Laboura's bank. Until then your status shows "Paid — confirming".

5.4 **Your {{guaranteeDays}} days start on the day the {{fee}} is confirmed in Laboura's bank.**

5.5 If the same registration is paid twice by mistake, **the second payment is refunded in full**.

5.6 Apart from this {{fee}}, Laboura never asks you for money. Report anyone who asks you for money in Laboura's name to the Grievance Officer.

### 6. The {{guaranteeDays}}-day guarantee

6.1 **Our promise.** Within {{guaranteeDays}} days of your {{fee}} being confirmed in Laboura's bank, Laboura gives you at least **one suitable job offer**. If we don't, **you get the full {{fee}} back, with nothing taken off** (clause 9).

6.2 **What an "offer" is.** An offer is a **confirmed interview**: a real business, a suitable vacancy and a set interview time. If you go to the interview and the business does not select you, it is not your fault. You get no hit, your {{guaranteeDays}} days keep running, and Laboura keeps looking for you.

6.3 **What "suitable" means.** The software checks this; the agent does not decide it. An offer is suitable only if all of these are true:
- it is in **your trade**;
- the **salary is at or above your salary floor** (clause 6.4);
- the job is **within the distance you said you will travel**;
- it matches **your shift preference**;
- it is with a **real business** and has a **real interview time**.

6.4 **Your salary floor.** Your floor is the **lower** of (a) the minimum salary you asked for and (b) the top of the usual Bengaluru salary range for your trade. **Example:** a painter asks for at least ₹30,000. The usual range for painters tops out at ₹28,000, so his floor is ₹28,000, and any offer of ₹28,000 or more is suitable. The payment page shows your exact terms (trade, distance, shift and salary floor), and **you tick to agree before you pay**.

6.5 **Offers below your floor.** Laboura may still tell you about a job that pays less than your floor. Saying no to it is **never a hit** and never affects your refund.

6.6 **How you are told about an offer.** An agent calls you, and an automatic SMS and WhatsApp follow with the details. **You have {{offerReplyHours}} hours to reply.** This applies on every day of your {{guaranteeDays}} days, including the last: an offer made on day 29 can be answered up to {{offerReplyHours}} hours later, even after day {{guaranteeDays}}.

6.7 **When the guarantee is met.** Laboura's promise is kept once you are selected for a job through Laboura. If a business you were introduced to selects you and you choose not to take the job, that counts as saying no to a suitable offer (clause 7.1).

### 7. What ends your refund

7.1 Any **one** of these ends your right to the {{fee}} refund straight away, on any day, even before you have {{maxHits}} hits:
- **saying no to a suitable offer**;
- **not replying to an offer within {{offerReplyHours}} hours**, even if the {{offerReplyHours}} hours run past day {{guaranteeDays}};
- **not going to an interview** that was booked for you.

7.2 These also end your refund:
- **You find a job on your own** (not through Laboura) during your {{guaranteeDays}} days. Laboura records this only after an answered, recorded call with you. Your profile is closed, and you can register again later.
- **You no longer want a job through Laboura after paying.** This includes withdrawing your permission for **job matching**, **profile sharing** or **call recording** (Part B), because without these Laboura cannot find you a job. It also includes **deleting your Laboura app account while your {{guaranteeDays}} days are running** (clause 16.6).
- **You are working at a business Laboura introduced you to** without the job going through Laboura. Before any refund is approved, we ask you this on a recorded call (the "refund-check call"). If the answer is yes, there is no refund, and that business owes Laboura its fee.

7.3 Withdrawing your permission for **job updates** or **promotions** does **not** affect your refund.

### 8. Hits and switching off your profile

8.1 A **hit** is recorded only for these four things:

| Hit | What it means |
| --- | --- |
| **No pickup** | You did not pick up a **morning call** or an **evening call**, and you were also sent a **WhatsApp or SMS**, all on the same day. This is recorded only by Laboura's phone system; an agent cannot type it in. App notifications never count. |
| **Offer declined** | You said no to a suitable offer. |
| **Offer not replied to** | You did not reply to a suitable offer within {{offerReplyHours}} hours. |
| **Interview no-show** | You did not go to an interview that was booked for you. |

8.2 **Not a hit:** a business deciding not to select you; a business owner saying no after talking to you, before any interview is booked; saying no to an offer below your salary floor.

8.3 **If you can't go to a booked interview**, call Laboura before the interview time. The agent will tell the business and record what happened. A booked interview that you do not go to is still recorded as a no-show.

8.4 **{{maxHits}} hits switch off (deactivate) your profile.** Laboura stops matching you, and there is no refund.

8.5 **Coming back.** To use Laboura again after your profile is switched off, pay {{fee}} again. Your hits go back to zero and you get a new {{guaranteeDays}} days.

8.6 **A wrong hit.** If you think a hit was recorded by mistake, tell Laboura. A Team Lead can reverse a wrongly recorded hit, with a written reason. Calls behind hits are checked by Team Leads.

### 9. Refunds

9.1 After day {{guaranteeDays}}, you are owed the **full {{fee}}**, with nothing taken off, if **all** of these are true:
- you were not selected for a job through Laboura (clause 6.7);
- your profile was not switched off (clause 8.4);
- nothing in clause 7 happened;
- no offer is still waiting for your reply.

9.2 **The refund-check call.** Before a refund is approved, Laboura calls you on a recorded line and asks whether you are working, and where (clause 7.2).

9.3 **A person approves every refund.** Refunds are never sent automatically. The CEO or Finance approves each one and sends it by UPI from Laboura's company account. The UPI reference is recorded, and you can see your refund status from your Laboura agent or in the Laboura app.

9.4 A refund that has already been approved is always paid, including if you later delete your account (clause 16.6).

### 10. {{joiningReward}} joining reward

10.1 If you join a job through Laboura and are **still working there {{joiningRewardDays}} days after joining**, Laboura pays you **{{joiningReward}}**.

10.2 We collect your UPI ID when you join. The name on the UPI account must match the name on your ID. The reward is released by the CEO or Finance and paid from Laboura's company account. Rewards are paid daily once they are due.

10.3 You get no reward for a job you did not join through Laboura.

### 11. Interviews

11.1 Before an interview is booked, the agent tells you only the job type, area, salary and shift. Once the interview is booked, **Laboura's automatic SMS and WhatsApp** give you the business name, address, time and who to ask for. Laboura does not give you the owner's personal phone number.

11.2 Interviews are usually **walk-ins between 10:30 AM and 6 PM** on the booked day.

11.3 After the interview, Laboura asks you: **"Did they offer you the job?"** Please answer truthfully. It protects you if a business says "not selected" and then hires you quietly.

11.4 At a business's first interview, a Laboura field agent may be there in person.

11.5 If a business does not select you, Laboura may call you after about 7, 30 and 90 days to ask whether you are working, and where.

11.6 If a business selects you, **only Laboura confirms your joining date**, and only after the business has paid Laboura's fee. On the joining day Laboura calls you and the business to confirm that you joined. Laboura also calls you around day 7 and day 30 of the job to check how it is going.

### 12. Calls, messages and your phone number

12.1 **Every call goes through Laboura's company number and is recorded.** Each call starts with: *"This call is recorded for quality and service."* This applies to calls with Laboura's agents and to calls Laboura connects between you and a business.

12.2 **Your phone number is never shown to businesses.** They reach you only through Laboura's number. After you are selected and the business has paid, the business gets your **full name and joining details**. Your number stays hidden until your joining day. From the joining day, you and your employer may exchange numbers directly.

12.3 Laboura calls between **9 AM and 9 PM**, and within the best time to call that you gave us.

12.4 **Service messages** (OTPs, payment receipts, interview details, offers, joining confirmations and refund updates) are sent by call, SMS, WhatsApp and, in the app, by notification. They are part of the service you asked for, and they are sent through message templates registered as the telecom rules require. **Promotions** are sent only if you ticked the optional promotions box.

### 13. ID check and selfie

13.1 **Selfie.** We take a live camera selfie (no gallery photos). A field agent may retake it in person. Your selfie is **shown to businesses** on your candidate card.

13.2 **Aadhaar Secure QR (main method).** The Secure QR code on your Aadhaar card is read **on your own phone**, either with the camera or from your e-Aadhaar PDF, which stays on your phone. A field agent may also scan it live in the Laboura Field app. Only the QR's data is sent to Laboura; **no picture of your card and no PDF ever reaches Laboura**. Laboura checks UIDAI's digital signature, checks that you are 18 or older, compares the name with your registered name, and checks whether your phone is linked to that Aadhaar. A phone that is not linked is a note for the Team Lead, not a refusal.

**What we keep:** verified or not; the method; the date and time; the **last 4 digits** of your Aadhaar number and the QR's time stamp; your name, date of birth, gender, area and pincode; whether the name matches; whether your phone is linked to that Aadhaar; whether you are 18 or older; and your consent.
**The photo from the QR** is kept only until a Team Lead compares it with your selfie, and **30 days at most**.
**What we never keep:** your full Aadhaar number, any picture of your Aadhaar card, your e-Aadhaar PDF or XML, or your full address.

13.3 **PAN, driving licence or voter ID (always offered).** You never have to use Aadhaar. You take a live camera photo of the card (no gallery upload) and type its number. A Team Lead compares the card photo with your selfie and the details you typed, then approves or rejects. **We keep only the ID type and the last 4 characters of its number.** The card photo is deleted after the Team Lead's check, and **30 days at most**.

13.4 **If a check fails** (for example the name doesn't match or the age is under 18), we keep **only the result**, not the name, date of birth or area from that card, because the card may belong to someone else. A name that looks like a spelling difference goes to a Team Lead to review. You can always try another ID.

13.5 **No police, court or background checks.** Laboura checks only your identity and age. Businesses see a "verified" status, nothing more.

### 14. What businesses see about you

14.1 Before selection, a business sees only your candidate card: **first name, selfie, age, years of experience, languages, distance from the job, expected salary and verified status**.

14.2 A business never sees your phone number, your ID details, your gender, your exact address or your map pin. On the map, you appear only as a dot for your area, never at your home.

14.3 Every profile shown to a business is logged.

14.4 What a business gets after it selects you and pays is set out in clause 12.2.

### 15. Your conduct

15.1 Give true details about your identity, skills, experience and salary.

15.2 Do not pay anyone except Laboura, and only through Laboura's own payment link or QR code.

15.3 Do not share business details that Laboura gives you with anyone else, and do not use them to bypass Laboura.

15.4 **Permanent ban.** A Laboura Manager or the CEO may permanently ban you from Laboura, with no refund, for a **forged or altered ID**, **fraud**, or **theft or violence** connected with a Laboura interview or job. Laboura shares your records with the police **only on a lawful request**, such as a written notice under the law.

### 16. The Laboura app

16.1 You can sign in with Google or with your mobile number and an OTP. A Google account must also verify a mobile number before registering.

16.2 You give your consent in the app the same way as on the registration link (Part B). The app's "Promotions" switch turns that permission on or off.

16.3 **Switching off "Job updates" in the app** stops job alerts in the app only. **It is not withdrawing your consent**; to withdraw, see Part B.

16.4 **Service notifications cannot be switched off while your {{guaranteeDays}} days are running.**

16.5 **Quiet hours.** Between **9 PM and 9 AM**, app notifications wait until 9 AM. The exceptions are sign-in codes (OTPs) and receipts for something you have just done. You get **at most 3 non-urgent app notifications a day**.

16.6 **Deleting your account.** You can ask to delete your account in the app after confirming with an OTP (or by signing in to Google again).
- **If your {{guaranteeDays}} days are running, deleting ends your refund.** The app shows you a clear warning first, and you must confirm it.
- **If a refund is already owed or approved, it is still paid**, and your account is deleted after it has been paid.
- Payment, invoice, refund and payout records are kept for as long as the law requires (Part C, section 7).

16.7 A sign-up helper tick in the app lets Laboura contact you to finish registering (Part B). Without it, you get only app reminders and no calls about finishing your sign-up.

### 17. Liability

17.1 Laboura does not promise that you will be hired, or how long a job will last. Laboura is not responsible for an employer's acts, unpaid wages, workplace accidents or disputes at work.

17.2 Laboura's total liability to you under these terms is limited to the fees you paid Laboura in the 12 months before your claim. This limit does not apply where the law does not allow it, for example for fraud or for harm Laboura caused on purpose.

17.3 Nothing in these terms takes away your rights under consumer protection law.

### 18. Changes to these terms

18.1 Laboura may update these terms. We will tell you by SMS, WhatsApp or the app, and show the new version number.

18.2 The guarantee you paid for runs on the terms you agreed when you paid. We will ask for fresh consent where the law requires it, for example for a new purpose of use.

### 19. Complaints and law

19.1 **Complaints:** contact the Grievance Officer, {{grievance}}. We aim to reply within the time set by law.

19.2 These terms are governed by the laws of India. Subject to your rights under consumer protection law, the courts in Bengaluru, Karnataka have jurisdiction.

---

## Part B: Your consent (permissions)

Read each permission and tick it separately. **The first five are required**: without them Laboura cannot register you or find you a job. **The sixth is optional**: you can say no and still use Laboura fully.

| | Permission | Required? | What you agree to | If you withdraw it later |
| --- | --- | --- | --- | --- |
| ☐ | **1. Job matching** | **Required** | I consent to Laboura matching my profile with potential employers and vacancies. | Laboura stops matching you. **After paying, this ends your refund.** |
| ☐ | **2. Profile sharing** | **Required** | I consent to Laboura sharing my work experience and verified details with prospective employers: my first name, selfie, age, experience, languages, distance, expected salary and verified status, **never my phone number**. | Businesses stop seeing your card. **After paying, this ends your refund.** |
| ☐ | **3. Call recording** | **Required** | I consent to calls with Laboura staff and prospective employers being recorded for quality and verification. Every call starts with an announcement. | Laboura cannot call you through its system. **After paying, this ends your refund.** |
| ☐ | **4. ID check (Aadhaar or another ID)** | **Required** | I consent to Laboura checking my ID to confirm who I am and that I am 18 or older. **Aadhaar:** the Secure QR code on my Aadhaar is read on my own phone (or from my e-Aadhaar PDF, which stays on my phone) and only the QR's data is sent; Laboura checks UIDAI's digital signature. Laboura keeps only: verified or not, the method, the date and time, the last 4 digits of my Aadhaar number and the QR's time stamp, my name, date of birth, gender, area and pincode, whether the name matches, whether my phone is linked to that Aadhaar, whether I am 18 or older, and this consent. The photo from the QR is kept only until a Team Lead compares it with my selfie (30 days at most). Laboura never keeps my full Aadhaar number, any picture of my card, my e-Aadhaar PDF or XML, or my full address. **Another ID:** I can use PAN, a driving licence or a voter ID instead. A live photo of the card is checked by a Team Lead and deleted after the check (30 days at most); only the ID type and the last 4 characters of its number are kept. | The check already done stays recorded as a result only. You cannot be matched without a verified ID. |
| ☐ | **5. Job updates** | **Required** | I consent to receiving job alerts, interview schedules and application updates by SMS, WhatsApp and phone. | Job alerts stop. **Your refund is not affected.** Messages you need for an offer or interview you are already part of still reach you. |
| ☐ | **6. Promotions** | *Optional* | I consent to receiving promotional offers and news from Laboura. | Promotions stop. **Nothing else changes.** |
| ☐ | **Laboura app only: help me finish registering** | *Optional* | Laboura may call, SMS or WhatsApp me to help me finish registering. | Sign-up help calls stop; you still get app reminders. |

**How to withdraw a permission.** Call Laboura. The withdrawal is recorded by an agent on an **answered, recorded call**, so that nobody can withdraw it for you by mistake or without your knowledge. You can switch **Promotions** on or off at any time in the Laboura app. Withdrawing a permission does not undo anything Laboura lawfully did before you withdrew it.

**How you give consent.** Only by an **OTP**: on your Laboura registration link, or in the Laboura app.

---

## Part C: Privacy notice (Digital Personal Data Protection Act, 2023)

This notice stands on its own. You can ask for it at any time in **Kannada, Hindi or English**.

### 1. Who is responsible for your data

**Laboura Private Limited** is the "Data Fiduciary" for your personal data, which means it decides how your data is used. Contact: Grievance Officer, {{grievance}}; {{company.office}}.

### 2. What we collect

| Group | Data |
| --- | --- |
| **About you** | Full name; mobile number (OTP verified); optional WhatsApp number; language for messages; best time to call; date of birth; gender (used only to match jobs that genuinely need it, and never shown on your card) |
| **Where you are** | Current area, pincode and map pin; how far you will travel; preferred areas (optional). **We do not collect your full home address.** |
| **Work** | Trade(s) and years of experience; available from; how long you have been looking; expected salary; shift preference; job type; languages spoken. Optional: willing to relocate or needs accommodation; last employer, role and salary (or current salary); highest qualification; driving licence and own vehicle; police verification (if you choose to tell us); whether you have a smartphone; for office jobs, CV, key skills and current salary |
| **Photo and ID** | Live selfie; the ID check result and the items listed in Part A, clause 13 |
| **Activity** | Call records and call recordings; messages sent to you; interviews, offers, hits and outcomes; consent records; which device completed your registration link; how you heard about Laboura; who referred you |
| **Money** | Payments, receipts, refunds; the UPI ID for your joining reward (checked against your ID name) |
| **App (if you use it)** | Google account ID, email and name (never your Google photo); device and notification settings |

**We never collect** your religion, caste, marital status or health conditions. **We do not collect** an emergency contact.

### 3. Why we use it

| Purpose | Data used | Based on |
| --- | --- | --- |
| Registering you and checking you are who you say and 18+ | Identity, selfie, ID check | Consent 4 |
| Finding suitable jobs for you | Work and location data | Consent 1 |
| Showing your candidate card to businesses | The card items in Part A, clause 14 | Consent 2 |
| Calling you and recording calls, for quality, proof and resolving disputes | Calls and recordings | Consent 3 |
| Sending interview details, offers and job alerts | Contact details | Consent 5 |
| Promotions | Contact details | Consent 6 (optional) |
| Taking payments, refunds and rewards, and keeping tax records | Money data | Your agreement to these terms, and the law |
| Preventing fraud and bypass (duplicate IDs, fake payments) | Identity, activity, money | Your agreement to these terms, and legitimate uses allowed by law |
| Answering a lawful request from the police or a court | What the request covers | The law |

### 4. Who we share it with

- **Businesses** you are matched with see only your candidate card. After a business selects you and pays, it gets your full name and joining details. Your phone number stays hidden until your joining day (Part A, clause 12.2).
- **Service providers** who work for Laboura and only on our instructions: our hosting and database providers, the calling company, SMS and WhatsApp providers, and our bank. They may not use your data for anything else.
- **Police or other authorities**, only on a lawful request.

We **never sell** your data.

### 5. Where it is stored

Your data is stored on servers in **Singapore** (our hosting and database providers), with secure access controls. Laboura staff see only what their role needs. Agents never see your full phone number.

### 6. How we protect it

Access is limited by role, staff logins need a one-time code, every view of a full phone number is logged, and Aadhaar data is kept to the minimum in Part A, clause 13. If there is a data breach that affects you, we will tell you and the Data Protection Board as the law requires.

### 7. How long we keep it

| Data | Kept for | Then |
| --- | --- | --- |
| Your profile | While active, plus **23 months** after your last activity | **Anonymised**: name, phone and photo removed |
| QR photo and ID card photo | Until the Team Lead's check, **30 days at most** | Deleted |
| ID check | Only the result and the items listed in Part A, clause 13 | Removed with your profile |
| Call recordings | **1 year**, or until any dispute about that job is closed | Deleted |
| Payments, receipts, refunds, rewards | About **8 years** (company and tax law) | Deleted |

### 8. Your rights

You have the right to:
- **get a summary** of your personal data and how it is used;
- **correct, complete or update** your data;
- **ask us to erase** your data, except what the law requires us to keep (such as money records). Erasing your profile during a running guarantee ends your refund (Part A, clause 7.2);
- **withdraw your consent** (Part B), as easily as you gave it;
- **nominate a person** to use these rights for you if you die or cannot act;
- **complain to our Grievance Officer**, and if you are not satisfied, **complain to the Data Protection Board of India**.

To use any right, call Laboura or contact the Grievance Officer.

### 9. Children

Laboura does not register anyone under 18. If we find that someone under 18 has registered, we stop the registration and take no payment.

### 10. Changes

If we change this notice, we will tell you and show the new version number.`,
};
