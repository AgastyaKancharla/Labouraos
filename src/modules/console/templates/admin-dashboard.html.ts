import { officeApproverHtml, officeApproverJs, officeApproverViewsHtml, staffLoginFieldsHtml, staffLoginHandlersJs } from './staff-login-ui';

export function renderAdminDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Laboura — Admin Dashboard</title>
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
      background: #334155;
      color: #cbd5e1;
    }
    .badge-ceo { background: #1e3a8a; color: #93c5fd; }
    .badge-mgr { background: #064e3b; color: #6ee7b7; }
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
    button.btn-danger { background: var(--danger); }
    button.btn-sm { padding: 4px 8px; font-size: 0.75rem; }
    button.btn-secondary { background: #475569; }
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
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
      background: #162032;
      padding: 12px;
      border-radius: 6px;
      align-items: center;
    }
    input, select {
      background: #0f172a;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.875rem;
    }
    input:focus, select:focus {
      outline: none;
      border-color: var(--primary);
    }
    .form-group { margin-bottom: 14px; }
    label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px; }
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
    .alert {
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 14px;
      font-size: 0.875rem;
    }
    .alert-danger { background: #7f1d1d; color: #fca5a5; }
    .alert-success { background: #064e3b; color: #6ee7b7; }
    .hidden { display: none !important; }
  </style>
</head>
<body>

  <!-- Auth Overlay -->
  <div id="auth-modal" class="auth-overlay hidden">
    <div class="modal">
      <h2 style="margin-bottom: 16px; font-size: 1.25rem;">Admin Login</h2>
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

  <!-- Profile & Calling Modal -->
  <div id="admin-calling-modal" class="auth-overlay hidden">
    <div class="modal" style="max-width: 650px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 id="admin-calling-title" style="font-size: 1.15rem; margin: 0; color: var(--primary);">Profile & Calling</h3>
        <button type="button" class="btn-sm" onclick="closeAdminCallingModal()">✕ Close</button>
      </div>

      <!-- Profile details -->
      <div style="background: #0f172a; padding: 12px; border-radius: 6px; margin-bottom: 12px; border: 1px solid var(--card-border);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong id="admin-profile-name" style="font-size: 1.05rem;">—</strong>
          <span id="admin-profile-code" class="badge">—</span>
        </div>
        <div style="font-size: 0.9rem; color: #94a3b8;">
          Phone: <strong id="admin-profile-phone" style="color: var(--text);">—</strong>
          <span style="margin: 0 6px;">•</span>
          Status: <span id="admin-profile-status">—</span>
        </div>

        <!-- Blocked calling alert notice -->
        <div id="admin-call-blocked-alert" style="display: none; background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); color: #fca5a5; padding: 8px 12px; border-radius: 4px; font-size: 0.85rem; margin-top: 8px;">
        </div>

        <!-- Call controls -->
        <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
          <select id="admin-call-purpose" style="max-width: 180px;">
            <option value="general">General</option>
            <option value="offer">Offer</option>
            <option value="follow_up">Follow Up</option>
            <option value="verification">Verification</option>
            <option value="exit_call">Exit Call</option>
            <option value="check_in">Check In</option>
            <option value="interview_result">Interview Result</option>
            <option value="refund_check">Refund Check</option>
          </select>
          <button type="button" id="btn-admin-call" class="btn-call" onclick="triggerAdminCall()">Call</button>
        </div>

        <!-- Active Call / Outcome Card -->
        <div id="admin-call-progress-section" style="display: none; margin-top: 14px; padding: 12px; background: #1e293b; border-radius: 6px;">
          <div id="admin-call-status-msg" style="font-size: 0.9rem; font-weight: 500; margin-bottom: 8px;">Call placed...</div>
          
          <!-- Answered Call Outcome Form (Closed List) -->
          <div id="admin-answered-outcome-form" style="display: none;">
            <label style="font-size: 0.85rem; color: var(--primary); font-weight: bold; margin-bottom: 4px; display: block;">Record Call Outcome</label>
            <select id="admin-call-outcome" style="margin-bottom: 8px;">
              <option value="interested">Interested</option>
              <option value="accepted_offer">Accepted Offer</option>
              <option value="rejected_offer">Rejected Offer</option>
              <option value="callback_requested">Callback Requested</option>
              <option value="not_interested">Not Interested</option>
              <option value="working_now">Working Now</option>
              <option value="other">Other</option>
            </select>
            <input type="text" id="admin-call-outcome-reason" placeholder="Outcome reason (optional)" style="margin-bottom: 8px;">
            <button type="button" class="btn-sm" onclick="submitAdminOutcome()">Submit Outcome</button>
          </div>
        </div>
      </div>

      <!-- History -->
      <div>
        <h4 style="font-size: 0.9rem; color: #94a3b8; margin-bottom: 8px;">Call & Message History</h4>
        <div class="table-container" style="max-height: 200px; overflow-y: auto;">
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
            <tbody id="admin-history-tbody">
              <tr><td colspan="7">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <header>
    <div>
      <h1>Laboura Admin Dashboard</h1>
      <span style="font-size: 0.75rem; color: var(--text-muted);">Bengaluru Staffing System of Record</span>
    </div>
    <div class="user-info">
      <span id="user-display" style="font-size: 0.875rem;">Not logged in</span>
      <span id="user-role-badge" class="badge">Guest</span>
      <button id="btn-logout" class="btn-sm btn-secondary">Log Out</button>
    </div>
  </header>

  <nav class="nav-tabs">
    <button class="tab-btn active" data-tab="job-seekers">Job Seekers</button>
    <button class="tab-btn" data-tab="referrals">Referrals</button>
    <button class="tab-btn" data-tab="businesses">Businesses</button>
    <button class="tab-btn hidden" id="tab-business-reviews" data-tab="business-reviews">Business Reviews</button>
    <button class="tab-btn" data-tab="vacancies">Vacancies</button>
    <button class="tab-btn" data-tab="placements">Placements</button>
    <button class="tab-btn" data-tab="payments">Payment Ledger</button>
    <button class="tab-btn" data-tab="refunds">Refund Approvals</button>
    <!-- CEO-only Pricing Tab; Manager tokens cannot see this per AGENTS.md §7 and specs/phase-6.md Task 4 -->
    <button class="tab-btn hidden" id="tab-pricing" data-tab="pricing">Pricing & Policy (CEO)</button>
    <a href="/map" class="map-nav-link" style="align-self:center;color:var(--text-muted);padding:10px 12px;font-weight:600;white-space:nowrap">Map</a>
    ${officeApproverHtml()}
  </nav>

  <main>
    <div id="status-alert" class="alert hidden"></div>

    <!-- Job Seekers View -->
    <div id="view-job-seekers" class="tab-view">
      <div class="card">
        <div class="card-title">
          <span>Job Seekers Candidate Pool</span>
          <button class="btn-sm" onclick="loadJobSeekers()">Refresh</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Trade</th>
                <th>Salary Range (Paise)</th>
                <th>Status</th>
                <th>Hits</th>
                <th>KYC</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="job-seekers-tbody">
              <tr><td colspan="9" style="text-align: center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Referrals View -->
    <div id="view-referrals" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Referral Partners</span>
          <button class="btn-sm" onclick="loadReferrals()">Refresh</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Type</th>
                <th>Phone Verified</th>
                <th>City</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="referrals-tbody">
              <tr><td colspan="7" style="text-align: center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Businesses View -->
    <div id="view-businesses" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Businesses</span>
          <button class="btn-sm" onclick="loadBusinesses()">Refresh</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Area</th>
                <th>Selfie Verified</th>
                <th>Geofence Flag</th>
                <th>Actions</th>
                <th id="business-introductions-header" hidden>Introductions</th>
              </tr>
            </thead>
            <tbody id="businesses-tbody">
              <tr><td colspan="8" style="text-align: center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
        <div id="business-introduction-panel" class="card" hidden>
          <div class="card-title"><span id="business-introduction-title">Candidate introductions</span><button class="btn-sm" onclick="document.getElementById('business-introduction-panel').hidden = true">Close</button></div>
          <div id="business-introduction-list" aria-live="polite"></div>
        </div>
      </div>
    </div>

    <div id="view-business-reviews" class="tab-view hidden">
      <div class="card">
        <div class="card-title"><span>Business leads ready for verification</span></div>
        <div id="business-lead-queue">Loading businesses…</div>
      </div>
      <div class="card">
        <div class="card-title"><span>Pending verification visit assignments</span><button class="btn-sm" onclick="loadBusinessReviewQueue()">Refresh</button></div>
        <div id="business-visit-assignment-queue">Loading assignments…</div>
      </div>
      <div class="card">
        <div class="card-title"><span>Businesses waiting for approval</span></div>
        <div id="business-approval-queue">Loading businesses…</div>
      </div>
    </div>

    <!-- Vacancies View -->
    <div id="view-vacancies" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Vacancies</span>
          <button class="btn-sm" onclick="loadVacancies()">Refresh</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Business</th>
                <th>Trade</th>
                <th>Offered Salary</th>
                <th>Status</th>
                <th>Replacement For</th>
              </tr>
            </thead>
            <tbody id="vacancies-tbody">
              <tr><td colspan="6" style="text-align: center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Placements View -->
    <div id="view-placements" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Placements</span>
          <button class="btn-sm" onclick="loadPlacements()">Refresh</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Candidate</th>
                <th>Business</th>
                <th>Agreed Salary</th>
                <th>Fee</th>
                <th>GST</th>
                <th>Status</th>
                <th>Joined Date</th>
              </tr>
            </thead>
            <tbody id="placements-tbody">
              <tr><td colspan="8" style="text-align: center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Payment Ledger View -->
    <div id="view-payments" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Finance Payment Ledger</span>
          <button class="btn-sm" onclick="loadPayments()">Refresh</button>
        </div>
        <div class="filter-bar">
          <div>
            <label>Type</label>
            <select id="filter-payment-type">
              <option value="">All Types</option>
              <option value="activation">Activation</option>
              <option value="placement_fee">Placement Fee</option>
              <option value="referral_payout">Referral Payout</option>
              <option value="refund">Refund</option>
            </select>
          </div>
          <div>
            <label>Status</label>
            <select id="filter-payment-status">
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div>
            <label>From Date</label>
            <input type="date" id="filter-payment-from">
          </div>
          <div>
            <label>To Date</label>
            <input type="date" id="filter-payment-to">
          </div>
          <div style="align-self: flex-end;">
            <button onclick="loadPayments()">Apply Filters</button>
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Payment Code</th>
                <th>Type</th>
                <th>Amount (Paise)</th>
                <th>Status</th>
                <th>Subject</th>
                <th>Gateway Ref</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="payments-tbody">
              <tr><td colspan="8" style="text-align: center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Refund Approvals View -->
    <div id="view-refunds" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>Refund Actions (CEO / Management)</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
          <!-- Placement Refund Approval -->
          <div style="background: #162032; padding: 16px; border-radius: 6px;">
            <h3 style="font-size: 1rem; margin-bottom: 12px; color: var(--primary);">Approve Business Placement Refund</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">Calls Phase 5 Task 7 flat 100% refund logic from day 15 onward.</p>
            <div class="form-group">
              <label>Placement ID</label>
              <input type="text" id="refund-placement-id" style="width: 100%;" placeholder="uuid or placement id">
            </div>
            <div class="form-group">
              <label>Reason / Note</label>
              <input type="text" id="refund-placement-reason" style="width: 100%;" placeholder="Replacement search window exceeded">
            </div>
            <button onclick="submitPlacementRefund()">Approve Business Refund</button>
          </div>

          <!-- Job Seeker Refund Approval -->
          <div style="background: #162032; padding: 16px; border-radius: 6px;">
            <h3 style="font-size: 1rem; margin-bottom: 12px; color: var(--primary);">Approve Job Seeker 30-Day Guarantee Refund</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">Calls Phase 5 Task 8 ₹499 guarantee refund logic.</p>
            <div class="form-group">
              <label>Job Seeker ID</label>
              <input type="text" id="refund-seeker-id" style="width: 100%;" placeholder="uuid or job seeker id">
            </div>
            <div class="form-group">
              <label>Reason / Note</label>
              <input type="text" id="refund-seeker-reason" style="width: 100%;" placeholder="30 days elapsed with no suitable offer">
            </div>
            <button onclick="submitSeekerRefund()">Approve Job Seeker Refund</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Pricing & Policy Controls View (CEO Only) -->
    <div id="view-pricing" class="tab-view hidden">
      <div id="pricing-controls" class="card">
        <div class="card-title">
          <span>Pricing & Policy Controls (CEO Sole Write Access)</span>
          <button class="btn-sm" onclick="loadPricing()">Refresh</button>
        </div>
        <div style="max-width: 600px;">
          <div class="form-group">
            <label>Activation Fee (Paise)</label>
            <input type="number" id="policy-activation-fee" style="width: 100%;">
          </div>
          <div class="form-group">
            <label>Placement Fee (% of 1st month salary)</label>
            <input type="number" id="policy-placement-fee" style="width: 100%;">
          </div>
          <div class="form-group">
            <label>GST Percentage</label>
            <input type="number" id="policy-gst" style="width: 100%;">
          </div>
          <div class="form-group">
            <label>Referral Payout (Paise)</label>
            <input type="number" id="policy-referral-payout" style="width: 100%;">
          </div>
          <div class="form-group">
            <label>Replacement Window Days — 60 days</label>
            <input type="number" id="policy-replacement-window" style="width: 100%;">
          </div>
          <div class="form-group">
            <label>Replacement Search Window Before Refund — 15 days</label>
            <input type="number" id="policy-replacement-search" style="width: 100%;">
          </div>
          <div class="form-group">
            <label>Candidate Refund Guarantee Window — 30 days</label>
            <input type="number" id="policy-candidate-guarantee" style="width: 100%;">
          </div>
          <button id="btn-save-pricing" onclick="savePricing()">Update Pricing Policy</button>
        </div>
      </div>
    </div>

    ${officeApproverViewsHtml()}

  </main>

  <script>
    let token = sessionStorage.getItem('laboura_token') || '';
    let currentUser = null;

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
      currentUser = null;
      document.getElementById('user-display').textContent = 'Not logged in';
      document.getElementById('user-role-badge').textContent = 'Guest';
      document.getElementById('tab-pricing').classList.add('hidden');
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
      currentUser = payload;
      document.getElementById('user-display').textContent = payload.code || payload.email;
      const badge = document.getElementById('user-role-badge');
      badge.textContent = payload.role.toUpperCase();
      badge.className = 'badge ' + (payload.role === 'ceo' ? 'badge-ceo' : 'badge-mgr');

      // Enforce UI RBAC rule: A manager token CANNOT see pricing controls in the UI
      const pricingTab = document.getElementById('tab-pricing');
      if (payload.role === 'ceo') {
        pricingTab.classList.remove('hidden');
      } else {
        pricingTab.classList.add('hidden');
        if (currentTab === 'pricing') {
          switchTab('job-seekers');
        }
      }
      const reviewTab = document.getElementById('tab-business-reviews');
      if (['team_lead', 'manager', 'ceo'].includes(payload.role)) reviewTab.classList.remove('hidden');
      else reviewTab.classList.add('hidden');

      labouraShowApproverTabs();
      if (labouraIsApprover()) {
        loadLoginCodes().catch(function () {});
      }
      loadJobSeekers();
    }

    // Tabs navigation
    let currentTab = 'job-seekers';
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
      });
    });

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const activeBtn = document.querySelector('.tab-btn[data-tab="' + tab + '"]');
      if (activeBtn) activeBtn.classList.add('active');

      document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
      const targetView = document.getElementById('view-' + tab);
      if (targetView) targetView.classList.remove('hidden');

      if (tab === 'job-seekers') loadJobSeekers();
      else if (tab === 'referrals') loadReferrals();
      else if (tab === 'businesses') loadBusinesses();
      else if (tab === 'business-reviews') loadBusinessReviewQueue();
      else if (tab === 'vacancies') loadVacancies();
      else if (tab === 'placements') loadPlacements();
      else if (tab === 'payments') loadPayments();
      else if (tab === 'pricing') loadPricing();
      else if (tab === 'login-codes') loadLoginCodes().catch(function (e) { showAlert(e.message, false); });
      else if (tab === 'devices') loadDevices().catch(function (e) { showAlert(e.message, false); });
      else if (tab === 'staff') loadStaffList().catch(function (e) { showAlert(e.message, false); });
      else if (tab === 'login-report') loadLoginReport().catch(function (e) { showAlert(e.message, false); });
    }

    function formatPhoneLast4(val) {
      if (!val) return '—';
      const digits = String(val).replace(/[^0-9]/g, '');
      return digits.length >= 4 ? '••••••' + digits.slice(-4) : '••••••';
    }

    async function loadJobSeekers() {
      try {
        const data = await api('/job-seekers');
        const tbody = document.getElementById('job-seekers-tbody');
        tbody.innerHTML = data.map(j => \`
          <tr>
            <td><strong>\${j.code}</strong></td>
            <td>\${j.name}</td>
            <td>\${formatPhoneLast4(j.phone)}</td>
            <td>\${j.trades?.length ? j.trades.find(t => t.isPrimary)?.trade : j.tradeSkill}</td>
            <td>₹\${(j.minSalary/100).toLocaleString('en-IN')} - ₹\${(j.maxSalary/100).toLocaleString('en-IN')}</td>
            <td><span class="badge">\${j.status}</span></td>
            <td>\${j.hitCount}</td>
            <td>\${j.identityVerifications?.[0]?.status ?? j.kycStatus}</td>
            <td><button class="btn-sm btn-call" onclick="openAdminCalling('job_seeker', '\${j.id}', '\${j.code}')">Call</button></td>
          </tr>
        \`).join('') || '<tr><td colspan="9">No candidates found</td></tr>';
      } catch (e) {
        console.error(e);
      }
    }

    async function loadReferrals() {
      try {
        const data = await api('/referrals');
        const tbody = document.getElementById('referrals-tbody');
        tbody.innerHTML = data.map(r => \`
          <tr>
            <td><strong>\${r.code}</strong></td>
            <td>\${r.name}</td>
            <td>\${formatPhoneLast4(r.phone)}</td>
            <td>\${r.type}</td>
            <td>\${r.phoneVerified ? 'Yes' : 'No'}</td>
            <td>\${r.city}</td>
            <td><button class="btn-sm btn-call" onclick="openAdminCalling('referral', '\${r.id}', '\${r.code}')">Call</button></td>
          </tr>
        \`).join('') || '<tr><td colspan="7">No referral partners found</td></tr>';
      } catch (e) {
        console.error(e);
      }
    }

    async function loadBusinesses() {
      try {
        const data = await api('/businesses');
        const tbody = document.getElementById('businesses-tbody');
        const canViewIntroductions = ['team_lead', 'manager', 'ceo'].includes(currentUser?.role);
        const introHeader = document.getElementById('business-introductions-header');
        introHeader.hidden = !canViewIntroductions;
        tbody.innerHTML = data.map(b => \`
          <tr>
            <td><strong>\${b.code}</strong></td>
            <td>\${b.name}</td>
            <td>\${formatPhoneLast4(b.phone)}</td>
            <td>\${b.locality || ''}</td>
            <td>\${b.selfieUrl ? 'Yes' : 'Pending'}</td>
            <td>\${b.geofenceFlag ? 'FLAGGED' : 'Clean'}</td>
            <td><button class="btn-sm btn-call" onclick="openAdminCalling('business', '\${b.id}', '\${b.code}')">Call</button></td>
            \${canViewIntroductions ? '<td><button class="btn-sm business-intro-button" data-business-id="' + b.id + '" data-business-code="' + b.code + '">Introductions</button></td>' : ''}
          </tr>
        \`).join('') || '<tr><td colspan="' + (canViewIntroductions ? 8 : 7) + '">No businesses found</td></tr>';
        tbody.querySelectorAll('.business-intro-button').forEach(button => button.addEventListener('click', () => loadBusinessIntroductions(button.dataset.businessId, button.dataset.businessCode)));
      } catch (e) {
        console.error(e);
      }
    }

    async function loadBusinessIntroductions(id, code) {
      if (!['team_lead', 'manager', 'ceo'].includes(currentUser?.role)) return;
      const panel = document.getElementById('business-introduction-panel');
      const list = document.getElementById('business-introduction-list');
      document.getElementById('business-introduction-title').textContent = 'Candidate introductions · ' + code;
      list.textContent = 'Loading introductions…';
      panel.hidden = false;
      try {
        const data = await api('/businesses/' + encodeURIComponent(id) + '/introductions');
        list.replaceChildren();
        if (!data.introductions.length) { list.textContent = 'No candidates have been shown to this business.'; return; }
        data.introductions.forEach(introduction => {
          const row = document.createElement('p');
          row.textContent = introduction.candidateFirstName + ' · ' + introduction.trade + ' · ' + introduction.vacancyCode + ' · shown ' + new Date(introduction.shownAt).toLocaleString() + ' by ' + introduction.shownByName + ' (' + introduction.channel + ')';
          list.appendChild(row);
        });
      } catch (e) { list.textContent = e.message || 'Could not load introductions.'; }
    }

    async function loadBusinessReviewQueue() {
      const assignmentTarget = document.getElementById('business-visit-assignment-queue');
      const approvalTarget = document.getElementById('business-approval-queue');
      assignmentTarget.textContent = 'Loading assignments…';
      approvalTarget.textContent = 'Loading businesses…';
      try {
        const [assignments, businesses, staff] = await Promise.all([
          api('/businesses/visit-assignments'),
          api('/businesses'),
          api('/staff?role=field_agent&status=active')
        ]);
        assignmentTarget.replaceChildren();
        const leadsTarget = document.getElementById('business-lead-queue');
        leadsTarget.replaceChildren();
        const leads = businesses.filter(b => b.verificationStatus === 'lead');
        if (!leads.length) leadsTarget.textContent = 'No business leads waiting for a verification visit.';
        leads.forEach(business => {
          const row = document.createElement('div'); row.className = 'board-card';
          const summary = document.createElement('p');
          summary.textContent = business.code + ' · ' + business.name + ' · ' + (business.locality || '') + ' · ' + (business.documentsStatus === 'no_documents' ? 'NO DOCUMENTS' : 'Documented');
          const assign = document.createElement('button'); assign.textContent = 'Assign verification visit';
          assign.addEventListener('click', async () => {
            try { await api('/businesses/' + business.id + '/visit-assignments', { method: 'POST', body: { purpose: 'verification' } }); showAlert('Verification visit created.'); await loadBusinessReviewQueue(); }
            catch (e) { showAlert(e.message, false); }
          });
          row.append(summary, assign); leadsTarget.appendChild(row);
        });
        const pending = assignments.filter(a => a.status === 'pending');
        if (!pending.length) assignmentTarget.textContent = 'No pending visit assignments.';
        pending.forEach(assignment => {
          const row = document.createElement('div'); row.className = 'board-card';
          const summary = document.createElement('p');
          summary.textContent = assignment.business.code + ' · ' + assignment.business.name + ' · ' + (assignment.business.locality || '') + (assignment.business.documentsStatus === 'no_documents' ? ' · NO DOCUMENTS — closer check required' : '') + ' · Suggested: ' + (assignment.suggestedStaff ? assignment.suggestedStaff.name + ' (' + assignment.suggestedStaff.code + ')' : 'none checked in');
          const select = document.createElement('select');
          staff.forEach(agent => { const option = document.createElement('option'); option.value = agent.id; option.textContent = agent.name + ' (' + agent.code + ')'; if (agent.id === assignment.suggestedStaffId) option.selected = true; select.appendChild(option); });
          const confirm = document.createElement('button'); confirm.textContent = 'Confirm or change agent';
          confirm.addEventListener('click', async () => {
            try { await api('/businesses/' + assignment.businessId + '/visit-assignments/' + assignment.id + '/assign', { method: 'POST', body: { assignedStaffId: select.value } }); showAlert('Visit assigned.'); await loadBusinessReviewQueue(); }
            catch (e) { showAlert(e.message, false); }
          });
          row.append(summary, select, confirm); assignmentTarget.appendChild(row);
        });

        approvalTarget.replaceChildren();
        const waiting = businesses.filter(b => b.verificationStatus === 'pending_tl_check');
        if (!waiting.length) approvalTarget.textContent = 'No businesses waiting for approval.';
        waiting.forEach(business => {
          const row = document.createElement('div'); row.className = 'board-card';
          const summary = document.createElement('p');
          summary.textContent = business.code + ' · ' + business.name + ' · ' + (business.documentsStatus === 'no_documents' ? 'NO DOCUMENTS — owner verification call required' : 'Documented') + ' · ' + business.verificationStatus;
          const select = document.createElement('select');
          const defaultOption = document.createElement('option'); defaultOption.value = ''; defaultOption.textContent = 'Use visiting agent as account agent'; select.appendChild(defaultOption);
          staff.forEach(agent => { const option = document.createElement('option'); option.value = agent.id; option.textContent = agent.name + ' (' + agent.code + ')'; select.appendChild(option); });
          const approve = document.createElement('button'); approve.textContent = 'Approve verification';
          approve.addEventListener('click', async () => {
            try { await api('/businesses/' + business.id + '/verification/approve', { method: 'POST', body: select.value ? { accountAgentId: select.value } : {} }); showAlert('Business verified.'); await loadBusinessReviewQueue(); }
            catch (e) { showAlert(e.message, false); }
          });
          row.append(summary, select, approve); approvalTarget.appendChild(row);
        });
      } catch (e) { assignmentTarget.textContent = e.message; approvalTarget.textContent = e.message; }
    }

    // Admin Calling & Recording Management
    let adminCallingSubject = null;
    let adminActiveCallRecordId = null;

    async function openAdminCalling(subjectType, id, code) {
      document.getElementById('admin-call-blocked-alert').style.display = 'none';
      document.getElementById('admin-call-progress-section').style.display = 'none';
      document.getElementById('admin-answered-outcome-form').style.display = 'none';
      document.getElementById('admin-calling-modal').classList.remove('hidden');

      try {
        let endpoint = '/job-seekers/' + encodeURIComponent(id);
        if (subjectType === 'business') endpoint = '/businesses/' + encodeURIComponent(id);
        if (subjectType === 'referral') endpoint = '/referrals/' + encodeURIComponent(id);

        const data = await api(endpoint);
        adminCallingSubject = { type: subjectType, id: data.id || id, code: data.code || code, data: data };

        document.getElementById('admin-profile-name').textContent = data.name || data.contactName || '—';
        document.getElementById('admin-profile-code').textContent = data.code || code;
        document.getElementById('admin-profile-phone').textContent = formatPhoneLast4(data.phone);
        document.getElementById('admin-profile-status').textContent = data.status || 'Active';

        await loadAdminHistory(subjectType, data.id || id);
      } catch (e) {
        showAlert('Could not load profile: ' + e.message, false);
      }
    }

    function closeAdminCallingModal() {
      document.getElementById('admin-calling-modal').classList.add('hidden');
    }

    async function triggerAdminCall() {
      if (!adminCallingSubject) return alert('No profile loaded');
      const btn = document.getElementById('btn-admin-call');
      btn.disabled = true;
      document.getElementById('admin-call-blocked-alert').style.display = 'none';
      document.getElementById('admin-answered-outcome-form').style.display = 'none';

      const purpose = document.getElementById('admin-call-purpose').value;
      try {
        const res = await api('/calls', {
          method: 'POST',
          body: {
            subjectType: adminCallingSubject.type,
            subjectId: adminCallingSubject.id,
            purpose: purpose,
          }
        });
        adminActiveCallRecordId = res.callRecordId || res.id;
        document.getElementById('admin-call-progress-section').style.display = 'block';

        let callData = null;
        try {
          callData = await api('/calls/' + adminActiveCallRecordId);
        } catch {}

        if (callData && callData.answered) {
          document.getElementById('admin-call-status-msg').textContent = 'Call answered (' + (callData.code || adminActiveCallRecordId) + '). Record outcome:';
          document.getElementById('admin-answered-outcome-form').style.display = 'block';
        } else {
          document.getElementById('admin-call-status-msg').textContent = 'Call placed: ' + (callData ? (callData.answered ? 'answered' : 'unanswered (' + callData.providerStatus + ')') : 'initiated') + '.';
          document.getElementById('admin-answered-outcome-form').style.display = callData && callData.answered ? 'block' : 'none';
        }
        showAlert('Call placed: ' + (callData ? callData.code : adminActiveCallRecordId));
        await loadAdminHistory(adminCallingSubject.type, adminCallingSubject.id);
      } catch (e) {
        const msg = e.message || 'Calling is currently blocked';
        document.getElementById('admin-call-blocked-alert').textContent = 'Calling blocked: ' + msg;
        document.getElementById('admin-call-blocked-alert').style.display = 'block';
        showAlert('Calling blocked: ' + msg, false);
      } finally {
        btn.disabled = false;
      }
    }

    async function submitAdminOutcome() {
      if (!adminActiveCallRecordId) return alert('No active answered call');
      const outcome = document.getElementById('admin-call-outcome').value;
      const reason = document.getElementById('admin-call-outcome-reason').value.trim();
      try {
        await api('/calls/' + adminActiveCallRecordId + '/outcome', {
          method: 'POST',
          body: { agentOutcome: outcome, reason: reason || undefined }
        });
        showAlert('Outcome recorded: ' + outcome);
        document.getElementById('admin-answered-outcome-form').style.display = 'none';
        document.getElementById('admin-call-status-msg').textContent = 'Outcome recorded: ' + outcome;
        if (adminCallingSubject) {
          await loadAdminHistory(adminCallingSubject.type, adminCallingSubject.id);
        }
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function loadAdminHistory(subjectType, subjectId) {
      const tbody = document.getElementById('admin-history-tbody');
      tbody.innerHTML = '<tr><td colspan="7">Loading history...</td></tr>';
      try {
        const calls = await api('/calls?subjectType=' + subjectType + '&subjectId=' + encodeURIComponent(subjectId));
        let messages = [];
        try {
          messages = await api('/messages?subjectType=' + subjectType + '&subjectId=' + encodeURIComponent(subjectId));
        } catch {}

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

        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7">No history found</td></tr>';
          return;
        }

        tbody.innerHTML = items.map(function (it) {
          const listenBtn = it.recording
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

    async function loadVacancies() {
      try {
        const data = await api('/vacancies');
        const tbody = document.getElementById('vacancies-tbody');
        tbody.innerHTML = data.map(v => \`
          <tr>
            <td><strong>\${v.code}</strong></td>
            <td>\${v.business ? v.business.name : v.businessId}</td>
            <td>\${v.tradeSkill}</td>
            <td>₹\${(v.salaryMinPaise/100).toLocaleString('en-IN')}</td>
            <td><span class="badge">\${v.status}</span></td>
            <td>\${v.replacementForPlacementId ? 'Replacement' : 'Fresh'}</td>
          </tr>
        \`).join('') || '<tr><td colspan="6">No vacancies found</td></tr>';
      } catch (e) {
        console.error(e);
      }
    }

    async function loadPlacements() {
      try {
        const data = await api('/placements');
        const tbody = document.getElementById('placements-tbody');
        tbody.innerHTML = data.map(p => \`
          <tr>
            <td><strong>\${p.code}</strong></td>
            <td>\${p.jobSeeker ? p.jobSeeker.name : p.jobSeekerId}</td>
            <td>\${p.business ? p.business.name : p.businessId}</td>
            <td>₹\${(p.agreedSalary/100).toLocaleString('en-IN')}</td>
            <td>₹\${(p.placementFee/100).toLocaleString('en-IN')}</td>
            <td>₹\${(p.gstAmount/100).toLocaleString('en-IN')}</td>
            <td><span class="badge">\${p.status}</span></td>
            <td>\${p.joinedDate ? new Date(p.joinedDate).toLocaleDateString() : '—'}</td>
          </tr>
        \`).join('') || '<tr><td colspan="8">No placements found</td></tr>';
      } catch (e) {
        console.error(e);
      }
    }

    async function loadPayments() {
      try {
        const type = document.getElementById('filter-payment-type').value;
        const status = document.getElementById('filter-payment-status').value;
        const from = document.getElementById('filter-payment-from').value;
        const to = document.getElementById('filter-payment-to').value;

        const params = new URLSearchParams();
        if (type) params.append('type', type);
        if (status) params.append('status', status);
        if (from) params.append('fromDate', from);
        if (to) params.append('toDate', to);

        const data = await api('/payments?' + params.toString());
        const tbody = document.getElementById('payments-tbody');
        tbody.innerHTML = data.map(p => \`
          <tr>
            <td><strong>\${p.code}</strong></td>
            <td>\${p.type}</td>
            <td>₹\${(p.amount/100).toLocaleString('en-IN')} (\${p.amount} paise)</td>
            <td><span class="badge">\${p.status}</span></td>
            <td>\${p.subjectType}: \${p.subjectId}</td>
            <td><small>\${p.gatewayReference || '—'}</small></td>
            <td>\${new Date(p.createdAt).toLocaleString()}</td>
            <td>
              \${p.status === 'pending' && p.type === 'referral_payout' ? \`
                <button class="btn-sm" onclick="disbursePayment('\${p.id}')">Disburse Payout</button>
              \` : '—'}
            </td>
          </tr>
        \`).join('') || '<tr><td colspan="8">No payments match filters</td></tr>';
      } catch (e) {
        console.error(e);
      }
    }

    async function disbursePayment(id) {
      try {
        const res = await api('/payments/' + id + '/disburse', { method: 'POST', body: {} });
        showAlert('Payout disbursed successfully! Payment status: ' + res.status);
        loadPayments();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function submitPlacementRefund() {
      const id = document.getElementById('refund-placement-id').value.trim();
      const reason = document.getElementById('refund-placement-reason').value.trim();
      if (!id) return alert('Placement ID is required');
      try {
        const res = await api('/placements/' + id + '/refund', {
          method: 'POST',
          body: { reason: reason || 'Business refund approved by admin' }
        });
        showAlert('Placement refund approved! Refund amount: ₹' + (res.refundAmount/100));
        loadPayments();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function submitSeekerRefund() {
      const id = document.getElementById('refund-seeker-id').value.trim();
      const reason = document.getElementById('refund-seeker-reason').value.trim();
      if (!id) return alert('Job Seeker ID is required');
      try {
        const res = await api('/job-seekers/' + id + '/refund', {
          method: 'POST',
          body: { reason: reason || 'Job seeker 30-day guarantee refund approved' }
        });
        showAlert('Job seeker refund approved!');
        loadPayments();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function loadPricing() {
      try {
        const p = await api('/pricing');
        document.getElementById('policy-activation-fee').value = p.activationFeePaise;
        document.getElementById('policy-placement-fee').value = p.placementFeePercent;
        document.getElementById('policy-gst').value = p.gstPercent;
        document.getElementById('policy-referral-payout').value = p.referralPayoutPaise;
        document.getElementById('policy-replacement-window').value = p.replacementWindowDays;
        document.getElementById('policy-replacement-search').value = p.replacementSearchDays;
        document.getElementById('policy-candidate-guarantee').value = p.jobSeekerGuaranteeDays;
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function savePricing() {
      try {
        const body = {
          activationFeePaise: Number(document.getElementById('policy-activation-fee').value),
          placementFeePercent: Number(document.getElementById('policy-placement-fee').value),
          gstPercent: Number(document.getElementById('policy-gst').value),
          referralPayoutPaise: Number(document.getElementById('policy-referral-payout').value),
          replacementWindowDays: Number(document.getElementById('policy-replacement-window').value),
          replacementSearchDays: Number(document.getElementById('policy-replacement-search').value),
          jobSeekerGuaranteeDays: Number(document.getElementById('policy-candidate-guarantee').value),
        };
        const updated = await api('/pricing', { method: 'PUT', body });
        showAlert('Pricing policy successfully updated by CEO!');
        loadPricing();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    ${officeApproverJs()}

    // Run on startup
    window.addEventListener('DOMContentLoaded', () => {
      initUser();
    });
  </script>
</body>
</html>`;
}
