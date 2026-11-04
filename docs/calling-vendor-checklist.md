# Calling Vendor Technical Requirements Checklist — Laboura

This document outlines the hard technical and regulatory requirements for Laboura's outbound calling provider (comparing vendors such as **Exotel** and **Tata Tele Business Services Smartflo**).

---

## 1. Call Routing & Dual-Leg Architecture

1. **Agent Leg (First Leg):**
   - The telephony system initiates an outbound call to the staff agent's ordinary mobile number (`callRoutingPhone`).
   - The agent answers on their standard GSM mobile phone (Android / iOS / feature phone).
   - No softphone, SIP client, or specialized desktop app is required for the agent.

2. **Customer Leg (Second Leg / Bridge):**
   - Once the agent answers and the mandatory announcement plays, the vendor bridges the call to the candidate, business, or referral partner.
   - **Strict Privacy Rule (AGENTS.md §7):** The customer MUST see only Laboura's registered company caller ID (CLI). The customer must **never** see the agent's personal or routing phone number.
   - The agent must **never** see the customer's phone number on their handset screen (virtual number / masked proxy routing).

3. **Mandatory TRAI Number Series Compliance:**
   - Outbound commercial staffing calls in India must originate from registered **140-series** (promotional / service implicit) or **1600-series** (service explicit / transactional) numbers in accordance with TRAI Telecom Commercial Communications Customer Preference Regulations (TCCCPR).
   - Number masking and DLT registration must be supported natively by the vendor.

---

## 2. In-Call Announcement & Recording Requirements

1. **Pre-Call Announcement (AGENTS.md §6 / Phase 11 Task 1):**
   - Before bridging to the recipient (or immediately upon connecting), the system must play the exact announcement:
     > *"This call is recorded for quality and service."*
2. **Dual-Channel Call Recording:**
   - Both audio legs must be recorded into standard MP3 or WAV format.
   - The vendor must expose a temporary signed download URL in the final call-status webhook or recording callback.
   - Laboura copies recordings asynchronously to private Supabase Storage within minutes of completion; the vendor's storage retention should provide at least 30 days of buffer for disaster recovery.

---

## 3. Webhook Delivery & Schema Specifications

The calling provider must deliver HTTP `POST` webhooks to:
```text
https://<laboura-api-domain>/telephony/webhook/call-status
```

### Signature Verification
- Every webhook request must contain a cryptographic signature header (e.g. `X-Telephony-Signature` or `X-Exotel-Signature` / `X-Signature`) computed via HMAC-SHA256 using the shared `TELEPHONY_WEBHOOK_SECRET`.
- Plaintext or unsigned webhook payloads are rejected with `401 Unauthorized`.

### Payload Field Mapping (`CallStatusEvent`)
The webhook payload must provide the following fields, mapped by Laboura's telephony adapter:

| Internal Field | Purpose | Exotel Equivalent | Tata Smartflo Equivalent |
| --- | --- | --- | --- |
| `providerCallId` | Unique call identifier | `CallSid` / `call_sid` | `uuid` / `call_id` |
| `status` | Call lifecycle status | `Status` / `DialCallStatus` (`initiated`, `ringing`, `in_progress`, `completed`, `no_answer`, `busy`, `failed`, `canceled`) | `status` / `call_state` |
| `answered` | Boolean flag whether customer answered | Derived from `status == 'answered'` or `duration > 0` | `answered` |
| `startedAt` | Timestamp when call initiated | `StartTime` / `DateCreated` | `start_time` |
| `answeredAt` | Timestamp when recipient answered | `AnsweredTime` | `connect_time` |
| `endedAt` | Timestamp when call disconnected | `EndTime` / `DateUpdated` | `end_time` |
| `durationSec` | Talk-time duration in integer seconds | `DialCallDuration` / `Duration` | `duration` / `conversation_duration` |
| `recordingUrl` | URL to download call audio file | `RecordingUrl` | `recording_url` |
| `direction` | Call direction (`outbound` or `inbound`) | `Direction` | `direction` |

### Idempotency & Repeat Deliveries
- The webhook endpoint is strictly **idempotent**. Repeat deliveries with identical or past statuses change nothing.
- Status progression is strictly monotonic (cannot regress from `completed` to `ringing`).

---

## 4. Vendor Comparison Summary: Exotel vs Tata Tele Business Services (TTBS) Smartflo

| Requirement | Exotel | Tata Smartflo | Evaluation Notes |
| --- | --- | --- | --- |
| **Agent Leg on Ordinary GSM Mobile** | Yes (standard click-to-call API) | Yes (click2call / agent bridge) | Both satisfy requirement |
| **CLI Masking (Customer sees 140/1600)** | Yes (Virtual numbers / DLT CLI) | Yes (Smartflo Virtual Number / PRI) | Both satisfy requirement; Tata has direct telecom carrier routing |
| **Call Recording + Webhook URL** | Yes (`RecordingUrl` in status callback) | Yes (Webhook includes recording URL) | Both provide signed URLs for download |
| **Webhooks with HMAC Signature** | Yes (Custom header / Secret token) | Yes (Token / Header signature) | Supported by both |
| **Concurrency & Latency (Bengaluru)** | Cloud CPaaS, low latency | Tier-1 Telco infrastructure, high voice clarity | Tata operates local telecom circles directly in Bengaluru |
