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
      <div id="login-form-fields">
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="login-email" placeholder="ca@laboura.local">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="login-password" placeholder="••••••••">
        </div>
        <div class="form-group">
          <label>Authenticator Code (6 digits)</label>
          <input type="text" id="login-totp" maxlength="6" pattern="[0-9]{6}" style="width: 100%; letter-spacing: 2px;" placeholder="123456" autocomplete="one-time-code">
          <small style="color: var(--text-muted); font-size: 0.75rem;">Leave blank if logging in for the first time to enroll 2FA.</small>
        </div>
        <button id="btn-login" style="width: 100%; margin-top: 8px;">Log In</button>
      </div>

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
    <button class="tab-btn" data-tab="vacancy-capture">Vacancy Capture</button>
    <button class="tab-btn" data-tab="shortlist">Candidate Shortlist</button>
    <button class="tab-btn" data-tab="contact-attempts">Contact & Hits</button>
    <button class="tab-btn" data-tab="placement-flow">Placement Flow</button>
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
                <input type="text" id="js-phone" placeholder="9876543210">
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
              <input type="text" id="rf-phone" placeholder="9876543211">
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
                <input type="text" id="biz-phone" placeholder="9876543212">
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
            <div class="form-group">
              <label>Contact Person Name</label>
              <input type="text" id="biz-contact" placeholder="Anil Rao">
            </div>
          </div>
          <div>
            <div class="form-group">
              <label>Bengaluru Area</label>
              <input type="text" id="biz-area" placeholder="Koramangala, Indiranagar, Whitefield...">
            </div>
            <div class="form-group">
              <label>Address</label>
              <input type="text" id="biz-address" placeholder="100 Feet Rd, 4th Block">
            </div>
            <div class="form-group">
              <label>GST Number (Optional)</label>
              <input type="text" id="biz-gst" placeholder="29ABCDE1234F1Z5">
            </div>
          </div>
        </div>
        <button onclick="submitBusiness()" style="margin-top: 12px;">Register Business</button>
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
          <span>Candidate Shortlist (Phase 4 Filtered List)</span>
        </div>
        <div style="display: flex; gap: 12px; margin-bottom: 16px;">
          <input type="text" id="shortlist-vc-id" placeholder="Enter Vacancy ID or Code (e.g. VC-00001)" style="max-width: 400px;">
          <button onclick="loadShortlist()">Fetch Shortlist</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Candidate Code</th>
                <th>Name</th>
                <th>Trade</th>
                <th>Salary Range (INR)</th>
                <th>Hits</th>
                <th>Guarantee Deadline</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="shortlist-tbody">
              <tr><td colspan="7" style="text-align: center;">Enter a vacancy ID to load matching candidates</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 6. Contact Attempts & Hit Recording -->
    <div id="view-contact-attempts" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Log Candidate Contact Attempt & Hits</span>
        </div>
        <div class="grid-2">
          <!-- Contact Attempt -->
          <div style="background: #162032; padding: 16px; border-radius: 6px;">
            <h3 style="font-size: 1rem; margin-bottom: 12px; color: var(--primary);">Log Contact Attempt</h3>
            <div class="form-group">
              <label>Candidate ID or Code</label>
              <input type="text" id="contact-js-id" placeholder="JS-00001 or UUID">
            </div>
            <div class="form-group">
              <label>Channel</label>
              <select id="contact-channel">
                <option value="call">Phone Call</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            <div class="form-group">
              <label>Outcome</label>
              <select id="contact-outcome">
                <option value="no_pickup">No Pickup</option>
                <option value="picked_up">Picked Up</option>
              </select>
            </div>
            <div class="form-group">
              <label>Time of Day</label>
              <select id="contact-time">
                <option value="am">Morning (AM)</option>
                <option value="pm">Evening (PM)</option>
              </select>
            </div>
            <button onclick="submitContactAttempt()">Record Contact Attempt</button>
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

    <!-- 7. Placement Offer & Response Flow -->
    <div id="view-placement-flow" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Placement Offer & Response Flow</span>
        </div>
        <div class="grid-2">
          <!-- Offer Placement -->
          <div style="background: #162032; padding: 16px; border-radius: 6px;">
            <h3 style="font-size: 1rem; margin-bottom: 12px; color: var(--primary);">1. Make Placement Offer</h3>
            <div class="form-group">
              <label>Vacancy ID or Code</label>
              <input type="text" id="place-vc-id" placeholder="VC-00001 or UUID">
            </div>
            <div class="form-group">
              <label>Candidate ID or Code</label>
              <input type="text" id="place-js-id" placeholder="JS-00001 or UUID">
            </div>
            <div class="form-group">
              <label>Agreed Monthly Salary (INR)</label>
              <input type="number" id="place-salary" placeholder="20000">
            </div>
            <button onclick="submitPlacementOffer()">Offer Placement</button>
          </div>

          <!-- Respond & Join -->
          <div style="background: #162032; padding: 16px; border-radius: 6px;">
            <h3 style="font-size: 1rem; margin-bottom: 12px; color: var(--primary);">2. Record Response & Joining</h3>
            <div class="form-group">
              <label>Placement ID</label>
              <input type="text" id="resp-place-id" placeholder="PL-00001 or UUID">
            </div>
            <div class="form-group">
              <label>Response</label>
              <select id="resp-response">
                <option value="accepted">Accepted / Confirmed</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div class="form-group">
              <label>Rejection Reason (if rejected)</label>
              <input type="text" id="resp-reason" placeholder="Distance too far, etc.">
            </div>
            <button onclick="submitPlacementResponse()">Record Candidate Response</button>

            <hr style="border: 0; border-top: 1px solid var(--card-border); margin: 16px 0;">

            <div class="form-group">
              <label>Joined Date (when candidate starts)</label>
              <input type="datetime-local" id="join-date">
            </div>
            <button class="btn-success" onclick="submitPlacementJoined()">Record Joined (Triggers Referral Payout)</button>
          </div>
        </div>
      </div>
    </div>

  </main>

  <script>
    let token = sessionStorage.getItem('laboura_token') || '';
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
      document.getElementById('auth-modal').classList.remove('hidden');
    }

    function hideLoginModal() {
      document.getElementById('auth-modal').classList.add('hidden');
    }

    document.getElementById('btn-login').addEventListener('click', async () => {
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const totpCode = document.getElementById('login-totp').value.trim();
      const errEl = document.getElementById('login-error');
      const infoEl = document.getElementById('login-info');
      try {
        errEl.classList.add('hidden');
        if (infoEl) infoEl.classList.add('hidden');
        const payload = { email, password };
        if (totpCode) {
          payload.totpCode = totpCode;
        }
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Login failed' }));
          throw new Error(err.message || 'Invalid credentials');
        }
        const data = await res.json();
        if (data.totpEnrollmentRequired) {
          // Account requires TOTP 2FA setup
          setupScopedToken = data.accessToken;
          const setupRes = await fetch('/staff/2fa/setup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + setupScopedToken
            }
          });
          if (!setupRes.ok) {
            const err = await setupRes.json().catch(() => ({ message: 'Failed to start 2FA setup' }));
            throw new Error(err.message || 'Failed to start 2FA setup');
          }
          const setupData = await setupRes.json();
          document.getElementById('totp-setup-secret').textContent = setupData.secret;
          document.getElementById('login-form-fields').classList.add('hidden');
          document.getElementById('totp-enroll-section').classList.remove('hidden');
          return;
        }

        token = data.accessToken;
        sessionStorage.setItem('laboura_token', token);
        hideLoginModal();
        initUser();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('hidden');
      }
    });

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
          area: document.getElementById('biz-area').value.trim(),
          contactName: document.getElementById('biz-contact').value.trim(),
          address: document.getElementById('biz-address').value.trim(),
          gstNumber: document.getElementById('biz-gst').value.trim() || undefined,
          otpRequestId: reqId,
        };

        const res = await api('/businesses', { method: 'POST', body });
        showAlert('Business created: ' + res.code);
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    // 4. Submit Vacancy
    async function submitVacancy() {
      try {
        const bizId = document.getElementById('vc-biz-id').value.trim();
        const tradeSkill = document.getElementById('vc-trade').value.trim();
        const offeredSalary = Number(document.getElementById('vc-salary').value) * 100;
        const headcount = Number(document.getElementById('vc-headcount').value);
        const description = document.getElementById('vc-desc').value.trim();

        const res = await api('/vacancies', {
          method: 'POST',
          body: { businessId: bizId, tradeSkill, offeredSalary, headcount, description }
        });
        showAlert('Vacancy captured successfully: ' + res.code);
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    // 5. Shortlist
    async function loadShortlist() {
      const vcId = document.getElementById('shortlist-vc-id').value.trim();
      if (!vcId) return alert('Vacancy ID required');
      try {
        const data = await api('/vacancies/' + vcId + '/shortlist');
        const tbody = document.getElementById('shortlist-tbody');
        tbody.innerHTML = data.map(c => \`
          <tr>
            <td><strong>\${c.code}</strong></td>
            <td>\${c.name}</td>
            <td>\${c.tradeSkill}</td>
            <td>₹\${(c.minSalary/100).toLocaleString()} - ₹\${(c.maxSalary/100).toLocaleString()}</td>
            <td><span class="badge" style="background: \${c.hitCount >= 2 ? 'var(--danger)' : '#334155'};">\${c.hitCount} Hits</span></td>
            <td>\${c.paymentReceivedAt ? new Date(new Date(c.paymentReceivedAt).getTime() + 30*24*3600*1000).toLocaleDateString() : '—'}</td>
            <td>
              <button class="btn-sm" onclick="selectCandidateForOffer('\${vcId}', '\${c.id}', '\${c.code}')">Select for Placement</button>
            </td>
          </tr>
        \`).join('') || '<tr><td colspan="7">No matching active candidates found</td></tr>';
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    function selectCandidateForOffer(vcId, jsId, jsCode) {
      document.querySelector('.tab-btn[data-tab="placement-flow"]').click();
      document.getElementById('place-vc-id').value = vcId;
      document.getElementById('place-js-id').value = jsId;
      showAlert('Selected candidate ' + jsCode + ' for placement offer');
    }

    // 6. Contact attempts & Hits
    async function submitContactAttempt() {
      const jsId = document.getElementById('contact-js-id').value.trim();
      if (!jsId) return alert('Candidate ID required');
      try {
        const body = {
          channel: document.getElementById('contact-channel').value,
          outcome: document.getElementById('contact-outcome').value,
          timeOfDay: document.getElementById('contact-time').value,
        };
        const res = await api('/job-seekers/' + jsId + '/contact-attempts', { method: 'POST', body });
        showAlert('Contact attempt recorded! ID: ' + res.id);
      } catch (e) {
        showAlert(e.message, false);
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

    // 7. Placement Flow
    async function submitPlacementOffer() {
      const vcId = document.getElementById('place-vc-id').value.trim();
      const jsId = document.getElementById('place-js-id').value.trim();
      const salary = Number(document.getElementById('place-salary').value) * 100;
      if (!vcId || !jsId || !salary) return alert('Fill vacancy, candidate, and salary');
      try {
        const res = await api('/vacancies/' + vcId + '/placements', {
          method: 'POST',
          body: { jobSeekerId: jsId, agreedSalary: salary }
        });
        showAlert('Placement offer created! Placement Code: ' + res.code);
        document.getElementById('resp-place-id').value = res.id;
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function submitPlacementResponse() {
      const plId = document.getElementById('resp-place-id').value.trim();
      const resp = document.getElementById('resp-response').value;
      const reason = document.getElementById('resp-reason').value.trim();
      if (!plId) return alert('Placement ID required');
      try {
        const res = await api('/placements/' + plId + '/respond', {
          method: 'POST',
          body: { response: resp, rejectionReason: reason || undefined }
        });
        showAlert('Candidate response recorded! Placement status: ' + res.status);
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function submitPlacementJoined() {
      const plId = document.getElementById('resp-place-id').value.trim();
      const joinDateInput = document.getElementById('join-date').value;
      if (!plId) return alert('Placement ID required');
      try {
        const body = {};
        if (joinDateInput) {
          body.joinedDate = new Date(joinDateInput).toISOString();
        }
        const res = await api('/placements/' + plId + '/joined', { method: 'POST', body });
        showAlert('Candidate joined successfully! Status: ' + res.status + '. Referral payout triggered.');
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      initUser();
    });
  </script>
</body>
</html>`;
}
