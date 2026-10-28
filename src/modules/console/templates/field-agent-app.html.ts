export function renderFieldAgentAppHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Laboura — Field Agent App</title>
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
      padding-bottom: 50px;
    }
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--card-border);
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 { font-size: 1.15rem; font-weight: 700; color: #fff; }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      background: #0369a1;
      color: #bae6fd;
    }
    .badge-critical { background: #7f1d1d; color: #fca5a5; }
    .badge-high { background: #9a3412; color: #fed7aa; }
    .badge-medium { background: #854d0e; color: #fef08a; }
    .badge-low { background: #065f46; color: #a7f3d0; }
    .badge-replacement { background: #581c87; color: #e9d5ff; border: 1px solid #c084fc; font-weight: 700; }
    .badge-2hit { background: #dc2626; color: #ffffff; font-weight: 800; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.75; } }
    .user-info { display: flex; align-items: center; gap: 10px; }
    button {
      background: var(--primary);
      color: white;
      border: none;
      padding: 8px 14px;
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
    .nav-tabs {
      display: flex;
      gap: 6px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--card-border);
      padding: 8px 16px 0 16px;
      overflow-x: auto;
    }
    .tab-btn {
      background: transparent;
      color: var(--text-muted);
      border: none;
      border-bottom: 2px solid transparent;
      padding: 10px 14px;
      border-radius: 0;
      font-weight: 600;
      white-space: nowrap;
    }
    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }
    main { max-width: 1100px; margin: 20px auto; padding: 0 16px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 20px;
    }
    .card-title {
      font-size: 1.05rem;
      font-weight: 600;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
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
    .camera-box {
      border: 2px dashed #475569;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      background: #0f172a;
      margin-bottom: 14px;
    }
    .camera-box input[type="file"] {
      display: none;
    }
    .camera-btn {
      display: inline-block;
      padding: 10px 20px;
      background: #2563eb;
      color: #fff;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.875rem;
    }
    .camera-btn:hover { background: #1d4ed8; }
    .table-container { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.875rem;
    }
    th, td {
      padding: 10px 12px;
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
      max-width: 380px;
      padding: 24px;
    }
    .hidden { display: none !important; }
    .grid-board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .board-card {
      background: #162032;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 16px;
    }
  </style>
</head>
<body>

  <!-- Auth Modal -->
  <div id="auth-modal" class="auth-overlay hidden">
    <div class="modal">
      <h2 style="margin-bottom: 16px; font-size: 1.2rem;">Field Agent Login</h2>
      <div id="login-error" class="alert alert-danger hidden"></div>
      <div id="login-info" class="alert alert-success hidden"></div>
      <div id="login-form-fields">
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="login-email" placeholder="fa@laboura.local">
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
      <h1>Laboura Field Agent App</h1>
      <span style="font-size: 0.75rem; color: var(--text-muted);" id="agent-area-display">Assigned Area: Loading...</span>
    </div>
    <div class="user-info">
      <span id="user-display" style="font-size: 0.875rem;">Not logged in</span>
      <span id="user-role-badge" class="badge">FIELD_AGENT</span>
      <button id="btn-logout" class="btn-sm btn-secondary">Log Out</button>
    </div>
  </header>

  <nav class="nav-tabs">
    <button class="tab-btn active" data-tab="priority-dashboard">★ Priority Dashboard</button>
    <button class="tab-btn" data-tab="onboard-biz">Business Onboarding (Selfie)</button>
    <button class="tab-btn" data-tab="vacancy-capture">Capture Vacancy</button>
    <button class="tab-btn" data-tab="shortlist-interview">Shortlist & Interview</button>
  </nav>

  <main>
    <div id="status-alert" class="alert hidden"></div>

    <!-- 1. Priority Dashboard Screen (Field Agent's Daily-Use Screen) -->
    <div id="view-priority-dashboard" class="tab-view">
      <!-- Live Priority Sub-Nav -->
      <div style="display: flex; gap: 8px; margin-bottom: 16px;">
        <button class="btn-sm" id="subtab-btn-candidates" onclick="showPrioritySubTab('candidates')">Candidate Urgency (City-wide)</button>
        <button class="btn-sm btn-secondary" id="subtab-btn-vacancies" onclick="showPrioritySubTab('vacancies')">Vacancy Priority (Own Area)</button>
        <button class="btn-sm btn-secondary" id="subtab-btn-trades" onclick="showPrioritySubTab('trades')">Trade Supply/Demand Board</button>
        <button class="btn-sm" style="margin-left: auto;" onclick="loadPriorityData()">↺ Refresh Live Data</button>
      </div>

      <!-- Candidate Urgency List (City-wide) -->
      <div id="priority-sub-candidates" class="card">
        <div class="card-title">
          <span>Candidate Urgency List (City-Wide Priority)</span>
          <span style="font-size: 0.8rem; color: var(--text-muted);">Refund-guarantee clocks running down</span>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Trade</th>
                <th>Salary Range (INR)</th>
                <th>Urgency Band</th>
                <th>Hits / Warnings</th>
                <th>Guarantee Deadline</th>
              </tr>
            </thead>
            <tbody id="priority-candidates-tbody">
              <tr><td colspan="7" style="text-align: center;">Loading candidate urgency...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Vacancy Priority List (Own Area) -->
      <div id="priority-sub-vacancies" class="card hidden">
        <div class="card-title">
          <span>Vacancy Priority List (Own Area Scoped)</span>
          <span style="font-size: 0.8rem; color: var(--text-muted);">In-window replacements top prioritized</span>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Business</th>
                <th>Trade</th>
                <th>Offered Salary</th>
                <th>Type</th>
                <th>Replacement Window Deadline</th>
              </tr>
            </thead>
            <tbody id="priority-vacancies-tbody">
              <tr><td colspan="6" style="text-align: center;">Loading vacancies...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Trade Supply/Demand Board (Own Area) -->
      <div id="priority-sub-trades" class="card hidden">
        <div class="card-title">
          <span>Trade Supply / Demand Board (Own Area)</span>
          <span style="font-size: 0.8rem; color: var(--text-muted);">Surplus-candidate vs Surplus-vacancy trades at a glance</span>
        </div>
        <div id="trade-board-container" class="grid-board">
          <div style="color: var(--text-muted);">Loading trade supply/demand...</div>
        </div>
      </div>
    </div>

    <!-- 2. Business Onboarding (Camera-Only Selfie Capture) -->
    <div id="view-onboard-biz" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>In-Person Business Onboarding (Live Camera Selfie Only)</span>
        </div>
        <div style="max-width: 600px;">
          <div class="form-group">
            <label>Business Name</label>
            <input type="text" id="fa-biz-name" placeholder="Cafe Coffee Day Koramangala">
          </div>
          <div class="form-group">
            <label>Business Phone (10 digits)</label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="fa-biz-phone" placeholder="9876543210">
              <button type="button" onclick="sendBizOtp()">Send OTP</button>
            </div>
          </div>
          <div class="form-group" id="fa-biz-otp-box" style="display: none;">
            <label>Enter OTP Code</label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="fa-biz-otp-code" placeholder="6-digit code">
              <button type="button" class="btn-success" onclick="verifyBizOtp()">Verify</button>
            </div>
            <small id="fa-biz-otp-status" style="color: var(--warning); display: block; margin-top: 4px;"></small>
          </div>
          <div class="form-group">
            <label>Area (Scoped to your assigned area)</label>
            <input type="text" id="fa-biz-area" readonly style="background: #1e293b;">
          </div>
          <div class="form-group">
            <label>Address</label>
            <input type="text" id="fa-biz-address" placeholder="100 80ft Road, 4th Block">
          </div>

          <!-- Camera-Only Selfie Capture: accept="image/*" capture="user" (NO GALLERY PICKER EXPOSED) -->
          <div class="form-group">
            <label>Business Owner / Storefront Selfie (Camera Only — Anti-Fraud Required)</label>
            <div class="camera-box">
              <input type="file" id="fa-selfie-input" accept="image/*" capture="user" onchange="handleSelfieCapture(event)">
              <label for="fa-selfie-input" class="camera-btn">📷 Take Live Camera Selfie</label>
              <div id="selfie-preview-box" style="margin-top: 12px; display: none;">
                <img id="selfie-preview-img" style="max-width: 140px; border-radius: 6px; border: 1px solid var(--card-border);">
                <div style="font-size: 0.75rem; color: var(--success); margin-top: 4px;">✓ Live camera selfie captured</div>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>GPS Location</label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="fa-biz-gps" readonly placeholder="Click to capture coordinates">
              <button type="button" onclick="captureCoordinates()">📍 Get Location</button>
            </div>
          </div>

          <button id="btn-submit-fa-biz" onclick="submitFieldBusiness()" style="width: 100%; margin-top: 8px;">Complete Business Onboarding</button>
        </div>
      </div>
    </div>

    <!-- 3. Vacancy Capture -->
    <div id="view-vacancy-capture" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Capture Vacancy for Area Business</span>
        </div>
        <div style="max-width: 550px;">
          <div class="form-group">
            <label>Business Code or ID (must be in your area)</label>
            <input type="text" id="fa-vc-biz-id" placeholder="BZ-00001 or UUID">
          </div>
          <div class="form-group">
            <label>Trade Required</label>
            <input type="text" id="fa-vc-trade" placeholder="Electrician, Plumber, Helper...">
          </div>
          <div class="form-group">
            <label>Offered Salary (INR)</label>
            <input type="number" id="fa-vc-salary" placeholder="20000">
          </div>
          <div class="form-group">
            <label>Headcount</label>
            <input type="number" id="fa-vc-headcount" value="1">
          </div>
          <div class="form-group">
            <label>Description / Role Notes</label>
            <textarea id="fa-vc-desc" rows="3" placeholder="Working hours, skills needed..."></textarea>
          </div>
          <button onclick="submitFieldVacancy()">Capture Vacancy</button>
        </div>
      </div>
    </div>

    <!-- 4. Shortlist & Interview Arrangement -->
    <div id="view-shortlist-interview" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Candidate Shortlist & Arrange Interview</span>
        </div>
        <div style="display: flex; gap: 10px; margin-bottom: 16px;">
          <input type="text" id="fa-shortlist-vc-id" placeholder="Enter Vacancy ID or Code (e.g. VC-00001)" style="max-width: 400px;">
          <button onclick="loadFieldShortlist()">Fetch Area Shortlist</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Candidate Name</th>
                <th>Trade</th>
                <th>Salary Range (INR)</th>
                <th>Hits</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="fa-shortlist-tbody">
              <tr><td colspan="6" style="text-align: center;">Enter vacancy ID to load area-matched candidates</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Arrange Interview Box -->
      <div class="card" id="fa-interview-box" style="display: none;">
        <div class="card-title">
          <span>Arrange Interview / Placement Offer</span>
        </div>
        <div style="max-width: 500px;">
          <div class="form-group">
            <label>Selected Vacancy ID</label>
            <input type="text" id="fa-int-vc-id" readonly>
          </div>
          <div class="form-group">
            <label>Selected Candidate ID</label>
            <input type="text" id="fa-int-js-id" readonly>
          </div>
          <div class="form-group">
            <label>Agreed Monthly Salary (INR)</label>
            <input type="number" id="fa-int-salary" placeholder="20000">
          </div>
          <button class="btn-success" onclick="submitFieldInterview()">Confirm Interview & Create Placement Offer</button>
        </div>
      </div>
    </div>

  </main>

  <script>
    let token = sessionStorage.getItem('laboura_token') || '';
    let currentAgent = null;
    let bizOtpRequestId = '';
    let capturedSelfieHash = '';
    let capturedSelfieUrl = '';
    let agentLat = null;
    let agentLon = null;

    function showAlert(msg, isSuccess = true) {
      const el = document.getElementById('status-alert');
      el.className = 'alert ' + (isSuccess ? 'alert-success' : 'alert-danger');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 5000);
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

    function showLoginModal() {
      document.getElementById('auth-modal').classList.remove('hidden');
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

    async function initUser() {
      if (!token) {
        showLoginModal();
        return;
      }
      const payload = parseJwt(token);
      if (!payload) {
        showLoginModal();
        return;
      }
      currentAgent = payload;
      document.getElementById('user-display').textContent = payload.email;

      // Display agent's assigned area and lock area field
      const assignedArea = payload.area || 'Koramangala';
      document.getElementById('agent-area-display').textContent = 'Assigned Area: ' + assignedArea;
      document.getElementById('fa-biz-area').value = assignedArea;

      // Load Priority Dashboard data immediately
      loadPriorityData();
    }

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
        document.getElementById('view-' + tab).classList.remove('hidden');

        if (tab === 'priority-dashboard') {
          loadPriorityData(); // Always re-fetches live data, never cached stale across days
        }
      });
    });

    // Priority Subtabs
    function showPrioritySubTab(sub) {
      ['candidates', 'vacancies', 'trades'].forEach(s => {
        const btn = document.getElementById('subtab-btn-' + s);
        const view = document.getElementById('priority-sub-' + s);
        if (s === sub) {
          btn.className = 'btn-sm';
          view.classList.remove('hidden');
        } else {
          btn.className = 'btn-sm btn-secondary';
          view.classList.add('hidden');
        }
      });
    }

    // Load Priority Dashboard Live Data
    async function loadPriorityData() {
      try {
        // 1. Candidate Urgency List (City-wide, directly calling /priority/candidates)
        const candidates = await api('/priority/candidates');
        const cTbody = document.getElementById('priority-candidates-tbody');
        cTbody.innerHTML = candidates.map(c => {
          const isTwoHit = c.twoHitFlag || (c.candidate?.hitCount || 0) >= 2;
          const bandName = (c.band || c.urgencyBand || 'normal').toLowerCase();
          const bandClass = 'badge-' + bandName;
          const deadline = c.refundDeadline || c.refundGuaranteeDeadline;
          return \`
            <tr>
              <td><strong>\${c.code}</strong></td>
              <td>\${c.name}</td>
              <td>\${c.tradeSkill}</td>
              <td>₹\${(c.minSalary/100).toLocaleString()} - ₹\${(c.maxSalary/100).toLocaleString()}</td>
              <td><span class="badge \${bandClass}">\${bandName.toUpperCase()}</span></td>
              <td>
                \${isTwoHit ? '<span class="badge badge-2hit">⚠️ 2 HITS — AT RISK</span>' : \`\${c.candidate?.hitCount || 0} hits\`}
              </td>
              <td>\${deadline ? new Date(deadline).toLocaleDateString() : '—'}</td>
            </tr>
          \`;
        }).join('') || '<tr><td colspan="7">No urgent candidates found</td></tr>';

        // 2. Vacancy Priority List (Own Area, directly calling /priority/vacancies)
        const vacancies = await api('/priority/vacancies');
        const vTbody = document.getElementById('priority-vacancies-tbody');
        vTbody.innerHTML = vacancies.map(v => {
          const isReplacement = Boolean(v.replacementForPlacementId);
          return \`
            <tr style="\${isReplacement ? 'background: #2e1065;' : ''}">
              <td><strong>\${v.code}</strong></td>
              <td>\${v.business ? v.business.name : v.businessId}</td>
              <td>\${v.tradeSkill}</td>
              <td>₹\${(v.offeredSalary/100).toLocaleString()}</td>
              <td>
                \${isReplacement ? '<span class="badge badge-replacement">REPLACEMENT (IN-WINDOW)</span>' : '<span class="badge">FRESH</span>'}
              </td>
              <td>\${v.replacementDeadline ? new Date(v.replacementDeadline).toLocaleDateString() : '—'}</td>
            </tr>
          \`;
        }).join('') || '<tr><td colspan="6">No priority vacancies in this area</td></tr>';

        // 3. Trade Supply / Demand Board (Own Area, directly calling /priority/trades)
        const trades = await api('/priority/trades');
        const boardEl = document.getElementById('trade-board-container');
        boardEl.innerHTML = trades.map(t => {
          const isSurplusCandidate = t.balance === 'surplus_candidates';
          const isSurplusVacancy = t.balance === 'surplus_vacancies';
          const balanceColor = isSurplusCandidate ? 'var(--warning)' : (isSurplusVacancy ? 'var(--danger)' : 'var(--success)');
          return \`
            <div class="board-card">
              <div style="font-weight: 700; font-size: 1rem; margin-bottom: 6px;">\${t.tradeSkill}</div>
              <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px;">
                Candidates: <strong>\${t.activeCandidates}</strong> · Vacancies: <strong>\${t.openVacancies}</strong>
              </div>
              <div style="font-size: 0.8rem; font-weight: 650; color: \${balanceColor};">
                \${t.balance.replace('_', ' ').toUpperCase()}
              </div>
            </div>
          \`;
        }).join('') || '<div>No trade activity recorded</div>';

        showAlert('Priority Dashboard data refreshed live');
      } catch (e) {
        console.error('Priority dashboard fetch error:', e);
      }
    }

    // Camera Selfie Capture Handling
    async function handleSelfieCapture(e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async function() {
        const dataUrl = reader.result;
        document.getElementById('selfie-preview-img').src = dataUrl;
        document.getElementById('selfie-preview-box').style.display = 'block';

        capturedSelfieUrl = dataUrl;

        // Compute hash of captured selfie image
        const buf = await file.arrayBuffer();
        const hashBuf = await crypto.subtle.digest('SHA-256', buf);
        const hashArr = Array.from(new Uint8Array(hashBuf));
        capturedSelfieHash = 'hash_' + hashArr.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
      };
      reader.readAsDataURL(file);
    }

    // Geolocation capture
    function captureCoordinates() {
      if (!navigator.geolocation) {
        agentLat = 12.9352;
        agentLon = 77.6245;
        document.getElementById('fa-biz-gps').value = '12.9352, 77.6245 (Fallback Koramangala)';
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          agentLat = pos.coords.latitude;
          agentLon = pos.coords.longitude;
          document.getElementById('fa-biz-gps').value = agentLat.toFixed(5) + ', ' + agentLon.toFixed(5);
        },
        err => {
          agentLat = 12.9352;
          agentLon = 77.6245;
          document.getElementById('fa-biz-gps').value = '12.9352, 77.6245 (Koramangala Default)';
        }
      );
    }

    async function sendBizOtp() {
      const phone = document.getElementById('fa-biz-phone').value.trim();
      if (!phone) return alert('Phone required');
      try {
        const res = await api('/otp/send', { method: 'POST', body: { phone } });
        bizOtpRequestId = res.requestId;
        document.getElementById('fa-biz-otp-box').style.display = 'block';
        document.getElementById('fa-biz-otp-status').textContent = 'OTP sent! Req: ' + res.requestId;
        showAlert('OTP sent to ' + phone);
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function verifyBizOtp() {
      const code = document.getElementById('fa-biz-otp-code').value.trim();
      if (!bizOtpRequestId || !code) return alert('Enter OTP code');
      try {
        await api('/otp/verify', { method: 'POST', body: { requestId: bizOtpRequestId, code } });
        document.getElementById('fa-biz-otp-status').textContent = '✓ Verified';
        document.getElementById('fa-biz-otp-status').style.color = 'var(--success)';
        showAlert('OTP verified successfully!');
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function submitFieldBusiness() {
      try {
        if (!bizOtpRequestId) return alert('Business phone must pass OTP verification');
        if (!capturedSelfieHash) return alert('Camera selfie is required for in-person onboarding');

        const area = document.getElementById('fa-biz-area').value;
        const lat = agentLat || 12.9352;
        const lon = agentLon || 77.6245;

        const body = {
          name: document.getElementById('fa-biz-name').value.trim(),
          phone: document.getElementById('fa-biz-phone').value.trim(),
          address: document.getElementById('fa-biz-address').value.trim(),
          area,
          latitude: lat,
          longitude: lon,
          visitLatitude: lat,
          visitLongitude: lon,
          selfieUrl: capturedSelfieUrl || 'https://cdn.laboura.local/selfies/camera.jpg',
          selfieHash: capturedSelfieHash,
          otpRequestId: bizOtpRequestId,
        };

        const res = await api('/businesses', { method: 'POST', body });
        showAlert('Business onboarded in ' + area + ': ' + res.code);
        document.getElementById('fa-vc-biz-id').value = res.id;
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function submitFieldVacancy() {
      const bizId = document.getElementById('fa-vc-biz-id').value.trim();
      const tradeSkill = document.getElementById('fa-vc-trade').value.trim();
      const offeredSalary = Number(document.getElementById('fa-vc-salary').value) * 100;
      const headcount = Number(document.getElementById('fa-vc-headcount').value);
      const description = document.getElementById('fa-vc-desc').value.trim();

      if (!bizId || !tradeSkill || !offeredSalary) return alert('Fill required vacancy fields');
      try {
        const res = await api('/businesses/' + bizId + '/vacancies', {
          method: 'POST',
          body: { tradeSkill, offeredSalary, headcount, description }
        });
        showAlert('Vacancy captured in your area: ' + res.code);
        document.getElementById('fa-shortlist-vc-id').value = res.id;
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function loadFieldShortlist() {
      const vcId = document.getElementById('fa-shortlist-vc-id').value.trim();
      if (!vcId) return alert('Vacancy ID required');
      try {
        const data = await api('/vacancies/' + vcId + '/candidates');
        const tbody = document.getElementById('fa-shortlist-tbody');
        tbody.innerHTML = data.map(c => \`
          <tr>
            <td><strong>\${c.code}</strong></td>
            <td>\${c.name}</td>
            <td>\${c.tradeSkill}</td>
            <td>₹\${(c.minSalary/100).toLocaleString()} - ₹\${(c.maxSalary/100).toLocaleString()}</td>
            <td>\${c.hitCount} Hits</td>
            <td>
              <button class="btn-sm" onclick="arrangeInterview('\${vcId}', '\${c.id}')">Arrange Interview</button>
            </td>
          </tr>
        \`).join('') || '<tr><td colspan="6">No candidates match vacancy requirements</td></tr>';
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    function arrangeInterview(vcId, jsId) {
      document.getElementById('fa-int-vc-id').value = vcId;
      document.getElementById('fa-int-js-id').value = jsId;
      document.getElementById('fa-interview-box').style.display = 'block';
      document.getElementById('fa-interview-box').scrollIntoView({ behavior: 'smooth' });
    }

    async function submitFieldInterview() {
      const vcId = document.getElementById('fa-int-vc-id').value;
      const jsId = document.getElementById('fa-int-js-id').value;
      const salary = Number(document.getElementById('fa-int-salary').value) * 100;
      if (!salary) return alert('Agreed salary is required');
      try {
        const res = await api('/vacancies/' + vcId + '/placements', {
          method: 'POST',
          body: { jobSeekerId: jsId, agreedSalary: salary }
        });
        showAlert('Interview arranged! Placement offer created: ' + res.code);
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
