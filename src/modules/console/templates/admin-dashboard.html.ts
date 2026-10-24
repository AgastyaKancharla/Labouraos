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
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="login-email" style="width: 100%;" placeholder="ceo@laboura.local">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="login-password" style="width: 100%;" placeholder="••••••••">
      </div>
      <button id="btn-login" style="width: 100%; margin-top: 8px;">Log In</button>
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
    <button class="tab-btn" data-tab="vacancies">Vacancies</button>
    <button class="tab-btn" data-tab="placements">Placements</button>
    <button class="tab-btn" data-tab="payments">Payment Ledger</button>
    <button class="tab-btn" data-tab="refunds">Refund Approvals</button>
    <!-- CEO-only Pricing Tab; Manager tokens cannot see this per AGENTS.md §7 and specs/phase-6.md Task 4 -->
    <button class="tab-btn hidden" id="tab-pricing" data-tab="pricing">Pricing & Policy (CEO)</button>
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
              </tr>
            </thead>
            <tbody id="job-seekers-tbody">
              <tr><td colspan="8" style="text-align: center;">Loading...</td></tr>
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
              </tr>
            </thead>
            <tbody id="referrals-tbody">
              <tr><td colspan="6" style="text-align: center;">Loading...</td></tr>
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
              </tr>
            </thead>
            <tbody id="businesses-tbody">
              <tr><td colspan="6" style="text-align: center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
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
            <label>Activation Fee (Paise) — ₹499 = 49900</label>
            <input type="number" id="policy-activation-fee" style="width: 100%;">
          </div>
          <div class="form-group">
            <label>Placement Fee (% of 1st month salary) — 50%</label>
            <input type="number" id="policy-placement-fee" style="width: 100%;">
          </div>
          <div class="form-group">
            <label>GST Percentage — 18%</label>
            <input type="number" id="policy-gst" style="width: 100%;">
          </div>
          <div class="form-group">
            <label>Referral Payout (Paise) — flat ₹200 = 20000</label>
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

    function showLoginModal() {
      document.getElementById('auth-modal').classList.remove('hidden');
    }

    function hideLoginModal() {
      document.getElementById('auth-modal').classList.add('hidden');
    }

    document.getElementById('btn-login').addEventListener('click', async () => {
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      try {
        errEl.classList.add('hidden');
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Login failed' }));
          throw new Error(err.message || 'Invalid credentials');
        }
        const data = await res.json();
        token = data.accessToken;
        sessionStorage.setItem('laboura_token', token);
        hideLoginModal();
        await initUser();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('hidden');
      }
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
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
      document.getElementById('user-display').textContent = payload.email;
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
      else if (tab === 'vacancies') loadVacancies();
      else if (tab === 'placements') loadPlacements();
      else if (tab === 'payments') loadPayments();
      else if (tab === 'pricing') loadPricing();
    }

    async function loadJobSeekers() {
      try {
        const data = await api('/job-seekers');
        const tbody = document.getElementById('job-seekers-tbody');
        tbody.innerHTML = data.map(j => \`
          <tr>
            <td><strong>\${j.code}</strong></td>
            <td>\${j.name}</td>
            <td>\${j.phone || '—'}</td>
            <td>\${j.tradeSkill}</td>
            <td>₹\${(j.minSalary/100).toLocaleString('en-IN')} - ₹\${(j.maxSalary/100).toLocaleString('en-IN')}</td>
            <td><span class="badge">\${j.status}</span></td>
            <td>\${j.hitCount}</td>
            <td>\${j.kycStatus}</td>
          </tr>
        \`).join('') || '<tr><td colspan="8">No candidates found</td></tr>';
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
            <td>\${r.phone || '—'}</td>
            <td>\${r.type}</td>
            <td>\${r.phoneVerified ? 'Yes' : 'No'}</td>
            <td>\${r.city}</td>
          </tr>
        \`).join('') || '<tr><td colspan="6">No referral partners found</td></tr>';
      } catch (e) {
        console.error(e);
      }
    }

    async function loadBusinesses() {
      try {
        const data = await api('/businesses');
        const tbody = document.getElementById('businesses-tbody');
        tbody.innerHTML = data.map(b => \`
          <tr>
            <td><strong>\${b.code}</strong></td>
            <td>\${b.name}</td>
            <td>\${b.phone || '—'}</td>
            <td>\${b.area}</td>
            <td>\${b.selfieUrl ? 'Yes' : 'Pending'}</td>
            <td>\${b.geofenceFlag ? 'FLAGGED' : 'Clean'}</td>
          </tr>
        \`).join('') || '<tr><td colspan="6">No businesses found</td></tr>';
      } catch (e) {
        console.error(e);
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
            <td>₹\${(v.offeredSalary/100).toLocaleString('en-IN')}</td>
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
        const updated = await api('/pricing', { method: 'POST', body });
        showAlert('Pricing policy successfully updated by CEO!');
        loadPricing();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    // Run on startup
    window.addEventListener('DOMContentLoaded', () => {
      initUser();
    });
  </script>
</body>
</html>`;
}
