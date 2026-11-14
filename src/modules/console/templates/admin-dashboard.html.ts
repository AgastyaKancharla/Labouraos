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

  <!-- Claim Form Modal (Admin) -->
  <div id="admin-claim-modal" class="auth-overlay hidden">
    <div class="modal" style="max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="font-size: 1.15rem; margin: 0; color: var(--primary);">Report Replacement Claim</h3>
        <button type="button" class="btn-sm" onclick="closeAdminClaimModal()">✕ Close</button>
      </div>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">Claim can only be reported after an answered call with the business owner.</p>
      <input type="hidden" id="claim-placement-id">
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Answered Owner Call Record ID *</label>
        <input type="text" id="claim-call-record-id" placeholder="CR-00001 or Call Record UUID">
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Worker Left On (Date) *</label>
        <input type="date" id="claim-worker-left-on">
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Reason *</label>
        <select id="claim-reason">
          <option value="resigned">Resigned / Left voluntarily</option>
          <option value="absconded">Absconded / Stopped reporting</option>
          <option value="misconduct">Misconduct / Behaviour issue</option>
          <option value="performance">Unsatisfactory performance</option>
          <option value="attendance">Chronic absenteeism</option>
          <option value="business_closed">Business closed / Downsized</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 12px;">
        <label>Notes / Evidence</label>
        <textarea id="claim-notes" rows="3" placeholder="Details of owner call and circumstances..."></textarea>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" class="btn-secondary btn-sm" onclick="closeAdminClaimModal()">Cancel</button>
        <button type="button" class="btn-sm" onclick="submitAdminClaim()">Submit Claim</button>
      </div>
    </div>
  </div>

  <!-- Joining Confirmation Modal (Admin) -->
  <div id="admin-joining-modal" class="auth-overlay hidden">
    <div class="modal" style="max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="font-size: 1.15rem; margin: 0; color: var(--primary);">Record Joining Confirmation</h3>
        <button type="button" class="btn-sm" onclick="closeAdminJoiningModal()">✕ Close</button>
      </div>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">Joining requires answered confirmation calls to both worker and business on or after the joining date.</p>
      <input type="hidden" id="joining-placement-id">
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Worker Joining Call ID (Optional if logged)</label>
        <input type="text" id="joining-worker-call-id" placeholder="Worker call ID">
      </div>
      <div class="form-group" style="margin-bottom: 12px;">
        <label>Business Joining Call ID (Optional if logged)</label>
        <input type="text" id="joining-biz-call-id" placeholder="Business call ID">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" class="btn-secondary btn-sm" onclick="closeAdminJoiningModal()">Cancel</button>
        <button type="button" class="btn-sm" onclick="submitAdminJoining()">Confirm Joining</button>
      </div>
    </div>
  </div>

  <!-- Reveal Payout Details Modal (CEO & Finance) -->
  <div id="reveal-payout-modal" class="auth-overlay hidden">
    <div class="modal" style="max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="font-size: 1.15rem; margin: 0; color: var(--primary);">Payout Details (Decrypted for Payment)</h3>
        <button type="button" class="btn-sm" onclick="closeRevealPayoutModal()">✕ Close</button>
      </div>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">Audited access. Use these details to execute the payment in your bank or UPI application.</p>
      <div style="background: #0f172a; padding: 12px; border-radius: 6px; margin-bottom: 14px; border: 1px solid var(--border);">
        <div style="margin-bottom: 8px;">
          <span style="font-size: 0.85rem; color: #94a3b8;">Receiver Name on File:</span>
          <strong id="modal-reveal-name" style="display: block; font-size: 1.05rem; color: var(--text);">—</strong>
        </div>
        <div style="margin-bottom: 8px;">
          <span style="font-size: 0.85rem; color: #94a3b8;">Payout Method / Type:</span>
          <span id="modal-reveal-type" class="badge">—</span>
        </div>
        <div style="margin-bottom: 8px;">
          <span style="font-size: 0.85rem; color: #94a3b8;">Full UPI ID / Account Number:</span>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
            <code id="modal-reveal-details" style="font-size: 1.1rem; color: #38bdf8; font-weight: bold; background: #1e293b; padding: 6px 10px; border-radius: 4px; display: inline-block;">—</code>
          </div>
        </div>
        <div id="modal-reveal-ifsc-row" style="margin-bottom: 8px; display: none;">
          <span style="font-size: 0.85rem; color: #94a3b8;">IFSC Code:</span>
          <code id="modal-reveal-ifsc" style="font-size: 1rem; color: var(--text); background: #1e293b; padding: 4px 8px; border-radius: 4px; display: inline-block;">—</code>
        </div>
        <div style="font-size: 0.8rem; color: #64748b; margin-top: 8px;">
          Masked Reference: <span id="modal-reveal-masked">—</span>
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end;">
        <button type="button" class="btn-sm btn-secondary" onclick="closeRevealPayoutModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Record Payout Transfer Modal (CEO & Finance) -->
  <div id="record-payout-modal" class="auth-overlay hidden">
    <div class="modal" style="max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="font-size: 1.15rem; margin: 0; color: var(--primary);">Record Payout Transfer</h3>
        <button type="button" class="btn-sm" onclick="closeRecordPayoutModal()">✕ Close</button>
      </div>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">Record the completed bank or UPI transfer. Receiver name must match the account owner.</p>
      <input type="hidden" id="record-payout-id">
      <div style="background: #162032; padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; display: flex; justify-content: space-between;">
        <div>
          <span style="font-size: 0.8rem; color: #94a3b8;">Payment Code</span>
          <strong id="record-payout-code-text" style="display: block;">—</strong>
        </div>
        <div>
          <span style="font-size: 0.8rem; color: #94a3b8;">Amount</span>
          <strong id="record-payout-amount-text" style="display: block; color: var(--primary);">—</strong>
        </div>
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Bank UTR (12 digits / transfer reference) *</label>
        <input type="text" id="record-payout-utr" placeholder="e.g. 202611090001">
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Name Shown in UPI / Bank App *</label>
        <input type="text" id="record-payout-receiver-name" placeholder="Exact name displayed by UPI app or bank">
      </div>
      <div class="form-group" style="margin-bottom: 12px;">
        <label>Payment Date & Time *</label>
        <input type="datetime-local" id="record-payout-paid-at">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" class="btn-secondary btn-sm" onclick="closeRecordPayoutModal()">Cancel</button>
        <button type="button" class="btn-success btn-sm" onclick="submitRecordPayout()">Confirm & Record Payout</button>
      </div>
    </div>
  </div>

  <!-- Record Edit Modal -->
  <div id="record-edit-modal" class="auth-overlay hidden">
    <div class="modal" style="max-width: 650px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 id="record-edit-title" style="font-size: 1.15rem; margin: 0; color: var(--primary);">Edit Record</h3>
        <button type="button" class="btn-sm" onclick="closeRecordEditModal()">✕ Close</button>
      </div>

      <!-- Locked notice -->
      <div id="modal-edit-locked-notice" class="alert alert-danger hidden" style="margin-bottom: 12px; font-weight: 500;">
        Locked — money involved, ask your Team Lead
      </div>

      <form id="record-edit-form" onsubmit="submitRecordEdit(event)">
        <div id="record-edit-fields-container">
          <!-- Dynamically populated fields -->
        </div>

        <!-- Reason box: shown only when saved value is changed -->
        <div id="modal-edit-reason-container" class="form-group hidden" style="margin-top: 12px; background: #0f172a; padding: 10px; border-radius: 4px; border: 1px solid var(--border);">
          <label style="color: #f59e0b; font-weight: 600; display: block; margin-bottom: 4px;">Reason for change (required for modifying saved values):</label>
          <input type="text" id="modal-edit-reason" placeholder="e.g. Candidate requested corrected phone number" style="width: 100%;">
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button type="button" class="btn-sm" onclick="closeRecordEditModal()">Cancel</button>
          <button type="submit" id="btn-save-record-edit" class="btn-sm btn-success">Save Changes</button>
        </div>
      </form>

      <!-- Change History Section (Team Leads and above only) -->
      <div id="modal-change-history-section" class="hidden" style="margin-top: 20px; border-top: 1px solid var(--border); padding-top: 14px;">
        <h4 style="font-size: 0.95rem; margin-bottom: 8px; color: var(--text);">Change History</h4>
        <div class="table-container" style="max-height: 200px; overflow-y: auto;">
          <table class="change-history-table" style="font-size: 0.8rem;">
            <thead>
              <tr>
                <th>Who</th>
                <th>When</th>
                <th>Which Fields</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody id="modal-change-history-tbody">
              <tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No changes recorded</td></tr>
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

  <div id="retired-console-notice" role="note" style="margin: 12px 24px 0; padding: 10px 14px; border: 1px solid #f59e0b; border-radius: 8px; background: #fffbeb; color: #78350f; font-size: 0.85rem;">
    This is the old Admin Dashboard, kept only for what the new screens do not do yet: adding a bank credit by hand from the statement, setting a bank credit aside, Finance resolving payment and payout flags, and reporting a replacement claim. For everything else, sign in at <a href="/login" style="color: inherit; font-weight: 600;">/login</a>.
  </div>

  <nav class="nav-tabs">
    <button class="tab-btn active" data-tab="job-seekers">Job Seekers</button>
    <button class="tab-btn" data-tab="referrals">Referrals</button>
    <button class="tab-btn" data-tab="businesses">Businesses</button>
    <button class="tab-btn hidden" id="tab-business-reviews" data-tab="business-reviews">Business Reviews</button>
    <button class="tab-btn" data-tab="vacancies">Vacancies</button>
    <button class="tab-btn hidden" id="tab-interview-oversight" data-tab="interview-oversight">Interview Oversight</button>
    <button class="tab-btn" data-tab="placements">Placements</button>
    <button class="tab-btn" data-tab="payments">Payment Ledger</button>
    <button class="tab-btn" data-tab="refunds">Refund Approvals</button>
    <!-- CEO-only Pricing Tab; Manager tokens cannot see this per AGENTS.md §7 and specs/phase-6.md Task 4 -->
    <button class="tab-btn hidden" id="tab-pricing" data-tab="pricing">Pricing & Policy (CEO)</button>
    <button class="tab-btn hidden" id="tab-retention" data-tab="retention">Data Retention (CEO)</button>
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

      <!-- Pattern & Bypass Flags Card (Team Lead & Manager) -->
      <div class="card hidden" id="pattern-flags-card" style="margin-top: 16px;">
        <div class="card-title">
          <span>Pattern & Bypass Flags with Evidence (Team Lead & Manager)</span>
          <button class="btn-sm" onclick="loadPatternFlags()">Refresh Flags</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Bypass detections and daily pattern flags for rejections and activity stops.</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Flag Code</th>
                <th>Kind</th>
                <th>Subject</th>
                <th>Raised At</th>
                <th>Evidence</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="pattern-flags-tbody">
              <tr><td colspan="6" style="text-align: center;">Loading flags...</td></tr>
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

    <div id="view-interview-oversight" class="tab-view hidden">
      <div class="card">
        <div class="card-title"><span>Team Interview Oversight</span><button class="btn-sm" onclick="loadInterviewOversight()">Refresh</button></div>
        <div style="display:flex;gap:10px;margin-bottom:12px"><input id="team-interview-agent" placeholder="Filter by team agent ID"><input id="team-interview-vacancy" placeholder="Filter by vacancy ID or code"><button onclick="loadInterviewOversight()">Filter</button></div>
        <div id="interview-oversight-list" aria-live="polite">No interview data loaded.</div>
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
                <th>Status</th>
                <th>Payment due</th>
                <th>Payment status</th>
                <th>Joined Date</th>
                <th>Joining Checklist</th>
                <th>Guarantee Days Left</th>
                <th>Replacements Used</th>
                <th>Rejections Used</th>
                <th>Open Claim</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="placements-tbody">
              <tr><td colspan="13" style="text-align: center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Replacement Claim Decisions Card (Team Lead & Manager) -->
      <div class="card hidden" id="claim-decisions-card" style="margin-top: 16px;">
        <div class="card-title">
          <span>Replacement Claim Decisions (Team Lead & Manager)</span>
          <button class="btn-sm" onclick="loadClaimDecisions()">Refresh Claims</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Decide replacement claims within 48 hours. Exit call recording required.</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Claim Code</th>
                <th>Placement</th>
                <th>Candidate</th>
                <th>Business</th>
                <th>Worker Left On</th>
                <th>Reason</th>
                <th>Decision Due</th>
                <th>Exit Call Recording</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="claim-decisions-tbody">
              <tr><td colspan="9" style="text-align: center;">Loading pending claims...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Payment Ledger View -->
    <div id="view-payments" class="tab-view hidden">
      <!-- Money Owed (Waiting for Approval) Section -->
      <div class="card" id="finance-money-owed-card">
        <div class="card-title">
          <span>Money Owed (Waiting for Approval)</span>
          <button class="btn-sm" onclick="loadPayments()">Refresh</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Outgoing refunds, referral payouts, and joining rewards awaiting approval by CEO or Finance (oldest first).</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Payment Code</th>
                <th>Type</th>
                <th>Payee / Subject</th>
                <th>Amount</th>
                <th>Created Date</th>
                <th>Masked Account</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="money-owed-tbody">
              <tr><td colspan="7" style="text-align: center;">Loading money owed...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Approved and Ready to Pay Section -->
      <div class="card" id="finance-ready-to-pay-card">
        <div class="card-title">
          <span>Approved and Ready to Pay</span>
          <button class="btn-sm" onclick="loadPayments()">Refresh</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Approved payments ready for bank transfer or UPI payout. Finance reveals details at the moment of paying and records the UTR and receiver name.</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Payment Code</th>
                <th>Type</th>
                <th>Payee / Subject</th>
                <th>Amount</th>
                <th>Approved Date</th>
                <th>Approved By</th>
                <th>Masked Account</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="ready-to-pay-tbody">
              <tr><td colspan="8" style="text-align: center;">Loading ready to pay payments...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Payout Accounts in 48-Hour Wait Section -->
      <div class="card" id="finance-cooling-accounts-card">
        <div class="card-title">
          <span>Payout Accounts in 48-Hour Wait (Cooling Period)</span>
          <button class="btn-sm" onclick="loadPayments()">Refresh</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Accounts recently created or updated cannot be paid until the 48-hour cooling period elapses.</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Account Code</th>
                <th>Owner Type & ID</th>
                <th>Owner Name</th>
                <th>Method</th>
                <th>Masked Account</th>
                <th>Cooling Until</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="cooling-accounts-tbody">
              <tr><td colspan="7" style="text-align: center;">Loading cooling accounts...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Payout Fraud & Mismatch Flags Section -->
      <div class="card" id="finance-payout-flags-card">
        <div class="card-title">
          <span>Payout Flags (Fraud & Mismatch)</span>
          <button class="btn-sm" onclick="loadPayments()">Refresh Flags</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Flags for shared payout accounts, staff phone matches, or receiver name mismatches.</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Flag Code</th>
                <th>Kind</th>
                <th>Subject</th>
                <th>Details</th>
                <th>Raised At</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="payout-flags-tbody">
              <tr><td colspan="7" style="text-align: center;">Loading payout flags...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Finance UPI & Bank Confirmation Section -->
      <div class="card" id="finance-bank-actions-card">
        <div class="card-title">
          <span>Pending Payments Awaiting Confirmation</span>
          <button class="btn-sm" onclick="loadPayments()">Refresh</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Payments are confirmed only when exact funds arrive in the bank account. Agents cannot mark payments as paid.</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Payment Code</th>
                <th>Reference</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Due Time</th>
                <th>Payer's UTR Hint</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="pending-payments-tbody">
              <tr><td colspan="7" style="text-align: center;">Loading pending payments...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Unmatched Bank Credits Section -->
      <div class="card" id="finance-bank-credits-card">
        <div class="card-title">
          <span>Unmatched Bank Credits</span>
          <button class="btn-sm" onclick="loadPayments()">Refresh Credits</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Credits received from the bank feed or statement waiting to be matched to a pending payment, or ignored.</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Bank UTR</th>
                <th>Amount</th>
                <th>Received At</th>
                <th>Payer Name</th>
                <th>Remark / Note</th>
                <th>Source</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="bank-credits-tbody">
              <tr><td colspan="8" style="text-align: center;">Loading unmatched bank credits...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Add Bank Credit Form (Finance Manual Entry) -->
      <div class="card" id="finance-add-credit-card">
        <div class="card-title">
          <span>Add Bank Credit (From Bank Statement)</span>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Finance and CEO only. Record credits from statement with exact UTR and amount.</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; align-items: flex-end;">
          <div class="form-group">
            <label>Bank UTR (12 digits / ref)</label>
            <input type="text" id="credit-utr" placeholder="e.g. 202611090001">
          </div>
          <div class="form-group">
            <label>Amount (₹ Rupees)</label>
            <input type="number" id="credit-amount" placeholder="e.g. 499 or 9440" step="any">
          </div>
          <div class="form-group">
            <label>Received At</label>
            <input type="datetime-local" id="credit-received-at">
          </div>
          <div class="form-group">
            <label>Payer Name (optional)</label>
            <input type="text" id="credit-payer-name" placeholder="Payer Name">
          </div>
          <div class="form-group">
            <label>Remark / Note (optional)</label>
            <input type="text" id="credit-remark" placeholder="Remark from statement">
          </div>
          <div>
            <button class="btn-success" onclick="submitAddBankCredit()">Add Bank Credit</button>
          </div>
        </div>
      </div>

      <!-- Payment Mismatch Review Flags Section -->
      <div class="card" id="finance-mismatch-flags-card">
        <div class="card-title">
          <span>Payment Mismatch Flags</span>
          <button class="btn-sm" onclick="loadPayments()">Refresh Flags</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Flags raised when a bank credit has the wrong amount, unknown reference, or double payment.</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Flag Code</th>
                <th>Subject</th>
                <th>Details</th>
                <th>Raised At</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="mismatch-flags-tbody">
              <tr><td colspan="6" style="text-align: center;">Loading flags...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Historical Payment Ledger -->
      <div class="card">
        <div class="card-title">
          <span>Payment Ledger History</span>
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

    <!-- Retention View (CEO only) -->
    <div id="view-retention" class="tab-view hidden">
      <div class="card" id="retention-summary-card">
        <div class="card-title">
          <span>Data Retention & Anonymisation Policy</span>
          <div style="display: flex; gap: 8px;">
            <button class="btn-sm" onclick="loadRetentionSummary()">Refresh</button>
            <button class="btn-sm" id="btn-retention-dry-run" onclick="triggerRetentionDryRun()" style="background: #0284c7; color: white;">Run Dry Run</button>
          </div>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 14px;">
          Master Guide: Profiles kept 23 months after last activity; call recordings and login logs 12 months; money records 8 years. Dry runs preview counts without deleting or anonymising data.
        </p>
        <div id="retention-summary-content" style="background: #0f172a; padding: 14px; border-radius: 6px; border: 1px solid var(--border);">
          <p style="color: var(--text-muted);">Loading retention status...</p>
        </div>
        <div id="retention-dry-run-result" style="display: none; margin-top: 14px; background: #1e293b; padding: 14px; border-radius: 6px; border: 1px solid var(--border);">
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
      const retTab = document.getElementById('tab-retention');
      if (retTab) retTab.classList.add('hidden');
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
      const retentionTab = document.getElementById('tab-retention');
      if (retentionTab) {
        if (payload.role === 'ceo') {
          retentionTab.classList.remove('hidden');
        } else {
          retentionTab.classList.add('hidden');
          if (currentTab === 'retention') {
            switchTab('job-seekers');
          }
        }
      }
      const reviewTab = document.getElementById('tab-business-reviews');
      if (['team_lead', 'manager', 'ceo'].includes(payload.role)) reviewTab.classList.remove('hidden');
      else reviewTab.classList.add('hidden');
      const interviewTab = document.getElementById('tab-interview-oversight');
      if (['team_lead', 'manager', 'ceo'].includes(payload.role)) interviewTab.classList.remove('hidden');
      else interviewTab.classList.add('hidden');

      const isLeadOrManager = ['team_lead', 'manager', 'ceo'].includes(payload.role);
      const claimCard = document.getElementById('claim-decisions-card');
      if (claimCard) {
        if (isLeadOrManager) claimCard.classList.remove('hidden');
        else claimCard.classList.add('hidden');
      }
      const patternFlagsCard = document.getElementById('pattern-flags-card');
      if (patternFlagsCard) {
        if (isLeadOrManager) patternFlagsCard.classList.remove('hidden');
        else patternFlagsCard.classList.add('hidden');
      }

      const isFinanceOrCeo = ['ceo', 'finance'].includes(payload.role);
      const moneyOwedCard = document.getElementById('finance-money-owed-card');
      if (moneyOwedCard) {
        if (isFinanceOrCeo) moneyOwedCard.classList.remove('hidden');
        else moneyOwedCard.classList.add('hidden');
      }
      const readyToPayCard = document.getElementById('finance-ready-to-pay-card');
      if (readyToPayCard) {
        if (isFinanceOrCeo) readyToPayCard.classList.remove('hidden');
        else readyToPayCard.classList.add('hidden');
      }
      const coolingAccountsCard = document.getElementById('finance-cooling-accounts-card');
      if (coolingAccountsCard) {
        if (isFinanceOrCeo) coolingAccountsCard.classList.remove('hidden');
        else coolingAccountsCard.classList.add('hidden');
      }
      const payoutFlagsCard = document.getElementById('finance-payout-flags-card');
      if (payoutFlagsCard) {
        if (isFinanceOrCeo) payoutFlagsCard.classList.remove('hidden');
        else payoutFlagsCard.classList.add('hidden');
      }

      labouraShowApproverTabs();
      if (labouraIsApprover()) {
        loadLoginCodes().catch(function () {});
      }
      if (payload.role === 'finance') {
        switchTab('payments');
      } else {
        loadJobSeekers();
      }
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
      else if (tab === 'business-reviews') {
        loadBusinessReviewQueue();
        if (currentUser && ['team_lead', 'manager', 'ceo'].includes(currentUser.role)) loadPatternFlags();
      }
      else if (tab === 'vacancies') loadVacancies();
      else if (tab === 'interview-oversight') loadInterviewOversight();
      else if (tab === 'placements') {
        loadPlacements();
        if (currentUser && ['team_lead', 'manager', 'ceo'].includes(currentUser.role)) loadClaimDecisions();
      }
      else if (tab === 'payments') loadPayments();
      else if (tab === 'pricing') loadPricing();
      else if (tab === 'retention') loadRetentionSummary();
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
            <td>\${j.trades?.length ? j.trades.find(t => t.isPrimary)?.trade : (j.tradeSkill || '—')}</td>
            <td>₹\${(j.minSalary/100).toLocaleString('en-IN')} - ₹\${(j.maxSalary/100).toLocaleString('en-IN')}</td>
            <td><span class="badge">\${j.status}</span></td>
            <td>\${j.hitCount}</td>
            <td>\${j.identityVerifications?.[0]?.status ?? 'pending'}</td>
            <td>
              <button class="btn-sm btn-call" onclick="openAdminCalling('job_seeker', '\${j.id}', '\${j.code}')">Call</button>
              <button class="btn-sm" onclick="openRecordEditModal('job_seeker', '\${j.id}', '\${j.code}')">Edit</button>
              \${j.status === 'lead' ? \`
                <button class="btn-sm" onclick="resendSeekerPayment('\${j.id}')">Resend payment link</button>
              \` : ''}
            </td>
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
            <td>
              <button class="btn-sm btn-call" onclick="openAdminCalling('referral', '\${r.id}', '\${r.code}')">Call</button>
              <button class="btn-sm" onclick="openRecordEditModal('referral', '\${r.id}', '\${r.code}')">Edit</button>
            </td>
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
            <td>\${b.visits?.[0]?.selfieUrl || b.storefrontPhotoPath ? 'Yes' : 'Pending'}</td>
            <td>\${b.geofenceFlag ? 'FLAGGED' : 'Clean'}</td>
            <td>
              <button class="btn-sm btn-call" onclick="openAdminCalling('business', '\${b.id}', '\${b.code}')">Call</button>
              <button class="btn-sm" onclick="openRecordEditModal('business', '\${b.id}', '\${b.code}')">Edit</button>
            </td>
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

        document.getElementById('admin-profile-name').textContent = data.name || data.ownerName || '—';
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
        const now = Date.now();
        tbody.innerHTML = data.map(p => \`
          <tr>
            <td><strong>\${p.code}</strong></td>
            <td>\${p.jobSeeker ? p.jobSeeker.name : p.jobSeekerId}</td>
            <td>\${p.business ? p.business.name : p.businessId}</td>
            <td><span class="badge">\${p.status}</span></td>
            <td>\${p.paymentDueAt ? new Date(p.paymentDueAt).toLocaleString('en-IN') : '—'}</td>
            <td>\${p.paidAt ? 'Paid' : p.status === 'awaiting_payment' && p.paymentDueAt && new Date(p.paymentDueAt).getTime() <= now ? 'Overdue' : p.status === 'awaiting_payment' ? 'Awaiting payment' : '—'}</td>
            <td>\${p.joinedDate ? new Date(p.joinedDate).toLocaleDateString() : '—'}</td>
            <td>
              <div style="font-size: 0.8rem; line-height: 1.4;">
                <div>\${p.joiningWorkerCallId ? '<span style="color:var(--success)">✓ Worker call</span>' : '<span style="color:var(--text-muted)">✗ Worker call</span>'}</div>
                <div>\${p.joiningBusinessCallId ? '<span style="color:var(--success)">✓ Business call</span>' : '<span style="color:var(--text-muted)">✗ Business call</span>'}</div>
                \${p.status === 'confirmed' ? \`<button class="btn-sm" style="margin-top:4px;" onclick="openJoiningModal('\${p.id}', '\${p.code}')">Record Joining</button>\` : ''}
              </div>
            </td>
            <td>
              \${p.guaranteeEndedReason ? \`<span class="badge" style="background:#ef4444;">Ended: \${p.guaranteeEndedReason}</span>\` : (p.guaranteeDaysLeft !== undefined && p.guaranteeDaysLeft !== null ? \`\${p.guaranteeDaysLeft} days left\` : (p.joinedDate ? \`\${Math.max(0, 60 - Math.floor((now - new Date(p.joinedDate).getTime()) / 86400000))} days left\` : '—'))}
            </td>
            <td>\${p.replacementNumber} / 2</td>
            <td>\${p.rejectionsUsed || 0} / 2</td>
            <td>
              \${p.openClaim ? \`<span class="badge" style="background:#f59e0b;color:#000;">Pending · Due \${new Date(p.openClaim.decisionDueAt).toLocaleString('en-IN')}</span>\` : '<span style="color:var(--text-muted)">None</span>'}
            </td>
            <td>
              <button class="btn-sm" onclick="openRecordEditModal('placement', '\${p.id}', '\${p.code}')">Edit</button>
              \${!p.paidAt && p.status === 'awaiting_payment' ? \`
                <button class="btn-sm" onclick="resendPlacementPayment('\${p.id}')">Resend payment link</button>
              \` : ''}
              \${p.status === 'active' ? \`
                <button class="btn-sm btn-secondary" onclick="openClaimModal('\${p.id}', '\${p.code}')">Report Claim</button>
              \` : ''}
            </td>
          </tr>
        \`).join('') || '<tr><td colspan="13">No placements found</td></tr>';
      } catch (e) {
        console.error(e);
      }
    }

    function openClaimModal(placementId, placementCode) {
      document.getElementById('claim-placement-id').value = placementId;
      document.getElementById('claim-call-record-id').value = '';
      document.getElementById('claim-worker-left-on').value = new Date().toISOString().split('T')[0];
      document.getElementById('claim-notes').value = '';
      document.getElementById('admin-claim-modal').classList.remove('hidden');
    }

    function closeAdminClaimModal() {
      document.getElementById('admin-claim-modal').classList.add('hidden');
    }

    async function submitAdminClaim() {
      const placementId = document.getElementById('claim-placement-id').value;
      const callRecordId = document.getElementById('claim-call-record-id').value.trim();
      const workerLeftOn = document.getElementById('claim-worker-left-on').value;
      const reason = document.getElementById('claim-reason').value;
      const notes = document.getElementById('claim-notes').value.trim();

      if (!callRecordId) return alert('Answered owner call record ID is required');
      if (!workerLeftOn) return alert('Worker left date is required');

      try {
        await api('/placements/' + placementId + '/claims', {
          method: 'POST',
          body: { callRecordId, workerLeftOn, reason, notes: notes || undefined },
        });
        showAlert('Replacement claim submitted successfully');
        closeAdminClaimModal();
        loadPlacements();
        if (currentUser && ['team_lead', 'manager', 'ceo'].includes(currentUser.role)) loadClaimDecisions();
      } catch (e) {
        showAlert('Claim submission failed: ' + e.message, false);
      }
    }

    function openJoiningModal(placementId, placementCode) {
      document.getElementById('joining-placement-id').value = placementId;
      document.getElementById('joining-worker-call-id').value = '';
      document.getElementById('joining-biz-call-id').value = '';
      document.getElementById('admin-joining-modal').classList.remove('hidden');
    }

    function closeAdminJoiningModal() {
      document.getElementById('admin-joining-modal').classList.add('hidden');
    }

    async function submitAdminJoining() {
      const placementId = document.getElementById('joining-placement-id').value;
      try {
        await api('/placements/' + placementId + '/joined', { method: 'POST', body: {} });
        showAlert('Joining recorded successfully');
        closeAdminJoiningModal();
        loadPlacements();
      } catch (e) {
        showAlert('Failed to record joining: ' + e.message, false);
      }
    }

    async function loadClaimDecisions() {
      const tbody = document.getElementById('claim-decisions-tbody');
      if (!tbody) return;
      try {
        const claims = await api('/placements/claims/pending');
        const now = Date.now();
        tbody.innerHTML = claims.map(c => {
          const isOverdue = new Date(c.decisionDueAt).getTime() <= now;
          const exitRecording = c.exitCallRecordId
            ? \`<button class="btn-sm" onclick="listenCall('\${c.exitCallRecordId}')">Listen Exit Call</button>\`
            : '<span style="color:var(--danger)">Missing exit call</span>';
          return \`
            <tr>
              <td><strong>\${c.code}</strong></td>
              <td>\${c.placement ? c.placement.code : c.placementId}</td>
              <td>\${c.placement && c.placement.jobSeeker ? c.placement.jobSeeker.name : '—'}</td>
              <td>\${c.placement && c.placement.business ? c.placement.business.name : '—'}</td>
              <td>\${c.workerLeftOn ? new Date(c.workerLeftOn).toLocaleDateString() : '—'}</td>
              <td><span class="badge">\${c.reason}</span></td>
              <td>
                <span style="\${isOverdue ? 'color:var(--danger);font-weight:bold;' : ''}">
                  \${new Date(c.decisionDueAt).toLocaleString('en-IN')}
                  \${isOverdue ? ' (OVERDUE)' : ''}
                </span>
              </td>
              <td>\${exitRecording}</td>
              <td>
                <button class="btn-sm btn-success" onclick="promptDecideClaim('\${c.placementId}', '\${c.id}', 'accepted')">Accept</button>
                <button class="btn-sm btn-danger" onclick="promptDecideClaim('\${c.placementId}', '\${c.id}', 'rejected')">Reject</button>
              </td>
            </tr>
          \`;
        }).join('') || '<tr><td colspan="9" style="text-align: center;">No pending replacement claims</td></tr>';
      } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--danger);">Failed to load claims: ' + e.message + '</td></tr>';
      }
    }

    async function promptDecideClaim(placementId, claimId, decision) {
      const reason = prompt('Enter ' + decision + ' reason / notes:');
      if (!reason) return;
      try {
        await api('/placements/' + placementId + '/claims/' + claimId + '/decide', {
          method: 'POST',
          body: { decision, decisionReason: reason },
        });
        showAlert('Claim ' + decision + ' successfully');
        loadClaimDecisions();
        loadPlacements();
      } catch (e) {
        showAlert('Claim decision failed: ' + e.message, false);
      }
    }

    async function loadPatternFlags() {
      const tbody = document.getElementById('pattern-flags-tbody');
      if (!tbody) return;
      try {
        const flags = await api('/review-flags?status=open');
        const patternKinds = ['bypass_suspected', 'business_many_rejections', 'business_stopped_after_interviews', 'agent_rejection_pattern', 'claim_decision_overdue'];
        const patternFlags = flags.filter(f => patternKinds.includes(f.kind));
        tbody.innerHTML = patternFlags.map(f => {
          let evidence = '';
          if (f.details) {
            try {
              const d = typeof f.details === 'string' ? JSON.parse(f.details) : f.details;
              evidence = Object.entries(d).map(([k, v]) => \`\${k}: \${v}\`).join(' · ');
            } catch {
              evidence = String(f.details);
            }
          }
          return \`
            <tr>
              <td><strong>\${f.code}</strong></td>
              <td><span class="badge" style="background:#f59e0b;color:#000;">\${f.kind}</span></td>
              <td>\${f.subjectType} · \${f.subjectId}</td>
              <td>\${new Date(f.raisedAt).toLocaleString('en-IN')}</td>
              <td style="font-size:0.85rem;">\${evidence || '—'}</td>
              <td>
                <button class="btn-sm" onclick="promptResolvePatternFlag('\${f.id}')">Resolve</button>
              </td>
            </tr>
          \`;
        }).join('') || '<tr><td colspan="6" style="text-align: center;">No open pattern or bypass flags</td></tr>';
      } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger);">Failed to load flags: ' + e.message + '</td></tr>';
      }
    }

    async function promptResolvePatternFlag(flagId) {
      const resolution = prompt('Enter resolution ("cleared" or "confirmed"):', 'cleared');
      if (!resolution) return;
      const notes = prompt('Enter resolution notes:');
      try {
        await api('/review-flags/' + flagId + '/resolve', {
          method: 'POST',
          body: { resolution, notes: notes || undefined },
        });
        showAlert('Review flag resolved');
        loadPatternFlags();
      } catch (e) {
        showAlert('Failed to resolve flag: ' + e.message, false);
      }
    }

    async function loadInterviewOversight() {
      const target = document.getElementById('interview-oversight-list');
      target.textContent = 'Loading interviews…';
      try {
        const agentId = document.getElementById('team-interview-agent').value.trim();
        const vacancyId = document.getElementById('team-interview-vacancy').value.trim();
        const params = new URLSearchParams();
        if (agentId) params.set('agentId', agentId);
        if (vacancyId) params.set('vacancyId', vacancyId);
        const query = params.toString();
        const interviews = await api('/interviews' + (query ? '?' + query : ''));
        const now = Date.now();
        const rows = interviews.map(interview => {
          const overdue = interview.status === 'confirmed' && !interview.resultRecordedAt && new Date(interview.resultDueAt).getTime() <= now;
          const mismatch = (interview.result === 'not_selected' || interview.status === 'no_result') && interview.candidateCheckAnswer === 'offered_yes';
          const noResult = interview.status === 'no_result';
          return { interview, overdue, mismatch, noResult };
        }).filter(row => row.overdue || row.mismatch || row.noResult);
        target.replaceChildren();
        if (!rows.length) { target.textContent = 'No overdue results, mismatches, or no-result interviews.'; return; }
        rows.forEach(({ interview, overdue, mismatch, noResult }) => {
          const card = document.createElement('article'); card.className = 'board-card';
          const heading = document.createElement('h3'); heading.textContent = interview.code + ' · ' + interview.vacancy.code + ' · ' + interview.jobSeeker.code + ' · ' + interview.status;
          const details = document.createElement('p'); details.textContent =
            (overdue ? 'OVERDUE RESULT · ' : '') + (mismatch ? 'RESULT MISMATCH · ' : '') + (noResult ? 'NO RESULT · ' : '') +
            'Reply due ' + new Date(interview.replyDueAt).toLocaleString('en-IN') + ' · Result due ' + new Date(interview.resultDueAt).toLocaleString('en-IN') +
            ' · Attendance ' + (interview.agentAttendanceRequired ? 'needed' : 'not needed');
          card.append(heading, details); target.appendChild(card);
        });
      } catch (e) { target.textContent = e.message || 'Could not load interviews.'; }
    }

    let currentUnmatchedCredits = [];

    async function loadPayments() {
      try {
        if (currentUser && ['finance', 'ceo'].includes(currentUser.role)) {
          // Load unmatched bank credits
          try {
            const credits = await api('/payments/bank-credits?status=unmatched');
            currentUnmatchedCredits = Array.isArray(credits) ? credits : [];
            const creditsTbody = document.getElementById('bank-credits-tbody');
            if (creditsTbody) {
              creditsTbody.innerHTML = currentUnmatchedCredits.map(c => \`
                <tr>
                  <td><strong>\${c.bankUtr}</strong></td>
                  <td>₹\${(c.amountPaise / 100).toLocaleString('en-IN')} (\${c.amountPaise} paise)</td>
                  <td>\${new Date(c.receivedAt).toLocaleString()}</td>
                  <td>\${c.payerName || '—'}</td>
                  <td><small>\${c.remark || '—'}</small></td>
                  <td><span class="badge">\${c.source}</span></td>
                  <td><span class="badge">\${c.status}</span></td>
                  <td>
                    <button class="btn-sm" onclick="promptMatchCredit('\${c.id}', \${c.amountPaise})">Match</button>
                    <button class="btn-sm btn-danger" onclick="promptIgnoreBankCredit('\${c.id}')">Ignore</button>
                  </td>
                </tr>
              \`).join('') || '<tr><td colspan="8">No unmatched bank credits</td></tr>';
            }
          } catch (e) {
            console.error('Error loading bank credits:', e);
          }

          // Load payment mismatch flags
          try {
            const flags = await api('/payments/review-flags?status=open');
            const flagsTbody = document.getElementById('mismatch-flags-tbody');
            if (flagsTbody) {
              flagsTbody.innerHTML = (Array.isArray(flags) ? flags : []).map(f => \`
                <tr>
                  <td><strong>\${f.code}</strong></td>
                  <td>\${f.subjectType}: \${f.subjectId}</td>
                  <td><small>\${JSON.stringify(f.details || {})}</small></td>
                  <td>\${new Date(f.raisedAt).toLocaleString()}</td>
                  <td><span class="badge">\${f.status}</span></td>
                  <td>
                    <button class="btn-sm" onclick="promptResolveFlag('\${f.id}')">Resolve</button>
                  </td>
                </tr>
              \`).join('') || '<tr><td colspan="6">No open payment mismatch flags</td></tr>';
            }
          } catch (e) {
            console.error('Error loading mismatch flags:', e);
          }

          // Load pending payments
          try {
            const pending = await api('/payments?status=pending');
            const pendingTbody = document.getElementById('pending-payments-tbody');
            if (pendingTbody) {
              const creditUtrs = new Set(currentUnmatchedCredits.map(c => c.bankUtr));
              pendingTbody.innerHTML = (Array.isArray(pending) ? pending : []).map(p => {
                const hintMatch = p.payerUtrHint && creditUtrs.has(p.payerUtrHint);
                const dueTime = p.paymentDueAt ? new Date(p.paymentDueAt).toLocaleString() : 'Within 24h';
                return \`
                  <tr>
                    <td><strong>\${p.code}</strong></td>
                    <td><code>\${p.upiReference || '—'}</code></td>
                    <td>\${p.type}</td>
                    <td>₹\${(p.amount / 100).toLocaleString('en-IN')} (\${p.amount} paise)</td>
                    <td>\${dueTime}</td>
                    <td>
                      \${p.payerUtrHint ? \`
                        <span>\${p.payerUtrHint}</span>
                        \${hintMatch ? '<span class="badge badge-success" style="background:#059669;margin-left:4px">Matching Credit Found!</span>' : ''}
                      \` : '—'}
                    </td>
                    <td>
                      <button class="btn-sm" onclick="promptMatchPayment('\${p.id}', \${p.amount})">Match</button>
                    </td>
                  </tr>
                \`;
              }).join('') || '<tr><td colspan="7">No pending payments awaiting match</td></tr>';
            }

            // Phase 18: Money Owed (Waiting for Approval)
            const owed = (Array.isArray(pending) ? pending : [])
              .filter(p => ['refund', 'referral_payout', 'joining_reward'].includes(p.type))
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            const owedTbody = document.getElementById('money-owed-tbody');
            if (owedTbody) {
              owedTbody.innerHTML = owed.map(p => \`
                <tr>
                  <td><strong>\${p.code}</strong></td>
                  <td><span class="badge">\${p.type}</span></td>
                  <td>\${p.subjectType}: \${p.subjectId}</td>
                  <td>₹\${(p.amount / 100).toLocaleString('en-IN')} (\${p.amount} paise)</td>
                  <td>\${new Date(p.createdAt).toLocaleString()}</td>
                  <td><code>\${p.maskedPayoutAccount || p.payoutAccount?.maskedValue || '—'}</code></td>
                  <td>
                    <button class="btn-sm btn-success" onclick="approveMoneyOut('\${p.id}')">Approve</button>
                  </td>
                </tr>
              \`).join('') || '<tr><td colspan="7" style="text-align: center;">No money owed waiting for approval</td></tr>';
            }
          } catch (e) {
            console.error('Error loading pending payments / money owed:', e);
          }

          // Phase 18: Approved and Ready to Pay
          try {
            const approved = await api('/payments?status=approved');
            const readyToPay = (Array.isArray(approved) ? approved : [])
              .filter(p => ['refund', 'referral_payout', 'joining_reward'].includes(p.type))
              .sort((a, b) => new Date(a.approvedAt || a.createdAt).getTime() - new Date(b.approvedAt || b.createdAt).getTime());
            const readyTbody = document.getElementById('ready-to-pay-tbody');
            if (readyTbody) {
              readyTbody.innerHTML = readyToPay.map(p => \`
                <tr>
                  <td><strong>\${p.code}</strong></td>
                  <td><span class="badge">\${p.type}</span></td>
                  <td>\${p.subjectType}: \${p.subjectId}</td>
                  <td>₹\${(p.amount / 100).toLocaleString('en-IN')} (\${p.amount} paise)</td>
                  <td>\${p.approvedAt ? new Date(p.approvedAt).toLocaleString() : '—'}</td>
                  <td>\${p.approvedByStaffId || '—'}</td>
                  <td><code>\${p.maskedPayoutAccount || p.payoutAccount?.maskedValue || '—'}</code></td>
                  <td>
                    <button class="btn-sm" onclick="openRevealPayoutModal('\${p.id}')">Reveal</button>
                    <button class="btn-sm btn-primary" onclick="openRecordPayoutModal('\${p.id}', '\${p.code}', \${p.amount})">Record payment</button>
                  </td>
                </tr>
              \`).join('') || '<tr><td colspan="8" style="text-align: center;">No approved payments ready to pay</td></tr>';
            }
          } catch (e) {
            console.error('Error loading ready to pay payments:', e);
          }

          // Phase 18: Accounts in 48-Hour Wait (Cooling Period)
          try {
            const cooling = await api('/payout-accounts/cooling');
            const coolingTbody = document.getElementById('cooling-accounts-tbody');
            if (coolingTbody) {
              coolingTbody.innerHTML = (Array.isArray(cooling) ? cooling : []).map(c => \`
                <tr>
                  <td><strong>\${c.code}</strong></td>
                  <td>\${c.ownerType}: \${c.ownerId}</td>
                  <td>\${c.ownerNameAtEntry || '—'}</td>
                  <td>\${c.method}</td>
                  <td><code>\${c.maskedValue}</code></td>
                  <td>\${new Date(c.activeFrom).toLocaleString()}</td>
                  <td><span class="badge">\${c.status}</span></td>
                </tr>
              \`).join('') || '<tr><td colspan="7" style="text-align: center;">No payout accounts currently in cooling wait</td></tr>';
            }
          } catch (e) {
            console.error('Error loading cooling accounts:', e);
          }

          // Phase 18: Payout Fraud & Mismatch Flags
          try {
            const flags = await api('/payments/review-flags?status=open');
            const payoutFlags = (Array.isArray(flags) ? flags : []).filter(f =>
              ['payout_shared_account', 'payout_matches_staff', 'payout_name_mismatch'].includes(f.kind)
            );
            const payoutFlagsTbody = document.getElementById('payout-flags-tbody');
            if (payoutFlagsTbody) {
              payoutFlagsTbody.innerHTML = payoutFlags.map(f => \`
                <tr>
                  <td><strong>\${f.code}</strong></td>
                  <td><span class="badge">\${f.kind}</span></td>
                  <td>\${f.subjectType}: \${f.subjectId}</td>
                  <td><small>\${JSON.stringify(f.details || {})}</small></td>
                  <td>\${new Date(f.raisedAt).toLocaleString()}</td>
                  <td><span class="badge">\${f.status}</span></td>
                  <td>
                    <button class="btn-sm" onclick="promptResolvePayoutFlag('\${f.id}')">Resolve</button>
                  </td>
                </tr>
              \`).join('') || '<tr><td colspan="7" style="text-align: center;">No open payout fraud or mismatch flags</td></tr>';
            }
          } catch (e) {
            console.error('Error loading payout flags:', e);
          }
        }

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
            <td><small>\${p.bankUtr || p.gatewayReference || '—'}</small></td>
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

    async function submitAddBankCredit() {
      const bankUtr = document.getElementById('credit-utr').value.trim();
      const amountInRupees = parseFloat(document.getElementById('credit-amount').value);
      const receivedAt = document.getElementById('credit-received-at').value;
      const payerName = document.getElementById('credit-payer-name').value.trim();
      const remark = document.getElementById('credit-remark').value.trim();

      if (!bankUtr || isNaN(amountInRupees) || !receivedAt) {
        return alert('Bank UTR, valid amount, and received date/time are required');
      }

      try {
        const body = {
          bankUtr,
          amountPaise: Math.round(amountInRupees * 100),
          receivedAt,
          payerName: payerName || undefined,
          remark: remark || undefined,
        };
        await api('/payments/bank-credits', { method: 'POST', body });
        showAlert('Bank credit recorded successfully');
        document.getElementById('credit-utr').value = '';
        document.getElementById('credit-amount').value = '';
        document.getElementById('credit-payer-name').value = '';
        document.getElementById('credit-remark').value = '';
        loadPayments();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function promptMatchPayment(paymentId, expectedAmountPaise) {
      const creditId = prompt('Enter Bank Credit ID to match (must be exact amount ₹' + (expectedAmountPaise / 100) + '):');
      if (!creditId) return;
      try {
        await api('/payments/' + paymentId + '/confirm', {
          method: 'POST',
          body: { bankCreditId: creditId.trim() },
        });
        showAlert('Payment confirmed successfully with bank credit!');
        loadPayments();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function promptMatchCredit(creditId, amountPaise) {
      const paymentId = prompt('Enter Pending Payment ID to match (must be exact amount ₹' + (amountPaise / 100) + '):');
      if (!paymentId) return;
      try {
        await api('/payments/' + paymentId.trim() + '/confirm', {
          method: 'POST',
          body: { bankCreditId: creditId },
        });
        showAlert('Payment confirmed successfully with bank credit!');
        loadPayments();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function promptIgnoreBankCredit(creditId) {
      const reason = prompt('Enter required reason for ignoring this bank credit:');
      if (!reason || !reason.trim()) return alert('Reason is required');
      try {
        await api('/payments/bank-credits/' + creditId + '/ignore', {
          method: 'POST',
          body: { reason: reason.trim() },
        });
        showAlert('Bank credit marked as ignored');
        loadPayments();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function promptResolveFlag(flagId) {
      const resolution = prompt('Enter written resolution for this mismatch flag:');
      if (!resolution || !resolution.trim()) return alert('Resolution is required');
      try {
        await api('/payments/review-flags/' + flagId + '/resolve', {
          method: 'POST',
          body: { resolution: resolution.trim() },
        });
        showAlert('Payment mismatch flag resolved');
        loadPayments();
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function resendPlacementPayment(id) {
      try {
        await api('/placements/' + id + '/resend-payment', { method: 'POST' });
        showAlert('Payment link resent successfully!');
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function resendSeekerPayment(id) {
      try {
        await api('/job-seekers/' + id + '/resend-payment', { method: 'POST' });
        showAlert('Payment link resent successfully!');
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    // Phase 18: Finance & CEO Payout Actions
    async function approveMoneyOut(paymentId) {
      if (!confirm('Approve this payment for release?')) return;
      try {
        await api('/payments/' + paymentId + '/approve', { method: 'POST' });
        showAlert('Payment approved successfully');
        loadPayments();
      } catch (e) {
        showAlert('Approval failed: ' + e.message, false);
      }
    }

    async function openRevealPayoutModal(paymentId) {
      try {
        const res = await api('/payments/' + paymentId + '/reveal-payout-details', { method: 'POST' });
        document.getElementById('modal-reveal-name').textContent = res.accountOwnerName || '—';
        document.getElementById('modal-reveal-type').textContent = res.accountType || '—';
        document.getElementById('modal-reveal-details').textContent = res.upiId || res.accountNumber || '—';
        const ifscRow = document.getElementById('modal-reveal-ifsc-row');
        if (res.ifsc) {
          ifscRow.style.display = 'block';
          document.getElementById('modal-reveal-ifsc').textContent = res.ifsc;
        } else {
          ifscRow.style.display = 'none';
        }
        document.getElementById('modal-reveal-masked').textContent = res.masked || '—';
        document.getElementById('reveal-payout-modal').classList.remove('hidden');
      } catch (e) {
        showAlert('Failed to reveal payout details: ' + e.message, false);
      }
    }

    function closeRevealPayoutModal() {
      document.getElementById('reveal-payout-modal').classList.add('hidden');
      document.getElementById('modal-reveal-details').textContent = '—';
      document.getElementById('modal-reveal-name').textContent = '—';
    }

    function openRecordPayoutModal(paymentId, code, amountPaise) {
      document.getElementById('record-payout-id').value = paymentId;
      document.getElementById('record-payout-code-text').textContent = code;
      document.getElementById('record-payout-amount-text').textContent = '₹' + ((amountPaise || 0) / 100).toLocaleString('en-IN');
      document.getElementById('record-payout-utr').value = '';
      document.getElementById('record-payout-receiver-name').value = '';
      document.getElementById('record-payout-paid-at').value = new Date().toISOString().slice(0, 16);
      document.getElementById('record-payout-modal').classList.remove('hidden');
    }

    function closeRecordPayoutModal() {
      document.getElementById('record-payout-modal').classList.add('hidden');
    }

    async function submitRecordPayout() {
      const paymentId = document.getElementById('record-payout-id').value;
      const bankUtr = document.getElementById('record-payout-utr').value.trim();
      const receiverNameShown = document.getElementById('record-payout-receiver-name').value.trim();
      const paidAt = document.getElementById('record-payout-paid-at').value;

      if (!bankUtr || !receiverNameShown || !paidAt) {
        return alert('Bank UTR, receiver name shown in bank app, and paid date are required');
      }

      try {
        await api('/payments/' + paymentId + '/record-payout', {
          method: 'POST',
          body: { bankUtr, receiverNameShown, paidAt: new Date(paidAt).toISOString() },
        });
        showAlert('Payout recorded successfully');
        closeRecordPayoutModal();
        loadPayments();
      } catch (e) {
        showAlert('Recording payout failed: ' + e.message, false);
      }
    }

    async function promptResolvePayoutFlag(flagId) {
      const resolution = prompt('Enter resolution reason for this payout flag:');
      if (!resolution || !resolution.trim()) return;
      try {
        await api('/payments/review-flags/' + flagId + '/resolve', {
          method: 'POST',
          body: { resolution: resolution.trim() },
        });
        showAlert('Payout flag resolved');
        loadPayments();
      } catch (e) {
        showAlert('Resolving payout flag failed: ' + e.message, false);
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

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    async function loadRetentionSummary() {
      if (!currentUser || currentUser.role !== 'ceo') return;
      const contentEl = document.getElementById('retention-summary-content');
      contentEl.innerHTML = '<p style="color: var(--text-muted);">Loading latest retention summary...</p>';
      try {
        const summary = await api('/retention/summary');
        if (!summary) {
          contentEl.innerHTML = '<p style="color: var(--text-muted);">No retention run has been executed yet.</p>';
          return;
        }
        contentEl.innerHTML = \`
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px;">
            <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
              <span style="color: var(--text-muted); font-size: 0.8rem; display: block;">Last Executed</span>
              <strong style="color: var(--text);">\${new Date(summary.executedAt).toLocaleString('en-IN')}</strong>
            </div>
            <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
              <span style="color: var(--text-muted); font-size: 0.8rem; display: block;">Mode</span>
              <strong style="color: \${summary.dryRun ? '#38bdf8' : '#22c55e'};">\${summary.dryRun ? 'Dry Run (Simulation)' : 'Live Run'}</strong>
            </div>
            <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
              <span style="color: var(--text-muted); font-size: 0.8rem; display: block;">Profiles Anonymised</span>
              <strong style="color: var(--text);">\${(summary.profilesAnonymised?.jobSeekers || 0) + (summary.profilesAnonymised?.businesses || 0) + (summary.profilesAnonymised?.referrals || 0)} (JS: \${summary.profilesAnonymised?.jobSeekers || 0}, BZ: \${summary.profilesAnonymised?.businesses || 0}, RF: \${summary.profilesAnonymised?.referrals || 0})</strong>
            </div>
            <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
              <span style="color: var(--text-muted); font-size: 0.8rem; display: block;">Recordings Deleted / Protected</span>
              <strong style="color: var(--text);">\${summary.recordingsDeleted || 0} deleted / \${summary.recordingsProtected || 0} protected</strong>
            </div>
            <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
              <span style="color: var(--text-muted); font-size: 0.8rem; display: block;">Access Logs Deleted</span>
              <strong style="color: var(--text);">\${(summary.accessLogsDeleted?.sessions || 0) + (summary.accessLogsDeleted?.loginCodes || 0)}</strong>
            </div>
            <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
              <span style="color: var(--text-muted); font-size: 0.8rem; display: block;">Money Records Deleted</span>
              <strong style="color: var(--text);">\${(summary.moneyRecordsDeleted?.payments || 0) + (summary.moneyRecordsDeleted?.bankCredits || 0) + (summary.moneyRecordsDeleted?.invoices || 0) + (summary.moneyRecordsDeleted?.agreements || 0)}</strong>
            </div>
          </div>
        \`;
      } catch (e) {
        contentEl.innerHTML = \`<p style="color: var(--danger);">Failed to load summary: \${e.message}</p>\`;
      }
    }

    async function triggerRetentionDryRun() {
      if (!currentUser || currentUser.role !== 'ceo') return;
      const resultEl = document.getElementById('retention-dry-run-result');
      const btn = document.getElementById('btn-retention-dry-run');
      btn.disabled = true;
      btn.textContent = 'Running Dry Run...';
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<p style="color: var(--text-muted);">Simulating retention cleanup across database and storage...</p>';
      try {
        const res = await api('/retention/dry-run', { method: 'POST' });
        resultEl.innerHTML = \`
          <h4 style="color: #38bdf8; margin-top: 0; margin-bottom: 8px;">Dry Run Simulation Results</h4>
          <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 10px;">Simulation completed cleanly. No data was deleted or altered.</p>
          <ul style="font-size: 0.85rem; color: var(--text); line-height: 1.6; margin: 0; padding-left: 20px;">
            <li><strong>Profiles that would be anonymised:</strong> \${(res.profilesAnonymised?.jobSeekers || 0) + (res.profilesAnonymised?.businesses || 0) + (res.profilesAnonymised?.referrals || 0)} (Job Seekers: \${res.profilesAnonymised?.jobSeekers || 0}, Businesses: \${res.profilesAnonymised?.businesses || 0}, Referrals: \${res.profilesAnonymised?.referrals || 0})</li>
            <li><strong>Recordings that would be deleted:</strong> \${res.recordingsDeleted || 0} (\${res.recordingsProtected || 0} protected due to open claims/flags)</li>
            <li><strong>Access logs that would be pruned:</strong> \${(res.accessLogsDeleted?.sessions || 0) + (res.accessLogsDeleted?.loginCodes || 0)}</li>
            <li><strong>Money records that would be deleted (>8 yrs):</strong> \${(res.moneyRecordsDeleted?.payments || 0) + (res.moneyRecordsDeleted?.bankCredits || 0)}</li>
          </ul>
        \`;
        showAlert('Retention dry run completed successfully');
      } catch (e) {
        resultEl.innerHTML = \`<p style="color: var(--danger);">Dry run failed: \${e.message}</p>\`;
        showAlert('Dry run failed: ' + e.message, false);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Run Dry Run';
      }
    }

    let currentEditingEntityType = null;
    let currentEditingId = null;
    let currentEditingCode = null;
    let currentInitialValues = {};

    async function openRecordEditModal(entityType, id, code) {
      currentEditingEntityType = entityType;
      currentEditingId = id;
      currentEditingCode = code || id;
      currentInitialValues = {};

      const modal = document.getElementById('record-edit-modal');
      const title = document.getElementById('record-edit-title');
      const container = document.getElementById('record-edit-fields-container');
      const lockedNotice = document.getElementById('modal-edit-locked-notice');
      const reasonContainer = document.getElementById('modal-edit-reason-container');
      const reasonInput = document.getElementById('modal-edit-reason');
      const saveBtn = document.getElementById('btn-save-record-edit');
      const historySection = document.getElementById('modal-change-history-section');

      title.textContent = 'Edit ' + (entityType.replace('_', ' ').toUpperCase()) + ' · ' + currentEditingCode;
      lockedNotice.classList.add('hidden');
      reasonContainer.classList.add('hidden');
      reasonInput.value = '';
      container.innerHTML = '<p style="color: var(--text-muted);">Loading record...</p>';
      modal.classList.remove('hidden');

      try {
        let endpoint = '/job-seekers/' + encodeURIComponent(id);
        if (entityType === 'business') endpoint = '/businesses/' + encodeURIComponent(id);
        else if (entityType === 'referral') endpoint = '/referrals/' + encodeURIComponent(id);
        else if (entityType === 'vacancy') endpoint = '/vacancies/' + encodeURIComponent(id);
        else if (entityType === 'placement') endpoint = '/placements/' + encodeURIComponent(id);

        const data = await api(endpoint);

        // Check edit permission via /edit-policy/check
        let isLocked = false;
        try {
          const perm = await api('/edit-policy/check?entityType=' + encodeURIComponent(entityType) + '&id=' + encodeURIComponent(id));
          if (!perm.allowed && perm.reason && perm.reason.includes('Locked — money involved, ask your Team Lead')) {
            isLocked = true;
          }
        } catch (err) {
          if (err.message && err.message.includes('Locked — money involved, ask your Team Lead')) {
            isLocked = true;
          }
        }

        if (isLocked) {
          lockedNotice.classList.remove('hidden');
          saveBtn.disabled = true;
        } else {
          lockedNotice.classList.add('hidden');
          saveBtn.disabled = false;
        }

        // Render form fields and record initial values
        if (entityType === 'job_seeker') {
          currentInitialValues = {
            name: data.name || '',
            phone: data.phone || '',
            locality: data.locality || '',
            minSalary: data.minSalary !== undefined ? data.minSalary : '',
            maxSalary: data.maxSalary !== undefined ? data.maxSalary : '',
          };
          container.innerHTML = \`
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Name</label>
              <input type="text" id="edit-field-name" value="\${escapeHtml(currentInitialValues.name)}" \${isLocked ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Phone</label>
              <input type="text" id="edit-field-phone" value="\${escapeHtml(currentInitialValues.phone)}" \${isLocked ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Locality</label>
              <input type="text" id="edit-field-locality" value="\${escapeHtml(currentInitialValues.locality)}" \${isLocked ? 'disabled' : ''}>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
              <div class="form-group" style="flex: 1;">
                <label>Min Salary (Paise)</label>
                <input type="number" id="edit-field-minSalary" value="\${currentInitialValues.minSalary}" \${isLocked ? 'disabled' : ''}>
              </div>
              <div class="form-group" style="flex: 1;">
                <label>Max Salary (Paise)</label>
                <input type="number" id="edit-field-maxSalary" value="\${currentInitialValues.maxSalary}" \${isLocked ? 'disabled' : ''}>
              </div>
            </div>
          \`;
        } else if (entityType === 'business') {
          currentInitialValues = {
            name: data.name || '',
            phone: data.phone || '',
            locality: data.locality || '',
            ownerName: data.ownerName || '',
          };
          container.innerHTML = \`
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Business Name</label>
              <input type="text" id="edit-field-name" value="\${escapeHtml(currentInitialValues.name)}" \${isLocked ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Owner Name</label>
              <input type="text" id="edit-field-ownerName" value="\${escapeHtml(currentInitialValues.ownerName)}" \${isLocked ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Phone</label>
              <input type="text" id="edit-field-phone" value="\${escapeHtml(currentInitialValues.phone)}" \${isLocked ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Locality</label>
              <input type="text" id="edit-field-locality" value="\${escapeHtml(currentInitialValues.locality)}" \${isLocked ? 'disabled' : ''}>
            </div>
          \`;
        } else if (entityType === 'referral') {
          currentInitialValues = {
            name: data.name || '',
            phone: data.phone || '',
            city: data.city || '',
          };
          container.innerHTML = \`
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Referral Partner Name</label>
              <input type="text" id="edit-field-name" value="\${escapeHtml(currentInitialValues.name)}" \${isLocked ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Phone</label>
              <input type="text" id="edit-field-phone" value="\${escapeHtml(currentInitialValues.phone)}" \${isLocked ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label>City</label>
              <input type="text" id="edit-field-city" value="\${escapeHtml(currentInitialValues.city)}" \${isLocked ? 'disabled' : ''}>
            </div>
          \`;
        } else {
          currentInitialValues = {
            notes: data.notes || '',
          };
          container.innerHTML = \`
            <div class="form-group" style="margin-bottom: 8px;">
              <label>Notes</label>
              <textarea id="edit-field-notes" style="width: 100%; min-height: 80px;" \${isLocked ? 'disabled' : ''}>\${escapeHtml(currentInitialValues.notes)}</textarea>
            </div>
          \`;
        }

        // Attach listeners for Reason box
        container.querySelectorAll('input, textarea').forEach(input => {
          input.addEventListener('input', checkModalEditFieldsChanged);
          input.addEventListener('change', checkModalEditFieldsChanged);
        });

        // History: visible to Team Leads and above only
        const isLeadOrAbove = currentUser && ['team_lead', 'manager', 'ceo'].includes(currentUser.role);
        if (isLeadOrAbove) {
          historySection.classList.remove('hidden');
          loadRecordChangeHistory(entityType, currentEditingCode);
        } else {
          historySection.classList.add('hidden');
        }
      } catch (e) {
        container.innerHTML = '<p style="color: var(--danger);">Failed to load record: ' + e.message + '</p>';
      }
    }

    function checkModalEditFieldsChanged() {
      let savedValueChanged = false;
      for (const [key, initialVal] of Object.entries(currentInitialValues)) {
        const input = document.getElementById('edit-field-' + key);
        if (!input) continue;
        const currentVal = input.value.trim();
        const initStr = (initialVal !== null && initialVal !== undefined) ? String(initialVal).trim() : '';
        if (initStr !== '' && currentVal !== initStr) {
          savedValueChanged = true;
          break;
        }
      }
      const reasonContainer = document.getElementById('modal-edit-reason-container');
      if (savedValueChanged) {
        reasonContainer.classList.remove('hidden');
      } else {
        reasonContainer.classList.add('hidden');
      }
    }

    function closeRecordEditModal() {
      document.getElementById('record-edit-modal').classList.add('hidden');
      currentEditingEntityType = null;
      currentEditingId = null;
      currentEditingCode = null;
      currentInitialValues = {};
    }

    async function submitRecordEdit(e) {
      if (e) e.preventDefault();
      if (!currentEditingEntityType || !currentEditingId) return;

      const body = {};
      let savedValueChanged = false;
      for (const [key, initialVal] of Object.entries(currentInitialValues)) {
        const input = document.getElementById('edit-field-' + key);
        if (!input) continue;
        const currentVal = input.value.trim();
        const initStr = (initialVal !== null && initialVal !== undefined) ? String(initialVal).trim() : '';
        if (currentVal !== initStr) {
          if (initStr !== '') {
            savedValueChanged = true;
          }
          if (key === 'minSalary' || key === 'maxSalary') {
            body[key] = currentVal ? parseInt(currentVal, 10) : undefined;
          } else {
            body[key] = currentVal || undefined;
          }
        }
      }

      if (Object.keys(body).length === 0) {
        showAlert('No changes detected', false);
        return;
      }

      const reason = document.getElementById('modal-edit-reason').value.trim();
      if (savedValueChanged) {
        if (!reason) {
          showAlert('A reason is required when changing an existing saved value', false);
          return;
        }
        body.reason = reason;
      } else if (reason) {
        body.reason = reason;
      }

      try {
        let endpoint = '/job-seekers/' + encodeURIComponent(currentEditingId);
        if (currentEditingEntityType === 'business') endpoint = '/businesses/' + encodeURIComponent(currentEditingId);
        else if (currentEditingEntityType === 'referral') endpoint = '/referrals/' + encodeURIComponent(currentEditingId);
        else if (currentEditingEntityType === 'vacancy') endpoint = '/vacancies/' + encodeURIComponent(currentEditingId);
        else if (currentEditingEntityType === 'placement') endpoint = '/placements/' + encodeURIComponent(currentEditingId);

        await api(endpoint, { method: 'PATCH', body });
        showAlert('Record updated successfully');
        closeRecordEditModal();
        if (currentTab === 'job-seekers') loadJobSeekers();
        else if (currentTab === 'businesses') loadBusinesses();
        else if (currentTab === 'referrals') loadReferrals();
        else if (currentTab === 'vacancies') loadVacancies();
        else if (currentTab === 'placements') loadPlacements();
      } catch (err) {
        showAlert('Update failed: ' + err.message, false);
      }
    }

    async function loadRecordChangeHistory(entityType, code) {
      const tbody = document.getElementById('modal-change-history-tbody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Loading history...</td></tr>';
      try {
        const logs = await api('/audit-logs?entityType=' + encodeURIComponent(entityType) + '&entityCode=' + encodeURIComponent(code));
        if (!logs || !logs.length) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No changes recorded</td></tr>';
          return;
        }
        tbody.innerHTML = logs.map(l => \`
          <tr>
            <td><strong>\${escapeHtml(l.actor?.name || l.actor?.code || 'Staff')}</strong></td>
            <td>\${new Date(l.createdAt).toLocaleString('en-IN')}</td>
            <td><code style="color: #38bdf8;">\${escapeHtml(Array.isArray(l.changedFields) ? l.changedFields.join(', ') : '—')}</code></td>
            <td>\${escapeHtml(l.reason || '—')}</td>
          </tr>
        \`).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" style="color: var(--danger); text-align: center;">Failed to load history: ' + escapeHtml(err.message) + '</td></tr>';
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
