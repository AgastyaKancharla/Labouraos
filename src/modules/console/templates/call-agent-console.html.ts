import { staffLoginFieldsHtml, staffLoginHandlersJs } from './staff-login-ui';

export function renderCallAgentConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Laboura — Call Agent Console</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --danger: #ef4444;
      --success: #10b981;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding-bottom: 40px;
    }
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--card-border);
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 { font-size: 1.25rem; font-weight: 700; color: #fff; }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      background: #1e3a8a;
      color: #93c5fd;
    }
    .user-info { display: flex; align-items: center; gap: 12px; }
    button {
      background: var(--primary);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: var(--primary-hover); }
    button.btn-sm { padding: 4px 8px; font-size: 0.75rem; }
    button.btn-secondary { background: #475569; }
    button.btn-success { background: var(--success); }
    button.btn-danger { background: var(--danger); }
    .nav-tabs {
      display: flex;
      gap: 8px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--card-border);
      padding: 8px 24px 0 24px;
      overflow-x: auto;
    }
    .tab-btn {
      background: transparent;
      color: var(--text-muted);
      border: none;
      border-bottom: 2px solid transparent;
      padding: 10px 16px;
      border-radius: 0;
      font-weight: 600;
    }
    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }
    main { max-width: 1200px; margin: 24px auto; padding: 0 16px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .card-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 768px) {
      .grid-2 { grid-template-columns: 1fr; }
    }
    .form-group { margin-bottom: 14px; }
    label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px; }
    input, select, textarea {
      background: #0f172a;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.875rem;
      width: 100%;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--primary);
    }
    .otp-group {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .otp-group input { flex: 1; }
    .otp-group button { white-space: nowrap; }
    .table-container { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.875rem;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--card-border);
    }
    th { color: var(--text-muted); font-weight: 600; background: #162032; }
    tr:hover td { background: #243247; }
    .alert {
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 14px;
      font-size: 0.875rem;
    }
    .alert-danger { background: #7f1d1d; color: #fca5a5; }
    .alert-success { background: #064e3b; color: #6ee7b7; }
    .auth-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      width: 100%;
      max-width: 400px;
      padding: 24px;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>

  <!-- Auth Overlay -->
  <div id="auth-modal" class="auth-overlay hidden">
    <div class="modal">
      <h2 style="margin-bottom: 16px; font-size: 1.25rem;">Call Agent Login</h2>
      <div id="login-error" class="alert alert-danger hidden"></div>
      <div id="login-info" class="alert alert-success hidden"></div>
      ${staffLoginFieldsHtml()}

      <!-- Inline TOTP Enrollment Step -->
      <div id="totp-enroll-section" class="hidden" style="margin-top: 12px; border-top: 1px solid var(--card-border); padding-top: 12px;">
        <h3 style="font-size: 1rem; margin-bottom: 8px;">2FA Enrollment Required</h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">
          Enter this secret key manually into your authenticator app (Google Authenticator, Microsoft Authenticator, Authy):
        </p>
        <div style="background: #111827; padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 0.9rem; word-break: break-all; margin-bottom: 12px; border: 1px dashed var(--card-border);" id="totp-setup-secret">
        </div>
        <div class="form-group">
          <label>Enter 6-digit code from app</label>
          <input type="text" id="totp-enroll-code" maxlength="6" pattern="[0-9]{6}" style="width: 100%; letter-spacing: 2px;" placeholder="123456">
        </div>
        <button id="btn-enable-totp" style="width: 100%; margin-top: 8px; background: #2563eb; color: #fff;">Verify &amp; Enable 2FA</button>
      </div>
    </div>
  </div>

  <header>
    <div>
      <h1>Laboura Call Agent Console</h1>
      <span style="font-size: 0.75rem; color: var(--text-muted);">Candidate & Business Phone Operations</span>
    </div>
    <div class="user-info">
      <span id="user-display" style="font-size: 0.875rem;">Not logged in</span>
      <span id="user-role-badge" class="badge">CALL_AGENT</span>
      <button id="btn-logout" class="btn-sm btn-secondary">Log Out</button>
    </div>
  </header>

  <nav class="nav-tabs">
    <button class="tab-btn active" data-tab="onboard-seeker">Job Seeker Onboarding</button>
    <button class="tab-btn" data-tab="onboard-referral">Referral Onboarding</button>
    <button class="tab-btn" data-tab="onboard-biz">Business Onboarding</button>
    <button class="tab-btn" data-tab="business-profile">Business Verification</button>
    <button class="tab-btn" data-tab="consent-withdrawal">Withdraw Consent</button>
    <button class="tab-btn" data-tab="vacancy-capture">Vacancy Capture</button>
    <button class="tab-btn" data-tab="shortlist">Candidate Shortlist</button>
    <button class="tab-btn" data-tab="interviews">Interviews</button>
    <button class="tab-btn" data-tab="contact-attempts">Calling & Hits</button>
    <button class="tab-btn" data-tab="placement-flow">Placement Payments</button>
    <a href="/map" class="map-nav-link" style="align-self:center;color:var(--text-muted);padding:10px 12px;font-weight:600;white-space:nowrap">Map</a>
  </nav>

  <main>
    <div id="status-alert" class="alert hidden"></div>

    <!-- 1. Job Seeker Onboarding Form -->
    <div id="view-onboard-seeker" class="tab-view">
      <div class="card">
        <div class="card-title">
          <span>Job Seeker Registration & OTP Verification</span>
        </div>
        <div class="grid-2">
          <div>
            <div class="form-group">
              <label>Full Name</label>
              <input type="text" id="js-name" placeholder="Ramesh Kumar">
            </div>
            <div class="form-group">
              <label>Mobile Number (10 digits)</label>
              <div class="otp-group">
                <input type="text" id="js-phone" placeholder="98XXXXXXXX">
                <button type="button" id="btn-js-send-otp" onclick="sendOtp('js')">Send OTP</button>
              </div>
            </div>
            <div class="form-group" id="js-otp-container" style="display: none;">
              <label>Enter OTP Code</label>
              <div class="otp-group">
                <input type="text" id="js-otp-code" placeholder="6-digit code">
                <button type="button" class="btn-success" onclick="verifyOtp('js')">Verify OTP</button>
              </div>
              <small id="js-otp-status" style="color: var(--warning); margin-top: 4px; display: block;"></small>
            </div>
            <div class="form-group">
              <label>Trade / Skill</label>
              <input type="text" id="js-trade" placeholder="Electrician, Plumber, Driver...">
            </div>
          </div>
          <div>
            <div class="form-group">
              <label>Salary Range Min (INR)</label>
              <input type="number" id="js-min-salary" placeholder="15000">
            </div>
            <div class="form-group">
              <label>Salary Range Max (INR)</label>
              <input type="number" id="js-max-salary" placeholder="25000">
            </div>
            <div class="form-group">
              <label>Preferred Call Window Start (09:00 - 21:00 IST)</label>
              <input type="text" id="js-call-start" value="09:00">
            </div>
            <div class="form-group">
              <label>Preferred Call Window End (09:00 - 21:00 IST)</label>
              <input type="text" id="js-call-end" value="18:00">
            </div>
            <div class="form-group">
              <label>Referred By (Partner Code or UUID, optional)</label>
              <input type="text" id="js-referred-by" placeholder="RF-00001">
            </div>
          </div>
        </div>
        <button id="btn-submit-seeker" onclick="submitJobSeeker()" style="margin-top: 12px;">Register Job Seeker</button>
      </div>

      <!-- Payment Link Generation Section -->
      <div class="card" id="js-payment-link-card" style="display: none;">
        <div class="card-title">
          <span>₹499 Activation Fee Payment Link</span>
        </div>
        <p style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 12px;">Candidate must pay the ₹499 activation fee to enter active candidate pool.</p>
        <div style="display: flex; gap: 12px; align-items: center;">
          <input type="text" id="js-payment-link-url" readonly style="flex: 1;">
          <button onclick="copyPaymentLink()">Copy Link</button>
        </div>
      </div>
    </div>

    <!-- 2. Referral Onboarding Form -->
    <div id="view-onboard-referral" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Referral Partner Registration</span>
        </div>
        <div style="max-width: 500px;">
          <div class="form-group">
            <label>Partner Name</label>
            <input type="text" id="rf-name" placeholder="Suresh Partner">
          </div>
          <div class="form-group">
            <label>Mobile Number</label>
            <div class="otp-group">
              <input type="text" id="rf-phone" placeholder="98XXXXXXXX">
              <button type="button" onclick="sendOtp('rf')">Send OTP</button>
            </div>
          </div>
          <div class="form-group" id="rf-otp-container" style="display: none;">
            <label>Enter OTP Code</label>
            <div class="otp-group">
              <input type="text" id="rf-otp-code" placeholder="6-digit code">
              <button type="button" class="btn-success" onclick="verifyOtp('rf')">Verify OTP</button>
            </div>
            <small id="rf-otp-status" style="color: var(--warning); margin-top: 4px; display: block;"></small>
          </div>
          <div class="form-group">
            <label>Partner Type</label>
            <select id="rf-type">
              <option value="individual">Individual</option>
              <option value="business">Business</option>
            </select>
          </div>
          <button onclick="submitReferral()" style="margin-top: 12px;">Register Referral Partner</button>
        </div>
      </div>
    </div>

    <!-- 3. Business Onboarding Form -->
    <div id="view-onboard-biz" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Business Onboarding by Phone</span>
        </div>
        <div class="grid-2">
          <div>
            <div class="form-group">
              <label>Business Name</label>
              <input type="text" id="biz-name" placeholder="Bangalore Facility Services">
            </div>
            <div class="form-group">
              <label>Business Phone</label>
              <div class="otp-group">
                <input type="text" id="biz-phone" placeholder="98XXXXXXXX">
                <button type="button" onclick="sendOtp('biz')">Send OTP</button>
              </div>
            </div>
            <div class="form-group" id="biz-otp-container" style="display: none;">
              <label>Enter OTP Code</label>
              <div class="otp-group">
                <input type="text" id="biz-otp-code" placeholder="6-digit code">
                <button type="button" class="btn-success" onclick="verifyOtp('biz')">Verify OTP</button>
              </div>
              <small id="biz-otp-status" style="color: var(--warning); margin-top: 4px; display: block;"></small>
            </div>
            <div class="form-group"><label>Business type</label><select id="biz-type"><option value="restaurant">Restaurant</option><option value="retail">Retail</option><option value="factory">Factory</option><option value="office">Office</option><option value="warehouse">Warehouse</option><option value="household">Household</option><option value="other">Other</option></select></div>
            <div class="form-group"><label>Owner name</label><input id="biz-owner-name"></div>
          </div>
          <div>
            <div class="form-group">
              <label>Locality</label>
              <input type="text" id="biz-locality" placeholder="Type the business locality">
            </div>
            <div class="form-group">
              <label>Address</label>
              <input type="text" id="biz-address" placeholder="100 Feet Rd, 4th Block">
            </div>
            <div class="form-group"><label>GST number <small>(only if they have it)</small></label><input type="text" id="biz-gst" placeholder="29ABCDE1234F1Z5"></div>
            <div class="form-group"><label>Licence number <small>(only if they have it)</small></label><input id="biz-licence"></div>
            <div class="form-group"><label>Shop and Establishment number <small>(only if they have it)</small></label><input id="biz-shop"></div>
            <div class="form-group"><label>Udyam number <small>(only if they have it)</small></label><input id="biz-udyam"></div>
            <div class="form-group"><label>PAN <small>(only if they have it)</small></label><input id="biz-pan"></div>
            <div class="form-group"><label>Storefront photo</label><input type="file" id="biz-storefront-photo" accept="image/*"></div>
            <div class="form-group"><label>Billing name</label><input id="biz-billing-name"></div>
            <div class="form-group"><label>Billing address</label><textarea id="biz-billing-address"></textarea></div>
            <small id="biz-documents-status" aria-live="polite">Registration numbers are optional; only enter them if the business has them.</small>
          </div>
        </div>
        <button onclick="submitBusiness()" style="margin-top: 12px;">Register Business</button>
      </div>
    </div>

    <div id="view-business-profile" class="tab-view hidden">
      <div class="card">
        <div class="card-title"><span>Business profile and verification</span></div>
        <div class="form-group"><label>Business code or ID</label><input id="business-profile-id"></div>
        <button onclick="loadBusinessProfile()">Load profile</button>
        <div id="business-profile-details" aria-live="polite"></div>
        <div id="business-profile-actions" class="hidden">
          <button id="business-send-agreement" onclick="sendBusinessAgreement()">Send agreement</button>
          <a id="business-agreement-link" class="hidden" target="_blank" rel="noopener">Signed agreement</a>
        </div>
      </div>
    </div>

    <div id="view-consent-withdrawal" class="tab-view hidden">
      <div class="card">
        <div class="card-title"><span>Withdraw job seeker consent</span></div>
        <p>Available only during an answered, recent call with this job seeker. The job seeker will receive an SMS; withdrawing job matching or call recording pauses their profile.</p>
        <div class="form-group"><label>Job seeker ID</label><input id="withdraw-job-seeker-id"></div>
        <button onclick="checkConsentWithdrawalEligibility()">Check answered call</button>
        <div id="withdraw-consent-form" class="hidden">
          <label><input type="checkbox" value="call_recording" class="withdraw-purpose"> Call recording</label>
          <label><input type="checkbox" value="job_matching" class="withdraw-purpose"> Job matching</label>
          <label><input type="checkbox" value="profile_sharing" class="withdraw-purpose"> Profile sharing</label>
          <label><input type="checkbox" value="aadhaar_verification" class="withdraw-purpose"> Identity verification</label>
          <label><input type="checkbox" value="job_updates" class="withdraw-purpose"> Job updates</label>
          <label><input type="checkbox" value="promotions" class="withdraw-purpose"> Promotions</label>
          <p>Only checked purposes are withdrawn. The system records the request and sends an SMS confirmation.</p>
          <button onclick="withdrawJobSeekerConsent()">Confirm withdrawal</button>
        </div>
        <div id="withdraw-consent-status" aria-live="polite"></div>
      </div>
    </div>

    <!-- 4. Vacancy Capture Form -->
    <div id="view-vacancy-capture" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Capture Business Vacancy</span>
        </div>
        <div style="max-width: 600px;">
          <div class="form-group">
            <label>Business Code or ID</label>
            <input type="text" id="vc-biz-id" placeholder="BZ-00001 or UUID">
          </div>
          <div class="form-group">
            <label>Trade / Skill Required</label>
            <input type="text" id="vc-trade" placeholder="Electrician">
          </div>
          <div class="form-group">
            <label>Offered Monthly Salary (INR)</label>
            <input type="number" id="vc-salary" placeholder="20000">
          </div>
          <div class="form-group">
            <label>Headcount</label>
            <input type="number" id="vc-headcount" value="1">
          </div>
          <div class="form-group"><label>Role title</label><input id="vc-role-title"></div>
          <div class="grid-2">
            <div class="form-group"><label>Salary maximum (₹)</label><input type="number" id="vc-salary-max"></div>
            <div class="form-group"><label>Salary period</label><select id="vc-salary-period"><option value="monthly">Monthly</option><option value="daily">Daily</option></select></div>
            <div class="form-group"><label>Extras</label><select id="vc-extras" multiple><option value="overtime">Overtime</option><option value="incentives">Incentives</option><option value="food">Food</option><option value="accommodation">Accommodation</option><option value="transport">Transport</option><option value="uniform">Uniform</option><option value="pf_esi">PF/ESI</option></select></div>
            <div class="form-group"><label>Working hours</label><input id="vc-hours"></div>
            <div class="form-group"><label>Shift</label><input id="vc-shift"></div>
            <div class="form-group"><label>Weekly off</label><input id="vc-weekly-off"></div>
            <div class="form-group"><label>Vacancy locality (optional)</label><input id="vc-locality"></div>
            <div class="form-group"><label>Latitude (optional)</label><input type="number" id="vc-latitude" step="any"></div>
            <div class="form-group"><label>Longitude (optional)</label><input type="number" id="vc-longitude" step="any"></div>
            <div class="form-group"><label>Experience required (years)</label><input type="number" id="vc-experience" min="0"></div>
            <div class="form-group"><label>Education required</label><input id="vc-education"></div>
            <div class="form-group"><label>Languages required (comma separated)</label><input id="vc-languages"></div>
            <div class="form-group"><label>Licences required (comma separated)</label><input id="vc-licences"></div>
            <div class="form-group"><label>Minimum age</label><input type="number" id="vc-age-min"></div>
            <div class="form-group"><label>Maximum age</label><input type="number" id="vc-age-max"></div>
            <div class="form-group"><label>Gender requirement</label><select id="vc-gender"><option value="none">None</option><option value="male">Male</option><option value="female">Female</option></select></div>
            <div class="form-group"><label>Reason for gender requirement</label><input id="vc-gender-reason"></div>
            <div class="form-group"><label>Start date</label><input type="date" id="vc-start-date"></div>
            <div class="form-group"><label>Urgency</label><select id="vc-urgency"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div>
            <div class="form-group"><label>Probation (days)</label><input type="number" id="vc-probation" min="0"></div>
            <div class="form-group"><label>Interview type</label><select id="vc-interview-type"><option value="walk_in">Walk-in</option><option value="scheduled">Scheduled</option></select></div>
            <div class="form-group"><label>Walk-in day</label><input type="date" id="vc-walk-in-date"></div>
            <div class="form-group"><label>Interview contact name</label><input id="vc-interview-contact"></div>
            <div class="form-group"><label>Scheduled slot start</label><input type="datetime-local" id="vc-slot-start"></div>
            <div class="form-group"><label>Scheduled slot end</label><input type="datetime-local" id="vc-slot-end"></div>
            <div class="form-group"><label>Scheduled slot capacity</label><input type="number" id="vc-slot-capacity" min="1" value="1"></div>
          </div>
          <div class="form-group">
            <label>Description / Notes</label>
            <textarea id="vc-desc" rows="3" placeholder="Shift timings, location details..."></textarea>
          </div>
          <button onclick="submitVacancy()">Capture Vacancy</button>
        </div>
      </div>
    </div>

    <!-- 5. Candidate Shortlist View -->
    <div id="view-shortlist" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Matching Candidate Cards</span>
        </div>
        <div style="display: flex; gap: 12px; margin-bottom: 16px;">
          <input type="text" id="shortlist-vc-id" placeholder="Enter Vacancy ID or Code (e.g. VC-00001)" style="max-width: 400px;">
          <button onclick="loadShortlist()">Fetch top matches</button>
        </div>
        <div id="shortlist-left-out" aria-live="polite"></div>
        <div id="shortlist-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:16px 0">
          <p>Enter a vacancy ID to load matching candidates.</p>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button id="shortlist-next" class="btn-secondary" onclick="loadShortlistPage(shortlistPage + 1)" hidden>Show next 3</button>
          <label for="shortlist-channel">Message channel</label>
          <select id="shortlist-channel"><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select>
          <button onclick="showSelectedInPerson()">Shown in person</button>
          <button class="btn-success" onclick="sendSelectedToOwner()">Send to owner</button>
        </div>
      </div>
    </div>

    <div id="view-interviews" class="tab-view hidden">
      <div class="card">
        <div class="card-title"><span>My Interviews</span><button class="btn-sm" onclick="loadAgentInterviews()">Refresh</button></div>
        <div style="display:flex;gap:10px;margin-bottom:12px"><input id="interview-filter-vacancy" placeholder="Filter by vacancy ID or code"><button onclick="loadAgentInterviews()">Filter</button></div>
        <div id="interview-list" aria-live="polite">Load interviews to see reply and result deadlines.</div>
      </div>
    </div>

    <!-- 6. Calling & Hit Recording -->
    <div id="view-contact-attempts" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Calling, Profiles & Hits</span>
        </div>
        <div class="grid-2">
          <!-- Profile Calling -->
          <div style="background: #162032; padding: 16px; border-radius: 6px;">
            <h3 style="font-size: 1rem; margin-bottom: 12px; color: var(--primary);">Place Outbound Call & Profile</h3>
            <div class="form-group">
              <label>Profile Type</label>
              <select id="call-subject-type">
                <option value="job_seeker">Job Seeker</option>
                <option value="business">Business</option>
                <option value="referral">Referral Partner</option>
              </select>
            </div>
            <div class="form-group">
              <label>ID or Code (e.g. JS-00001, BZ-00001, RF-00001, or UUID)</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="call-subject-id" placeholder="JS-00001 or UUID">
                <button type="button" class="btn-sm" onclick="loadCallingProfile()">Load Profile</button>
              </div>
            </div>

            <!-- Profile Summary Card -->
            <div id="calling-profile-card" style="display: none; background: #0f172a; padding: 12px; border-radius: 6px; margin-bottom: 14px; border: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong id="profile-card-name" style="font-size: 1.05rem;">—</strong>
                <span id="profile-card-code" class="badge">—</span>
              </div>
              <div style="font-size: 0.9rem; color: #94a3b8; margin-bottom: 6px;">
                Phone: <strong id="profile-card-phone" style="color: var(--text);">—</strong>
                <span style="margin: 0 6px;">•</span>
                Status: <span id="profile-card-status">—</span>
              </div>

              <!-- Payment status and resend link for candidates -->
              <div id="profile-payment-status-row" style="font-size: 0.9rem; color: #94a3b8; margin-bottom: 6px; display: none;">
                Payment: <span id="profile-card-payment-status" class="badge">waiting</span>
                <button type="button" id="btn-resend-profile-payment" class="btn-sm" style="margin-left: 8px; display: none;" onclick="resendCurrentProfilePayment()">Resend payment link</button>
              </div>

              <!-- Blocked calling alert notice -->
              <div id="call-blocked-alert" style="display: none; background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); color: #fca5a5; padding: 8px 12px; border-radius: 4px; font-size: 0.85rem; margin-top: 8px;">
              </div>

              <!-- Call trigger controls -->
              <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
                <select id="call-purpose-select" style="max-width: 180px;">
                  <option value="general">General</option>
                  <option value="offer">Offer</option>
                  <option value="follow_up">Follow Up</option>
                  <option value="verification">Verification</option>
                  <option value="exit_call">Exit Call</option>
                  <option value="check_in">Check In</option>
                  <option value="interview_result">Interview Result</option>
                  <option value="refund_check">Refund Check</option>
                </select>
                <button type="button" id="btn-trigger-call" class="btn-call" onclick="triggerProfileCall()">Call</button>
              </div>

              <!-- Active Call / Outcome Card -->
              <div id="call-in-progress-section" style="display: none; margin-top: 14px; padding: 12px; background: #1e293b; border-radius: 6px;">
                <div id="call-status-message" style="font-size: 0.9rem; font-weight: 500; margin-bottom: 8px;">Call placed...</div>
                
                <!-- Answered Call Outcome Form (Closed List) -->
                <div id="answered-outcome-form" style="display: none;">
                  <label style="font-size: 0.85rem; color: var(--primary); font-weight: bold; margin-bottom: 4px; display: block;">Record Call Outcome</label>
                  <select id="call-agent-outcome" style="margin-bottom: 8px;">
                    <option value="interested">Interested</option>
                    <option value="accepted_offer">Accepted Offer</option>
                    <option value="rejected_offer">Rejected Offer</option>
                    <option value="callback_requested">Callback Requested</option>
                    <option value="not_interested">Not Interested</option>
                    <option value="working_now">Working Now</option>
                    <option value="other">Other</option>
                  </select>
                  <input type="text" id="call-agent-outcome-reason" placeholder="Outcome reason (optional)" style="margin-bottom: 8px;">
                  <button type="button" class="btn-sm" onclick="submitProfileCallOutcome()">Submit Outcome</button>
                </div>
              </div>
            </div>

            <!-- Call & Message History -->
            <div id="profile-history-section" style="display: none; margin-top: 16px;">
              <h4 style="font-size: 0.9rem; color: #94a3b8; margin-bottom: 8px;">Call & Message History</h4>
              <div class="table-container" style="max-height: 220px; overflow-y: auto;">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Direction</th>
                      <th>Purpose</th>
                      <th>Answered</th>
                      <th>Duration</th>
                      <th>Outcome</th>
                      <th>Recording</th>
                    </tr>
                  </thead>
                  <tbody id="profile-history-tbody">
                    <tr><td colspan="7">No history yet</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Hit Recording -->
          <div style="background: #162032; padding: 16px; border-radius: 6px;">
            <h3 style="font-size: 1rem; margin-bottom: 12px; color: var(--danger);">Record Candidate Hit (3-Hit Cycle)</h3>
            <div class="form-group">
              <label>Candidate ID or Code</label>
              <input type="text" id="hit-js-id" placeholder="JS-00001 or UUID">
            </div>
            <div class="form-group">
              <label>Hit Reason</label>
              <select id="hit-reason">
                <option value="no_pickup">No Pickup (after AM+PM calls + WhatsApp/SMS)</option>
                <option value="offer_rejected">Explicit Rejection of Suitable Offer</option>
                <option value="interview_no_show">No-Show at Arranged Interview</option>
              </select>
            </div>
            <div class="form-group">
              <label>Note / Explanation</label>
              <input type="text" id="hit-note" placeholder="Reason details...">
            </div>
            <button class="btn-danger" onclick="submitHit()">Record Hit</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 7. Placement Status -->
    <div id="view-placement-flow" class="tab-view hidden">
      <div class="card">
        <div class="card-title"><span>Placement Payment Status</span><button class="btn-sm" onclick="loadAgentPlacements()">Refresh</button></div>
        <p>Selected interviews create placements. The joining date is confirmed after the business fee is paid.</p>
        <div id="agent-placement-list" aria-live="polite">No placements loaded.</div>
      </div>
    </div>

  </main>

  <script>
    let token = sessionStorage.getItem('laboura_token') || '';
    let currentUser = null;
    let otpRequests = { js: '', rf: '', biz: '' };

    function showAlert(msg, isSuccess = true) {
      const el = document.getElementById('status-alert');
      el.className = 'alert ' + (isSuccess ? 'alert-success' : 'alert-danger');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 6000);
    }

    async function api(path, options = {}) {
      options.headers = options.headers || {};
      if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
      }
      if (options.body && typeof options.body === 'object') {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
      }
      const res = await fetch(path, options);
      if (res.status === 401) {
        showLoginModal();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || 'API error ' + res.status);
      }
      return res.json().catch(() => ({}));
    }

    let setupScopedToken = null;

    function showLoginModal() {
      const enrollSec = document.getElementById('totp-enroll-section');
      const formFields = document.getElementById('login-form-fields');
      if (enrollSec) enrollSec.classList.add('hidden');
      if (formFields) formFields.classList.remove('hidden');
      var codePanel = document.getElementById('login-code-panel');
      if (codePanel) codePanel.classList.add('hidden');
      document.getElementById('auth-modal').classList.remove('hidden');
    }

    function hideLoginModal() {
      document.getElementById('auth-modal').classList.add('hidden');
    }

    ${staffLoginHandlersJs()}

    document.getElementById('btn-enable-totp').addEventListener('click', async () => {
      const errEl = document.getElementById('login-error');
      const infoEl = document.getElementById('login-info');
      const code = document.getElementById('totp-enroll-code').value.trim();
      try {
        errEl.classList.add('hidden');
        if (infoEl) infoEl.classList.add('hidden');
        if (!code || code.length !== 6) {
          throw new Error('Please enter the 6-digit code from your authenticator app');
        }
        const res = await fetch('/staff/2fa/enable', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + setupScopedToken
          },
          body: JSON.stringify({ totpCode: code })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Verification failed' }));
          throw new Error(err.message || 'Verification failed');
        }
        // Successfully enabled: reset modal back to login form and prompt re-login
        document.getElementById('totp-enroll-section').classList.add('hidden');
        document.getElementById('login-form-fields').classList.remove('hidden');
        document.getElementById('login-totp').value = code;
        setupScopedToken = null;
        if (infoEl) {
          infoEl.textContent = '2FA enabled successfully! Please enter your password to complete login.';
          infoEl.classList.remove('hidden');
        }
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('hidden');
      }
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
      var ending = token;
      if (ending) {
        fetch('/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + ending } }).catch(function () {});
      }
      sessionStorage.removeItem('laboura_token');
      token = '';
      showLoginModal();
    });

    function parseJwt(t) {
      try {
        return JSON.parse(atob(t.split('.')[1]));
      } catch {
        return null;
      }
    }

    function initUser() {
      if (!token) {
        showLoginModal();
        return;
      }
      const payload = parseJwt(token);
      if (!payload) {
        showLoginModal();
        return;
      }
      currentUser = payload;
      document.getElementById('user-display').textContent = payload.email;
      document.getElementById('user-role-badge').textContent = payload.role.toUpperCase();
    }

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
        document.getElementById('view-' + tab).classList.remove('hidden');
        if (tab === 'interviews') loadAgentInterviews();
        if (tab === 'placement-flow') loadAgentPlacements();
      });
    });

    // OTP helpers
    async function sendOtp(type) {
      const phone = document.getElementById(type + '-phone').value.trim();
      if (!phone) return alert('Phone number is required');
      try {
        const res = await api('/otp/send', {
          method: 'POST',
          body: { phone }
        });
        otpRequests[type] = res.requestId;
        document.getElementById(type + '-otp-container').style.display = 'block';
        document.getElementById(type + '-otp-status').textContent = 'OTP sent! Request ID: ' + res.requestId;
        showAlert('OTP code sent to ' + phone);
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function verifyOtp(type) {
      const code = document.getElementById(type + '-otp-code').value.trim();
      const reqId = otpRequests[type];
      if (!reqId || !code) return alert('Enter OTP code');
      try {
        await api('/otp/verify', {
          method: 'POST',
          body: { requestId: reqId, code }
        });
        document.getElementById(type + '-otp-status').textContent = '✓ Mobile number verified successfully';
        document.getElementById(type + '-otp-status').style.color = 'var(--success)';
        showAlert('OTP verified successfully!');
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    // 1. Submit Job Seeker
    async function submitJobSeeker() {
      try {
        const reqId = otpRequests['js'];
        if (!reqId) return alert('Mobile number must be OTP-verified first');

        const body = {
          name: document.getElementById('js-name').value.trim(),
          phone: document.getElementById('js-phone').value.trim(),
          tradeSkill: document.getElementById('js-trade').value.trim(),
          minSalary: Number(document.getElementById('js-min-salary').value) * 100, // paise
          maxSalary: Number(document.getElementById('js-max-salary').value) * 100, // paise
          preferredCallWindowStart: document.getElementById('js-call-start').value.trim(),
          preferredCallWindowEnd: document.getElementById('js-call-end').value.trim(),
          referredById: document.getElementById('js-referred-by').value.trim() || undefined,
          otpRequestId: reqId,
        };

        const res = await api('/job-seekers', { method: 'POST', body });
        showAlert('Job seeker created: ' + res.code);

        // Fetch payment link for ₹499 activation fee
        const payRes = await api('/job-seekers/' + res.id + '/activation-payment', { method: 'POST' });
        document.getElementById('js-payment-link-url').value = payRes.paymentLink;
        document.getElementById('js-payment-link-card').style.display = 'block';
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    function copyPaymentLink() {
      const el = document.getElementById('js-payment-link-url');
      el.select();
      navigator.clipboard.writeText(el.value);
      showAlert('Payment link copied to clipboard!');
    }

    // 2. Submit Referral
    async function submitReferral() {
      try {
        const reqId = otpRequests['rf'];
        if (!reqId) return alert('Mobile number must be OTP-verified first');

        const body = {
          name: document.getElementById('rf-name').value.trim(),
          phone: document.getElementById('rf-phone').value.trim(),
          type: document.getElementById('rf-type').value,
          otpRequestId: reqId,
        };

        const res = await api('/referrals', { method: 'POST', body });
        showAlert('Referral partner created: ' + res.code);
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    // 3. Submit Business
    async function submitBusiness() {
      try {
        const reqId = otpRequests['biz'];
        if (!reqId) return alert('Mobile number must be OTP-verified first');

        const body = {
          name: document.getElementById('biz-name').value.trim(),
          phone: document.getElementById('biz-phone').value.trim(),
          locality: document.getElementById('biz-locality').value.trim(),
          businessType: document.getElementById('biz-type').value,
          ownerName: document.getElementById('biz-owner-name').value.trim() || undefined,
          address: document.getElementById('biz-address').value.trim(),
          gstNumber: document.getElementById('biz-gst').value.trim() || undefined,
          licenceNumber: document.getElementById('biz-licence').value.trim() || undefined,
          shopEstablishmentNumber: document.getElementById('biz-shop').value.trim() || undefined,
          udyamNumber: document.getElementById('biz-udyam').value.trim() || undefined,
          pan: document.getElementById('biz-pan').value.trim() || undefined,
          billingName: document.getElementById('biz-billing-name').value.trim() || undefined,
          billingAddress: document.getElementById('biz-billing-address').value.trim() || undefined,
          otpRequestId: reqId,
        };

        const res = await api('/businesses', { method: 'POST', body });
        const photo = document.getElementById('biz-storefront-photo').files?.[0];
        if (photo) {
          const form = new FormData();
          form.append('photo', photo);
          const upload = await fetch('/businesses/' + res.id + '/storefront-photo', {
            method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form
          });
          if (!upload.ok) throw new Error((await upload.json().catch(() => ({}))).message || 'Storefront photo upload failed');
        }
        document.getElementById('biz-documents-status').textContent =
          (body.gstNumber || body.licenceNumber || body.shopEstablishmentNumber || body.udyamNumber || body.pan) ? 'Documents: documented' : 'Documents: no documents';
        document.getElementById('business-profile-id').value = res.id;
        showAlert('Business created: ' + res.code + '. Next step: send the agreement and assign a verification visit.');
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    let loadedBusinessId = '';
    async function loadBusinessProfile() {
      try {
        const id = document.getElementById('business-profile-id').value.trim();
        const business = await api('/businesses/' + encodeURIComponent(id));
        loadedBusinessId = business.id;
        const next = { lead: 'send agreement', pending_visit: 'complete assigned visit', pending_tl_check: 'approve', verified: 'verified', rejected: 'review rejection' }[business.verificationStatus] || 'review';
        const agentId = business.accountAgentSummary ? business.accountAgentSummary.name + ' (' + business.accountAgentSummary.code + ')' : 'Unassigned';
        document.getElementById('business-profile-details').textContent =
          business.name + ' · ' + business.verificationStatus + ' · Next step: ' + next + ' · Documents: ' + (business.documentsStatus === 'no_documents' ? 'no documents' : 'documented') + ' · Account agent: ' + agentId;
        document.getElementById('business-profile-actions').classList.remove('hidden');
        document.getElementById('business-send-agreement').classList.toggle('hidden', business.verificationStatus !== 'lead');
        document.getElementById('business-agreement-link').classList.add('hidden');
        const agreement = business.agreements?.[0];
        if (agreement?.signedAt && ['team_lead', 'manager', 'ceo'].includes(currentUser?.role)) {
          const link = document.getElementById('business-agreement-link');
          link.href = '#';
          link.onclick = async (event) => {
            event.preventDefault();
            try {
              const response = await fetch('/businesses/' + encodeURIComponent(business.id) + '/agreement', { headers: { Authorization: 'Bearer ' + token } });
              if (!response.ok) throw new Error('Could not load signed agreement');
              const blobUrl = URL.createObjectURL(await response.blob());
              window.open(blobUrl, '_blank', 'noopener');
            } catch (e) { showAlert(e.message, false); }
          };
          link.classList.remove('hidden');
        }
      } catch (e) { showAlert(e.message, false); }
    }

    async function sendBusinessAgreement() {
      try {
        const id = loadedBusinessId || document.getElementById('business-profile-id').value.trim();
        await api('/businesses/' + encodeURIComponent(id) + '/agreement-links', { method: 'POST', body: { language: 'en' } });
        showAlert('Agreement link sent to the business owner.');
        await loadBusinessProfile();
      } catch (e) { showAlert(e.message, false); }
    }

    let eligibleWithdrawalCallId = '';
    async function checkConsentWithdrawalEligibility() {
      const id = document.getElementById('withdraw-job-seeker-id').value.trim();
      const panel = document.getElementById('withdraw-consent-form');
      panel.classList.add('hidden');
      eligibleWithdrawalCallId = '';
      try {
        const result = await api('/consent/withdrawal-eligibility?jobSeekerId=' + encodeURIComponent(id));
        if (!result.eligible || !result.callRecordId) {
          document.getElementById('withdraw-consent-status').textContent = 'No answered call for this job seeker is inside the withdrawal window.';
          return;
        }
        eligibleWithdrawalCallId = result.callRecordId;
        document.getElementById('withdraw-consent-status').textContent = 'Answered call confirmed. Select the purposes the job seeker asked to withdraw.';
        panel.classList.remove('hidden');
      } catch (e) { document.getElementById('withdraw-consent-status').textContent = e.message; }
    }

    async function withdrawJobSeekerConsent() {
      const purposes = Array.from(document.querySelectorAll('.withdraw-purpose:checked')).map(el => el.value);
      if (!purposes.length || !eligibleWithdrawalCallId) return alert('Check an answered call and select at least one purpose');
      try {
        const result = await api('/consent/withdraw', { method: 'POST', body: {
          jobSeekerId: document.getElementById('withdraw-job-seeker-id').value.trim(),
          callRecordId: eligibleWithdrawalCallId, purposes
        }});
        document.getElementById('withdraw-consent-form').classList.add('hidden');
        document.getElementById('withdraw-consent-status').textContent = result.withdrawn ? 'Consent withdrawn. Audit recorded and SMS confirmation sent.' : 'No active consent was changed.';
      } catch (e) { document.getElementById('withdraw-consent-status').textContent = e.message; }
    }

    // 4. Submit Vacancy
    async function submitVacancy() {
      try {
        const bizId = document.getElementById('vc-biz-id').value.trim();
        const tradeSkill = document.getElementById('vc-trade').value.trim();
        const salaryMinPaise = Number(document.getElementById('vc-salary').value) * 100;
        const headcount = Number(document.getElementById('vc-headcount').value);
        const description = document.getElementById('vc-desc').value.trim();
        const csv = (id) => document.getElementById(id).value.split(',').map(v => v.trim()).filter(Boolean);
        const extras = Array.from(document.getElementById('vc-extras').selectedOptions).map(option => option.value);
        const interviewType = document.getElementById('vc-interview-type').value;
        const slotStart = document.getElementById('vc-slot-start').value;
        const slotEnd = document.getElementById('vc-slot-end').value;

        const res = await api('/vacancies', {
          method: 'POST',
          body: {
            businessId: bizId, tradeSkill, salaryMinPaise, salaryMaxPaise: Number(document.getElementById('vc-salary-max').value) * 100 || undefined,
            salaryPeriod: document.getElementById('vc-salary-period').value, headcount, description,
            roleTitle: document.getElementById('vc-role-title').value.trim() || undefined, extras,
            workingHours: document.getElementById('vc-hours').value.trim() || undefined,
            shift: document.getElementById('vc-shift').value.trim() || undefined,
            weeklyOff: document.getElementById('vc-weekly-off').value.trim() || undefined,
            locality: document.getElementById('vc-locality').value.trim() || undefined,
            latitude: document.getElementById('vc-latitude').value ? Number(document.getElementById('vc-latitude').value) : undefined,
            longitude: document.getElementById('vc-longitude').value ? Number(document.getElementById('vc-longitude').value) : undefined,
            experienceRequiredYears: Number(document.getElementById('vc-experience').value) || undefined,
            educationRequired: document.getElementById('vc-education').value.trim() || undefined,
            languagesRequired: csv('vc-languages'), licencesRequired: csv('vc-licences'),
            ageMin: Number(document.getElementById('vc-age-min').value) || undefined, ageMax: Number(document.getElementById('vc-age-max').value) || undefined,
            genderRequirement: document.getElementById('vc-gender').value, genderReason: document.getElementById('vc-gender-reason').value.trim() || undefined,
            startDate: document.getElementById('vc-start-date').value || undefined,
            urgency: document.getElementById('vc-urgency').value,
            probationDays: Number(document.getElementById('vc-probation').value) || undefined,
            interviewType,
            interviewContactName: document.getElementById('vc-interview-contact').value.trim() || undefined,
            walkInDate: document.getElementById('vc-walk-in-date').value || undefined,
            interviewSlots: interviewType === 'scheduled' && slotStart && slotEnd ? [{ startsAt: new Date(slotStart).toISOString(), endsAt: new Date(slotEnd).toISOString(), capacity: Number(document.getElementById('vc-slot-capacity').value) }] : undefined
          }
        });
        showAlert('Vacancy captured successfully: ' + res.code);
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    // 5. Shortlist
    let shortlistPage = 1;
    let shortlistPageCount = 1;
    let shortlistSelectedIds = new Set();

    async function loadShortlist() {
      shortlistPage = 1;
      shortlistSelectedIds = new Set();
      await loadShortlistPage(1);
    }

    async function loadShortlistPage(page) {
      const vcId = document.getElementById('shortlist-vc-id').value.trim();
      if (!vcId) return alert('Vacancy ID required');
      try {
        const data = await api('/vacancies/' + encodeURIComponent(vcId) + '/shortlist?page=' + page);
        shortlistPage = data.page;
        shortlistPageCount = Math.ceil(data.total / data.pageSize);
        const container = document.getElementById('shortlist-cards');
        container.replaceChildren();
        data.matches.forEach(match => {
          const card = match.card;
          const article = document.createElement('article');
          article.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--card-bg)';
          const selectLabel = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = shortlistSelectedIds.has(match.jobSeekerId);
          checkbox.addEventListener('change', () => checkbox.checked ? shortlistSelectedIds.add(match.jobSeekerId) : shortlistSelectedIds.delete(match.jobSeekerId));
          selectLabel.append(checkbox, document.createTextNode(' Select candidate'));
          article.appendChild(selectLabel);
          if (card.photoUrl) { const photo = document.createElement('img'); photo.src = card.photoUrl; photo.alt = 'Candidate photo'; photo.width = 72; photo.height = 72; photo.style.cssText = 'display:block;object-fit:cover;border-radius:50%;margin:10px 0'; article.appendChild(photo); }
          const title = document.createElement('h3'); title.textContent = card.firstName + ', ' + card.age; article.appendChild(title);
          const fields = [card.trade + ' · ' + card.yearsExperience + ' yrs', card.languages.join(', '), card.distanceKm + ' km away', '₹' + (card.expectedSalary.minPaise / 100).toLocaleString('en-IN') + ' – ₹' + (card.expectedSalary.maxPaise / 100).toLocaleString('en-IN'), match.matchReasons.join(' · ')];
          fields.filter(Boolean).forEach(value => { const row = document.createElement('p'); row.textContent = value; article.appendChild(row); });
          const book = document.createElement('button'); book.textContent = 'Book interview'; book.className = 'btn-success';
          book.addEventListener('click', () => bookInterviewFromCard(vcId, match.jobSeekerId, article)); article.appendChild(book);
          container.appendChild(article);
        });
        if (!data.matches.length) { const empty = document.createElement('p'); empty.textContent = 'No matching candidates on this page.'; container.appendChild(empty); }
        const leftOut = data.leftOut;
        document.getElementById('shortlist-left-out').textContent = 'Left out — no location: ' + leftOut.no_location + ' (complete home location); no travel distance: ' + leftOut.no_travel_distance + ' (complete travel distance); consent missing: ' + leftOut.consent_missing + ' (confirm matching and profile sharing consent).';
        const next = document.getElementById('shortlist-next');
        next.hidden = shortlistPage >= shortlistPageCount;
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function bookInterviewFromCard(vacancyId, jobSeekerId, article) {
      try {
        const slots = await api('/interviews/vacancies/' + encodeURIComponent(vacancyId) + '/slots');
        const available = slots.filter(slot => slot.remainingCapacity === null || slot.remainingCapacity > 0);
        if (!available.length) return showAlert('No future interview slots have remaining capacity.', false);
        let panel = article.querySelector('.interview-slot-booking');
        if (!panel) { panel = document.createElement('div'); panel.className = 'interview-slot-booking'; panel.style.marginTop = '10px'; article.appendChild(panel); }
        panel.replaceChildren();
        const select = document.createElement('select');
        available.forEach(slot => {
          const option = document.createElement('option'); option.value = slot.id;
          option.textContent = new Date(slot.startsAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) + ' · ' +
            (slot.remainingCapacity === null ? 'capacity open' : slot.remainingCapacity + ' spaces left');
          select.appendChild(option);
        });
        const confirm = document.createElement('button'); confirm.textContent = 'Confirm booking'; confirm.className = 'btn-success';
        confirm.addEventListener('click', async () => {
          try {
            await api('/interviews', { method: 'POST', body: { vacancyId, jobSeekerId, slotId: select.value } });
            showAlert('Interview booked; offer sent to candidate.'); panel.replaceChildren(); await loadAgentInterviews();
          } catch (e) { showAlert(e.message, false); }
        });
        panel.append(select, confirm);
      } catch (e) { showAlert(e.message, false); }
    }

    async function loadAgentInterviews() {
      const target = document.getElementById('interview-list');
      try {
        const vacancyId = document.getElementById('interview-filter-vacancy').value.trim();
        const data = await api('/interviews' + (vacancyId ? '?vacancyId=' + encodeURIComponent(vacancyId) : ''));
        target.replaceChildren();
        if (!data.length) { target.textContent = 'No interviews found.'; return; }
        data.forEach(interview => {
          const card = document.createElement('article'); card.className = 'card';
          const title = document.createElement('h3'); title.textContent = interview.code + ' · ' + interview.vacancy.code + ' · ' + interview.jobSeeker.code; card.appendChild(title);
          const details = document.createElement('p');
          details.textContent = interview.status + ' · Reply due ' + new Date(interview.replyDueAt).toLocaleString('en-IN') +
            ' · Result due ' + new Date(interview.resultDueAt).toLocaleString('en-IN') +
            ' · Attendance visit ' + (interview.agentAttendanceRequired ? 'needed' : 'not needed'); card.appendChild(details);
          if (interview.placement) {
            const placement = document.createElement('p'); placement.textContent = 'Placement ' + interview.placement.code + ' · ' + interview.placement.status +
              (interview.placement.paymentDueAt ? ' · Payment due ' + new Date(interview.placement.paymentDueAt).toLocaleString('en-IN') : '') +
              (interview.placement.paidAt ? ' · Paid ' + new Date(interview.placement.paidAt).toLocaleDateString('en-IN') : ''); card.appendChild(placement);
          }
          if (interview.answeredOfferCallId) {
            const form = document.createElement('div'); form.className = 'offer-call-reply-form';
            const answer = document.createElement('select'); answer.innerHTML = '<option value="accepted_offer">Candidate accepts</option><option value="rejected_offer">Candidate declines</option>';
            const reason = document.createElement('input'); reason.placeholder = 'Reason required when declined';
            const submit = document.createElement('button'); submit.textContent = 'Record answered call reply';
            submit.addEventListener('click', async () => {
              try {
                await api('/interviews/' + interview.id + '/call-reply', { method: 'POST', body: {
                  callRecordId: interview.answeredOfferCallId, answer: answer.value, reason: reason.value.trim() || undefined,
                } });
                showAlert('Interview reply recorded.'); await loadAgentInterviews();
              } catch (e) { showAlert(e.message, false); }
            });
            form.append(answer, reason, submit); card.appendChild(form);
          }
          target.appendChild(card);
        });
      } catch (e) { target.textContent = e.message; }
    }

    async function submitSelectedIntroductions(path, body, successMessage) {
      const vcId = document.getElementById('shortlist-vc-id').value.trim();
      if (!vcId) return showAlert('Vacancy ID required', false);
      if (!shortlistSelectedIds.size) return showAlert('Select at least one candidate', false);
      try {
        const result = await api('/vacancies/' + encodeURIComponent(vcId) + path, {
          method: 'POST',
          body: Object.assign({ jobSeekerIds: Array.from(shortlistSelectedIds) }, body || {})
        });
        showAlert(successMessage + ' (' + result.count + ')');
        shortlistSelectedIds = new Set();
        await loadShortlist();
      } catch (e) { showAlert(e.message, false); }
    }

    function sendSelectedToOwner() {
      return submitSelectedIntroductions('/introductions', { channel: document.getElementById('shortlist-channel').value }, 'Candidates sent to owner');
    }

    function showSelectedInPerson() {
      return submitSelectedIntroductions('/introductions/in-person', {}, 'Candidates recorded as shown in person');
    }

    function formatPhoneLast4(val) {
      if (!val) return '—';
      const digits = String(val).replace(/[^0-9]/g, '');
      return digits.length >= 4 ? '••••••' + digits.slice(-4) : '••••••';
    }

    // 6. Calling, Profile & Hits
    let currentCallingSubject = null;
    let activeCallRecordId = null;

    function quickCallSeeker(id, code) {
      document.querySelector('.tab-btn[data-tab="contact-attempts"]').click();
      document.getElementById('call-subject-type').value = 'job_seeker';
      document.getElementById('call-subject-id').value = code || id;
      loadCallingProfile('job_seeker', id || code).then(function() {
        triggerProfileCall();
      });
    }

    async function loadCallingProfile(type, id) {
      const subjectType = type || document.getElementById('call-subject-type').value;
      const subjectId = id || document.getElementById('call-subject-id').value.trim();
      if (!subjectId) return alert('Enter ID or Code');

      document.getElementById('call-blocked-alert').style.display = 'none';
      document.getElementById('call-in-progress-section').style.display = 'none';
      document.getElementById('answered-outcome-form').style.display = 'none';

      try {
        let endpoint = '/job-seekers/' + encodeURIComponent(subjectId);
        if (subjectType === 'business') endpoint = '/businesses/' + encodeURIComponent(subjectId);
        if (subjectType === 'referral') endpoint = '/referrals/' + encodeURIComponent(subjectId);

        const data = await api(endpoint);
        currentCallingSubject = { type: subjectType, id: data.id, code: data.code, data: data };

        document.getElementById('profile-card-name').textContent = data.name || data.contactName || '—';
        document.getElementById('profile-card-code').textContent = data.code || subjectId;
        document.getElementById('profile-card-phone').textContent = formatPhoneLast4(data.phone);
        document.getElementById('profile-card-status').textContent = data.status || 'Active';

        const pRow = document.getElementById('profile-payment-status-row');
        if (pRow) {
          if (subjectType === 'job_seeker') {
            pRow.style.display = 'block';
            const isPaid = data.paymentReceivedAt || ['active', 'placed'].includes(data.status);
            const pStatus = isPaid ? 'paid' : (data.status === 'lead' ? 'waiting' : data.status);
            document.getElementById('profile-card-payment-status').textContent = pStatus;
            const resendBtn = document.getElementById('btn-resend-profile-payment');
            if (resendBtn) {
              resendBtn.style.display = (!isPaid && data.status === 'lead') ? 'inline-block' : 'none';
            }
          } else {
            pRow.style.display = 'none';
          }
        }

        document.getElementById('calling-profile-card').style.display = 'block';

        await loadProfileHistory(subjectType, data.id || subjectId);
      } catch (e) {
        showAlert('Error loading profile: ' + e.message, false);
      }
    }

    async function resendCurrentProfilePayment() {
      if (!currentCallingSubject || currentCallingSubject.type !== 'job_seeker') return;
      try {
        await api('/job-seekers/' + currentCallingSubject.id + '/resend-payment', { method: 'POST' });
        showAlert('Payment link resent to candidate');
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function triggerProfileCall() {
      if (!currentCallingSubject) return alert('Load a profile first');
      const btn = document.getElementById('btn-trigger-call');
      btn.disabled = true;
      document.getElementById('call-blocked-alert').style.display = 'none';
      document.getElementById('answered-outcome-form').style.display = 'none';

      const purpose = document.getElementById('call-purpose-select').value;
      try {
        const res = await api('/calls', {
          method: 'POST',
          body: {
            subjectType: currentCallingSubject.type,
            subjectId: currentCallingSubject.id,
            purpose: purpose,
          }
        });
        activeCallRecordId = res.callRecordId || res.id;
        document.getElementById('call-in-progress-section').style.display = 'block';

        let callData = null;
        try {
          callData = await api('/calls/' + activeCallRecordId);
        } catch {}

        if (callData && callData.answered) {
          document.getElementById('call-status-message').textContent = 'Call answered (' + (callData.code || activeCallRecordId) + '). Record outcome below:';
          document.getElementById('answered-outcome-form').style.display = 'block';
        } else {
          document.getElementById('call-status-message').textContent = 'Call placed: ' + (callData ? (callData.answered ? 'answered' : 'unanswered (' + callData.providerStatus + ')') : 'initiated') + '.';
          document.getElementById('answered-outcome-form').style.display = callData && callData.answered ? 'block' : 'none';
        }
        showAlert('Call placed: ' + (callData ? callData.code : activeCallRecordId));
        await loadProfileHistory(currentCallingSubject.type, currentCallingSubject.id);
      } catch (e) {
        const msg = e.message || 'Calling is currently blocked';
        document.getElementById('call-blocked-alert').textContent = 'Calling blocked: ' + msg;
        document.getElementById('call-blocked-alert').style.display = 'block';
        showAlert('Calling blocked: ' + msg, false);
      } finally {
        btn.disabled = false;
      }
    }

    async function submitProfileCallOutcome() {
      if (!activeCallRecordId) return alert('No active answered call to record outcome for');
      const outcome = document.getElementById('call-agent-outcome').value;
      const reason = document.getElementById('call-agent-outcome-reason').value.trim();
      try {
        await api('/calls/' + activeCallRecordId + '/outcome', {
          method: 'POST',
          body: { agentOutcome: outcome, reason: reason || undefined }
        });
        showAlert('Outcome recorded: ' + outcome);
        document.getElementById('answered-outcome-form').style.display = 'none';
        document.getElementById('call-status-message').textContent = 'Outcome recorded: ' + outcome;
        if (currentCallingSubject) {
          await loadProfileHistory(currentCallingSubject.type, currentCallingSubject.id);
        }
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function loadProfileHistory(subjectType, subjectId) {
      const tbody = document.getElementById('profile-history-tbody');
      tbody.innerHTML = '<tr><td colspan="7">Loading history...</td></tr>';
      document.getElementById('profile-history-section').style.display = 'block';
      try {
        const calls = await api('/calls?subjectType=' + subjectType + '&subjectId=' + encodeURIComponent(subjectId));
        let messages = [];
        const payload = parseJwt(token);
        const canReadMessages = payload && ['team_lead', 'manager', 'ceo'].includes(payload.role);
        if (canReadMessages) {
          try {
            messages = await api('/messages?subjectType=' + subjectType + '&subjectId=' + encodeURIComponent(subjectId));
          } catch {}
        }

        const items = [];
        (calls || []).forEach(function (c) {
          items.push({
            time: c.startedAt || c.createdAt,
            type: 'Call (' + (c.direction || 'outbound') + ')',
            purpose: c.purpose || 'general',
            answered: c.answered ? 'Yes' : 'No',
            duration: c.durationSec != null ? c.durationSec + 's' : '—',
            outcome: c.agentOutcome || c.providerStatus || '—',
            recording: c.recordingStoragePath ? c.id : null,
          });
        });
        (messages || []).forEach(function (m) {
          items.push({
            time: m.sentAt || m.createdAt,
            type: m.channel ? m.channel.toUpperCase() : 'Message',
            purpose: m.template || '—',
            answered: '—',
            duration: '—',
            outcome: m.status || 'sent',
            recording: null,
          });
        });

        items.sort(function (a, b) {
          return new Date(b.time).getTime() - new Date(a.time).getTime();
        });

        const isRecordingRole = payload && ['team_lead', 'manager', 'ceo'].includes(payload.role);

        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7">No call or message history found</td></tr>';
          return;
        }

        tbody.innerHTML = items.map(function (it) {
          const listenBtn = (it.recording && isRecordingRole)
            ? '<button class="btn-sm" onclick="listenRecording(' + JSON.stringify(it.recording) + ')">Listen</button>'
            : '—';
          return '<tr>' +
            '<td>' + (it.time ? new Date(it.time).toLocaleString('en-IN') : '—') + '</td>' +
            '<td>' + it.type + '</td>' +
            '<td>' + it.purpose + '</td>' +
            '<td>' + it.answered + '</td>' +
            '<td>' + it.duration + '</td>' +
            '<td>' + it.outcome + '</td>' +
            '<td>' + listenBtn + '</td>' +
          '</tr>';
        }).join('');
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7">Could not load history: ' + e.message + '</td></tr>';
      }
    }

    async function listenRecording(callId) {
      try {
        const res = await api('/calls/' + callId + '/recording');
        if (res.url) {
          window.open(res.url, '_blank');
        } else {
          showAlert('No recording URL returned', false);
        }
      } catch (e) {
        showAlert('Recording listen failed: ' + e.message, false);
      }
    }

    async function submitHit() {
      const jsId = document.getElementById('hit-js-id').value.trim();
      if (!jsId) return alert('Candidate ID required');
      try {
        const body = {
          reason: document.getElementById('hit-reason').value,
          note: document.getElementById('hit-note').value.trim(),
        };
        const res = await api('/job-seekers/' + jsId + '/hits', { method: 'POST', body });
        showAlert('Hit recorded! New candidate hit count: ' + res.hitCount);
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function loadAgentPlacements() {
      const target = document.getElementById('agent-placement-list');
      try {
        const placements = await api('/placements');
        target.replaceChildren();
        if (!placements.length) { target.textContent = 'No placements found.'; return; }
        const now = Date.now();
        placements.forEach(placement => {
          const row = document.createElement('article'); row.className = 'card';
          const heading = document.createElement('h3'); heading.textContent = placement.code + ' · ' + placement.jobSeeker.code + ' · ' + placement.status;
          const due = placement.paymentDueAt ? new Date(placement.paymentDueAt).toLocaleString('en-IN') : '—';
          const paymentStatus = placement.paidAt ? 'Paid' : placement.status === 'awaiting_payment' && placement.paymentDueAt && new Date(placement.paymentDueAt).getTime() <= now ? 'Overdue' : placement.status === 'awaiting_payment' ? 'Awaiting payment' : '—';
          const details = document.createElement('p'); details.textContent = 'Payment due ' + due + ' · ' + paymentStatus;
          row.append(heading, details);
          if (!placement.paidAt && placement.status === 'awaiting_payment') {
            const resendBtn = document.createElement('button');
            resendBtn.className = 'btn-sm';
            resendBtn.textContent = 'Resend payment link';
            resendBtn.onclick = async () => {
              try {
                await api('/placements/' + placement.id + '/resend-payment', { method: 'POST' });
                showAlert('Payment link resent to business');
              } catch (e) {
                showAlert(e.message, false);
              }
            };
            row.appendChild(resendBtn);
          }
          target.appendChild(row);
        });
      } catch (e) { target.textContent = e.message; }
    }

    window.addEventListener('DOMContentLoaded', () => {
      initUser();
    });
  </script>
</body>
</html>`;
}
