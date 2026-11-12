import { staffLoginFieldsHtml, staffLoginHandlersJs } from './staff-login-ui';

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

  <!-- Field Agent Follow-up Completion Modal -->
  <div id="fa-follow-up-modal" class="auth-overlay hidden">
    <div class="modal" style="max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="font-size: 1.15rem; margin: 0; color: var(--primary);">Complete Follow-up Task</h3>
        <button type="button" class="btn-sm" onclick="closeFaFollowUpModal()">✕ Close</button>
      </div>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">Calls must be answered and recorded.</p>
      <input type="hidden" id="fa-complete-task-id">
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Answered Call Record ID *</label>
        <input type="text" id="fa-follow-up-call-record-id" placeholder="CR-00001 or Call Record UUID">
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Answer *</label>
        <select id="fa-follow-up-answer" onchange="onFaFollowUpAnswerChange()">
          <option value="working_elsewhere">Working elsewhere</option>
          <option value="not_working">Not working</option>
          <option value="working_at_introduced_business">Working at introduced business</option>
          <option value="no_answer">No answer</option>
        </select>
      </div>
      <div class="form-group hidden" id="fa-follow-up-introduced-business-group" style="margin-bottom: 10px;">
        <label>Introduced Business *</label>
        <select id="fa-follow-up-introduced-business">
          <option value="">Select introduced business...</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 12px;">
        <label>Notes</label>
        <textarea id="fa-follow-up-notes" rows="3" placeholder="Candidate response details..."></textarea>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" class="btn-secondary btn-sm" onclick="closeFaFollowUpModal()">Cancel</button>
        <button type="button" class="btn-sm" onclick="submitFaCompleteFollowUp()">Complete Task</button>
      </div>
    </div>
  </div>

  <!-- Field Agent Claim Form Modal -->
  <div id="fa-claim-modal" class="auth-overlay hidden">
    <div class="modal" style="max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="font-size: 1.15rem; margin: 0; color: var(--primary);">Report Replacement Claim</h3>
        <button type="button" class="btn-sm" onclick="closeFaClaimModal()">✕ Close</button>
      </div>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">Claim can only be reported after an answered call with the business owner.</p>
      <input type="hidden" id="fa-claim-placement-id">
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Answered Owner Call Record ID *</label>
        <input type="text" id="fa-claim-call-record-id" placeholder="CR-00001 or Call Record UUID">
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Worker Left On (Date) *</label>
        <input type="date" id="fa-claim-worker-left-on">
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Reason *</label>
        <select id="fa-claim-reason">
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
        <textarea id="fa-claim-notes" rows="3" placeholder="Owner statements and reason details..."></textarea>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" class="btn-secondary btn-sm" onclick="closeFaClaimModal()">Cancel</button>
        <button type="button" class="btn-sm" onclick="submitFaClaim()">Submit Claim</button>
      </div>
    </div>
  </div>

  <!-- Profile & Calling Modal -->
  <div id="fa-calling-modal" class="auth-overlay hidden">
    <div class="modal" style="max-width: 650px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 id="fa-calling-title" style="font-size: 1.15rem; margin: 0; color: var(--primary);">Profile & Calling</h3>
        <button type="button" class="btn-sm" onclick="closeFaCallingModal()">✕ Close</button>
      </div>

      <!-- Profile details -->
      <div style="background: #0f172a; padding: 12px; border-radius: 6px; margin-bottom: 12px; border: 1px solid var(--card-border);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong id="fa-profile-name" style="font-size: 1.05rem;">—</strong>
          <span id="fa-profile-code" class="badge">—</span>
        </div>
        <div style="font-size: 0.9rem; color: #94a3b8;">
          Phone: <strong id="fa-profile-phone" style="color: var(--text);">—</strong>
          <span style="margin: 0 6px;">•</span>
          Status: <span id="fa-profile-status">—</span>
        </div>

        <!-- Phase 18 Task 5: Payout Details & Send Link -->
        <div id="fa-profile-payout-row" style="font-size: 0.9rem; color: #94a3b8; margin-top: 6px;">
          Payout Details: <span id="fa-profile-payout-status" class="badge">None on file</span>
          <button type="button" id="fa-btn-send-payout-link" class="btn-sm" style="margin-left: 8px;" onclick="sendFaProfilePayoutLink()">Send payout details link</button>
        </div>

        <!-- Blocked calling alert notice -->
        <div id="fa-call-blocked-alert" style="display: none; background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); color: #fca5a5; padding: 8px 12px; border-radius: 4px; font-size: 0.85rem; margin-top: 8px;">
        </div>

        <!-- Call controls -->
        <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
          <select id="fa-call-purpose" style="max-width: 180px;">
            <option value="general">General</option>
            <option value="offer">Offer</option>
            <option value="follow_up">Follow Up</option>
            <option value="verification">Verification</option>
            <option value="exit_call">Exit Call</option>
            <option value="check_in">Check In</option>
            <option value="interview_result">Interview Result</option>
            <option value="refund_check">Refund Check</option>
          </select>
          <button type="button" id="btn-fa-call" class="btn-call" onclick="triggerFaCall()">Call</button>
        </div>

        <!-- Active Call / Outcome Card -->
        <div id="fa-call-progress-section" style="display: none; margin-top: 14px; padding: 12px; background: #1e293b; border-radius: 6px;">
          <div id="fa-call-status-msg" style="font-size: 0.9rem; font-weight: 500; margin-bottom: 8px;">Call placed...</div>
          
          <!-- Answered Call Outcome Form (Closed List) -->
          <div id="fa-answered-outcome-form" style="display: none;">
            <label style="font-size: 0.85rem; color: var(--primary); font-weight: bold; margin-bottom: 4px; display: block;">Record Call Outcome</label>
            <select id="fa-call-outcome" style="margin-bottom: 8px;">
              <option value="interested">Interested</option>
              <option value="accepted_offer">Accepted Offer</option>
              <option value="rejected_offer">Rejected Offer</option>
              <option value="callback_requested">Callback Requested</option>
              <option value="not_interested">Not Interested</option>
              <option value="working_now">Working Now</option>
              <option value="other">Other</option>
            </select>
            <input type="text" id="fa-call-outcome-reason" placeholder="Outcome reason (optional)" style="margin-bottom: 8px;">
            <button type="button" class="btn-sm" onclick="submitFaOutcome()">Submit Outcome</button>
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
              </tr>
            </thead>
            <tbody id="fa-history-tbody">
              <tr><td colspan="6">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Profile Edit Section -->
      <div id="fa-edit-profile-section" style="margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 0.9rem; font-weight: bold; color: var(--primary);">Edit Profile</span>
        </div>

        <div id="fa-edit-locked-notice" class="alert alert-danger" style="display: none; margin-bottom: 8px; font-size: 0.85rem; font-weight: bold;">
          Locked — money involved, ask your Team Lead
        </div>

        <div id="fa-edit-inputs-container">
          <div class="form-group" style="margin-bottom: 6px;">
            <label style="font-size: 0.8rem;">Name</label>
            <input type="text" id="fa-edit-name" style="font-size: 0.85rem;">
          </div>
          <div class="form-group" style="margin-bottom: 6px;">
            <label style="font-size: 0.8rem;">Phone</label>
            <input type="text" id="fa-edit-phone" style="font-size: 0.85rem;">
          </div>
          <div class="form-group" style="margin-bottom: 6px;">
            <label style="font-size: 0.8rem;">Locality</label>
            <input type="text" id="fa-edit-locality" style="font-size: 0.85rem;">
          </div>
        </div>

        <!-- Reason box: shown only when saved value is changed -->
        <div id="fa-edit-reason-container" style="display: none; margin-top: 8px; background: #1e293b; padding: 8px; border-radius: 4px; border: 1px solid #f59e0b;">
          <label style="color: #f59e0b; font-size: 0.8rem; font-weight: bold; display: block; margin-bottom: 4px;">Reason for change (required when changing saved values):</label>
          <input type="text" id="fa-edit-reason" placeholder="e.g. Corrected candidate phone number" style="width: 100%; font-size: 0.85rem;">
        </div>

        <div style="margin-top: 8px; display: flex; justify-content: flex-end;">
          <button type="button" id="fa-btn-save-edit" class="btn-sm btn-success" onclick="submitFaProfileEdit()">Save Profile</button>
        </div>

        <!-- Change History: Team Leads and above only -->
        <div id="fa-change-history-section" style="display: none; margin-top: 14px; border-top: 1px solid var(--border); padding-top: 10px;">
          <h4 style="font-size: 0.85rem; margin-bottom: 6px; color: var(--text);">Change History</h4>
          <div style="max-height: 150px; overflow-y: auto;">
            <table class="change-history-table" style="font-size: 0.75rem; width: 100%;">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>When</th>
                  <th>Which Fields</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody id="fa-change-history-tbody">
                <tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No changes recorded</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>

  <header>
    <div>
      <h1>Laboura Field Agent App</h1>
      <span style="font-size: 0.75rem; color: var(--text-muted);">City-wide assignments</span>
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
    <button class="tab-btn" data-tab="visits">Check in & Visits</button>
    <button class="tab-btn" data-tab="vacancy-capture">Capture Vacancy</button>
    <button class="tab-btn" data-tab="shortlist-interview">Shortlist & Interview</button>
    <button class="tab-btn" data-tab="my-interviews">My Interviews</button>
    <button class="tab-btn" data-tab="follow-ups">My Follow-ups</button>
    <a href="/map" class="map-nav-link" style="align-self:center;color:var(--text-muted);padding:10px 12px;font-weight:600;white-space:nowrap">Map</a>
  </nav>

  <main>
    <div id="status-alert" class="alert hidden"></div>

    <!-- 1. Priority Dashboard Screen (Field Agent's Daily-Use Screen) -->
    <div id="view-priority-dashboard" class="tab-view">
      <!-- Live Priority Sub-Nav -->
      <div style="display: flex; gap: 8px; margin-bottom: 16px;">
        <button class="btn-sm" id="subtab-btn-candidates" onclick="showPrioritySubTab('candidates')">Candidate Urgency (City-wide)</button>
        <button class="btn-sm btn-secondary" id="subtab-btn-vacancies" onclick="showPrioritySubTab('vacancies')">Vacancy Priority (City-wide)</button>
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="priority-candidates-tbody">
              <tr><td colspan="8" style="text-align: center;">Loading candidate urgency...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Vacancy Priority List (City-wide) -->
      <div id="priority-sub-vacancies" class="card hidden">
        <div class="card-title">
          <span>Vacancy Priority List (City-wide)</span>
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

      <!-- Trade Supply/Demand Board (City-wide) -->
      <div id="priority-sub-trades" class="card hidden">
        <div class="card-title">
          <span>Trade Supply / Demand Board (City-wide)</span>
          <span style="font-size: 0.8rem; color: var(--text-muted);">Surplus-candidate vs Surplus-vacancy trades at a glance</span>
        </div>
        <div id="trade-board-container" class="grid-board">
          <div style="color: var(--text-muted);">Loading trade supply/demand...</div>
        </div>
      </div>
    </div>

    <div id="view-visits" class="tab-view hidden">
      <div class="card">
        <div class="card-title"><span>Daily check-in</span></div>
        <p>Check in once when you are ready for visits. Location is recorded only for this check-in event.</p>
        <button id="fa-check-in-button" onclick="checkInForVisits()">Check in</button>
        <div id="fa-check-in-status" aria-live="polite"></div>
      </div>
      <div class="card">
        <div class="card-title"><span>My verification assignments</span><button class="btn-sm" onclick="loadMyAssignments()">Refresh</button></div>
        <div id="fa-assignment-list">Load assignments to begin.</div>
      </div>
      <div class="card" id="fa-visit-step" hidden>
        <div class="card-title"><span>Visit and confirm owner presence</span></div>
        <input type="hidden" id="fa-visit-business-id"><input type="hidden" id="fa-visit-assignment-id">
        <div id="fa-visit-business-label"></div>
        <button type="button" onclick="requestOwnerPresenceOtp()">Send owner presence OTP</button>
        <div class="form-group"><label>Owner OTP</label><input id="fa-owner-otp-code" inputmode="numeric" autocomplete="one-time-code"></div>
        <div class="form-group"><label>Storefront photo from this visit</label><input type="file" id="fa-visit-photo" accept="image/*" capture="environment"></div>
        <button onclick="completeVerificationVisit()">Complete verification visit</button>
      </div>
    </div>

    <!-- 2. Business Onboarding (Camera-Only Selfie Capture) -->
    <div id="view-onboard-biz" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>In-Person Business Registration</span>
        </div>
        <div style="max-width: 600px;">
          <div class="form-group">
            <label>Business Name</label>
            <input type="text" id="fa-biz-name" placeholder="Cafe Coffee Day Koramangala">
          </div>
          <div class="form-group"><label>Business type</label><select id="fa-biz-type"><option value="restaurant">Restaurant</option><option value="retail">Retail</option><option value="factory">Factory</option><option value="office">Office</option><option value="warehouse">Warehouse</option><option value="household">Household</option><option value="other">Other</option></select></div>
          <div class="form-group"><label>Owner name</label><input id="fa-biz-owner-name"></div>
          <div class="form-group">
            <label>Business Phone (10 digits)</label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="fa-biz-phone" placeholder="98XXXXXXXX">
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
            <label>Locality</label>
            <input type="text" id="fa-biz-locality" placeholder="Type the business locality">
          </div>
          <div class="form-group">
            <label>Address</label>
            <input type="text" id="fa-biz-address" placeholder="100 80ft Road, 4th Block">
          </div>
          <div class="form-group"><label>Licence number <small>(only if they have it)</small></label><input id="fa-biz-licence"></div>
          <div class="form-group"><label>GST number <small>(only if they have it)</small></label><input id="fa-biz-gst"></div>
          <div class="form-group"><label>Shop and Establishment number <small>(only if they have it)</small></label><input id="fa-biz-shop"></div>
          <div class="form-group"><label>Udyam number <small>(only if they have it)</small></label><input id="fa-biz-udyam"></div>
          <div class="form-group"><label>PAN <small>(only if they have it)</small></label><input id="fa-biz-pan"></div>
          <div class="form-group"><label>Storefront photo</label><input type="file" id="fa-storefront-photo" accept="image/*" capture="environment"></div>
          <div class="form-group"><label>Billing name</label><input id="fa-biz-billing-name"></div>
          <div class="form-group"><label>Billing address</label><textarea id="fa-biz-billing-address"></textarea></div>
          <div id="fa-biz-documents-status" aria-live="polite">Registration numbers are optional; only enter them if the business has them.</div>

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
          <span>Capture Vacancy for Business</span>
        </div>
        <div style="max-width: 550px;">
          <div class="form-group">
            <label>Business Code or ID</label>
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
          <div class="form-group"><label>Role title</label><input id="fa-vc-role-title"></div>
          <div class="form-group"><label>Salary maximum (₹)</label><input type="number" id="fa-vc-salary-max"></div>
          <div class="form-group"><label>Salary period</label><select id="fa-vc-salary-period"><option value="monthly">Monthly</option><option value="daily">Daily</option></select></div>
          <div class="form-group"><label>Extras</label><select id="fa-vc-extras" multiple><option value="overtime">Overtime</option><option value="incentives">Incentives</option><option value="food">Food</option><option value="accommodation">Accommodation</option><option value="transport">Transport</option><option value="uniform">Uniform</option><option value="pf_esi">PF/ESI</option></select></div>
          <div class="form-group"><label>Working hours</label><input id="fa-vc-hours"></div>
          <div class="form-group"><label>Shift</label><input id="fa-vc-shift"></div>
          <div class="form-group"><label>Weekly off</label><input id="fa-vc-weekly-off"></div>
          <div class="form-group"><label>Locality</label><input id="fa-vc-locality"></div>
          <div class="form-group"><label>Latitude (optional)</label><input type="number" id="fa-vc-latitude" step="any"></div>
          <div class="form-group"><label>Longitude (optional)</label><input type="number" id="fa-vc-longitude" step="any"></div>
          <div class="form-group"><label>Experience required (years)</label><input type="number" id="fa-vc-experience" min="0"></div>
          <div class="form-group"><label>Education required</label><input id="fa-vc-education"></div>
          <div class="form-group"><label>Languages required (comma separated)</label><input id="fa-vc-languages"></div>
          <div class="form-group"><label>Licences required (comma separated)</label><input id="fa-vc-licences"></div>
          <div class="form-group"><label>Minimum age</label><input type="number" id="fa-vc-age-min"></div>
          <div class="form-group"><label>Maximum age</label><input type="number" id="fa-vc-age-max"></div>
          <div class="form-group"><label>Gender requirement</label><select id="fa-vc-gender"><option value="none">None</option><option value="male">Male</option><option value="female">Female</option></select></div>
          <div class="form-group"><label>Reason for gender requirement</label><input id="fa-vc-gender-reason"></div>
          <div class="form-group"><label>Start date</label><input type="date" id="fa-vc-start-date"></div>
          <div class="form-group"><label>Urgency</label><select id="fa-vc-urgency"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div>
          <div class="form-group"><label>Probation (days)</label><input type="number" id="fa-vc-probation" min="0"></div>
          <div class="form-group"><label>Interview type</label><select id="fa-vc-interview-type"><option value="walk_in">Walk-in</option><option value="scheduled">Scheduled</option></select></div>
          <div class="form-group"><label>Walk-in day</label><input type="date" id="fa-vc-walk-in-date"></div>
          <div class="form-group"><label>Interview contact name</label><input id="fa-vc-interview-contact"></div>
          <div class="form-group"><label>Scheduled slot start</label><input type="datetime-local" id="fa-vc-slot-start"></div>
          <div class="form-group"><label>Scheduled slot end</label><input type="datetime-local" id="fa-vc-slot-end"></div>
          <div class="form-group"><label>Scheduled slot capacity</label><input type="number" id="fa-vc-slot-capacity" min="1" value="1"></div>
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
          <span>Matching Candidate Cards</span>
        </div>
        <div style="display: flex; gap: 10px; margin-bottom: 16px;">
          <input type="text" id="fa-shortlist-vc-id" placeholder="Enter Vacancy ID or Code (e.g. VC-00001)" style="max-width: 400px;">
          <button onclick="loadFieldShortlist()">Fetch top matches</button>
        </div>
        <div id="fa-shortlist-left-out" aria-live="polite"></div>
        <div id="fa-shortlist-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:16px 0">
          <p>Enter a vacancy ID to load matching candidates.</p>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button id="fa-shortlist-next" class="btn-secondary" onclick="loadFieldShortlistPage(faShortlistPage + 1)" hidden>Show next 3</button>
          <label for="fa-shortlist-channel">Message channel</label>
          <select id="fa-shortlist-channel"><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select>
          <button onclick="showFieldSelectedInPerson()">Shown in person</button>
          <button class="btn-success" onclick="sendFieldSelectedToOwner()">Send to owner</button>
        </div>
      </div>
    </div>

    <div id="view-my-interviews" class="tab-view hidden">
      <div class="card">
        <div class="card-title"><span>My Interviews</span><button class="btn-sm" onclick="loadFieldInterviews()">Refresh</button></div>
        <div style="display:flex;gap:10px;margin-bottom:12px"><input id="fa-interview-filter-vacancy" placeholder="Filter by vacancy ID or code"><button onclick="loadFieldInterviews()">Filter</button></div>
        <div id="fa-interview-list" aria-live="polite">Load interviews to see reply and result deadlines.</div>
      </div>
    </div>

    <!-- My Follow-ups View -->
    <div id="view-follow-ups" class="tab-view hidden">
      <div class="card">
        <div class="card-title">
          <span>My Follow-up Tasks</span>
          <button class="btn-sm" onclick="loadFaFollowUps()">Refresh</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Calls must be answered and recorded. Record candidate status; if working at an introduced business, select which one.</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Task Code</th>
                <th>Candidate</th>
                <th>Kind</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="fa-follow-ups-tbody">
              <tr><td colspan="6" style="text-align: center;">Loading follow-up tasks...</td></tr>
            </tbody>
          </table>
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
        if (tab === 'visits') loadMyAssignments();
        if (tab === 'my-interviews') loadFieldInterviews();
        if (tab === 'follow-ups') loadFaFollowUps();
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
              <td>\${c.trades?.length ? c.trades.find(t => t.isPrimary)?.trade : c.tradeSkill}</td>
              <td>₹\${(c.minSalary/100).toLocaleString()} - ₹\${(c.maxSalary/100).toLocaleString()}</td>
              <td><span class="badge \${bandClass}">\${bandName.toUpperCase()}</span></td>
              <td>
                \${isTwoHit ? '<span class="badge badge-2hit">⚠️ 2 HITS — AT RISK</span>' : \`\${c.candidate?.hitCount || 0} hits\`}
              </td>
              <td>\${deadline ? new Date(deadline).toLocaleDateString() : '—'}</td>
              <td><button class="btn-sm btn-call" onclick="openFaCalling('job_seeker', '\${c.candidateId || c.id}', '\${c.code}', '\${c.name}')">Call</button></td>
            </tr>
          \`;
        }).join('') || '<tr><td colspan="8">No urgent candidates found</td></tr>';

        // 2. Vacancy Priority List (City-wide, directly calling /priority/vacancies)
        const vacancies = await api('/priority/vacancies');
        const vTbody = document.getElementById('priority-vacancies-tbody');
        vTbody.innerHTML = vacancies.map(v => {
          const isReplacement = Boolean(v.replacementForPlacementId);
          return \`
            <tr style="\${isReplacement ? 'background: #2e1065;' : ''}">
              <td><strong>\${v.code}</strong></td>
              <td>\${v.business ? v.business.name : v.businessId}</td>
              <td>\${v.tradeSkill}</td>
              <td>₹\${(v.salaryMinPaise/100).toLocaleString()}</td>
              <td>
                \${isReplacement ? '<span class="badge badge-replacement">REPLACEMENT (IN-WINDOW)</span>' : '<span class="badge">FRESH</span>'}
              </td>
              <td>\${v.replacementDeadline ? new Date(v.replacementDeadline).toLocaleDateString() : '—'}</td>
            </tr>
          \`;
        }).join('') || '<tr><td colspan="6">No priority vacancies in this city</td></tr>';

        // 3. Trade Supply / Demand Board (City-wide, directly calling /priority/trades)
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
        // OTP test mode (pretend vendors): the server sends the code back to show.
        showAlert(res.testModeBanner ? res.testModeBanner : 'OTP sent to ' + phone);
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

        const locality = document.getElementById('fa-biz-locality').value.trim();
        const lat = agentLat || 12.9352;
        const lon = agentLon || 77.6245;

        const body = {
          name: document.getElementById('fa-biz-name').value.trim(),
          phone: document.getElementById('fa-biz-phone').value.trim(),
          businessType: document.getElementById('fa-biz-type').value,
          ownerName: document.getElementById('fa-biz-owner-name').value.trim() || undefined,
          address: document.getElementById('fa-biz-address').value.trim(),
          locality,
          gstNumber: document.getElementById('fa-biz-gst').value.trim() || undefined,
          licenceNumber: document.getElementById('fa-biz-licence').value.trim() || undefined,
          shopEstablishmentNumber: document.getElementById('fa-biz-shop').value.trim() || undefined,
          udyamNumber: document.getElementById('fa-biz-udyam').value.trim() || undefined,
          pan: document.getElementById('fa-biz-pan').value.trim() || undefined,
          billingName: document.getElementById('fa-biz-billing-name').value.trim() || undefined,
          billingAddress: document.getElementById('fa-biz-billing-address').value.trim() || undefined,
          latitude: lat,
          longitude: lon,
          visitLatitude: lat,
          visitLongitude: lon,
          selfieUrl: capturedSelfieUrl || 'https://cdn.laboura.local/selfies/camera.jpg',
          selfieHash: capturedSelfieHash,
          otpRequestId: bizOtpRequestId,
        };

        const res = await api('/businesses', { method: 'POST', body });
        const photo = document.getElementById('fa-storefront-photo').files?.[0];
        if (photo) {
          const form = new FormData(); form.append('photo', photo);
          const upload = await fetch('/businesses/' + res.id + '/storefront-photo', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
          if (!upload.ok) throw new Error((await upload.json().catch(() => ({}))).message || 'Storefront photo upload failed');
        }
        document.getElementById('fa-biz-documents-status').textContent =
          (body.gstNumber || body.licenceNumber || body.shopEstablishmentNumber || body.udyamNumber || body.pan) ? 'Documents: documented' : 'Documents: no documents';
        showAlert('Business onboarded: ' + res.code + '. Documents: ' + (body.gstNumber || body.licenceNumber || body.shopEstablishmentNumber || body.udyamNumber || body.pan ? 'documented' : 'no documents'));
        document.getElementById('fa-vc-biz-id').value = res.id;
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function submitFieldVacancy() {
      const bizId = document.getElementById('fa-vc-biz-id').value.trim();
      const tradeSkill = document.getElementById('fa-vc-trade').value.trim();
      const salaryMinPaise = Number(document.getElementById('fa-vc-salary').value) * 100;
      const headcount = Number(document.getElementById('fa-vc-headcount').value);
      const description = document.getElementById('fa-vc-desc').value.trim();
      const csv = (id) => document.getElementById(id).value.split(',').map(v => v.trim()).filter(Boolean);
      const extras = Array.from(document.getElementById('fa-vc-extras').selectedOptions).map(option => option.value);
      const interviewType = document.getElementById('fa-vc-interview-type').value;
      const slotStart = document.getElementById('fa-vc-slot-start').value;
      const slotEnd = document.getElementById('fa-vc-slot-end').value;

      if (!bizId || !tradeSkill || !salaryMinPaise) return alert('Fill required vacancy fields');
      try {
        const res = await api('/businesses/' + bizId + '/vacancies', {
          method: 'POST',
          body: {
            tradeSkill, salaryMinPaise, salaryMaxPaise: Number(document.getElementById('fa-vc-salary-max').value) * 100 || undefined,
            salaryPeriod: document.getElementById('fa-vc-salary-period').value, headcount, description,
            roleTitle: document.getElementById('fa-vc-role-title').value.trim() || undefined, extras,
            workingHours: document.getElementById('fa-vc-hours').value.trim() || undefined,
            shift: document.getElementById('fa-vc-shift').value.trim() || undefined,
            weeklyOff: document.getElementById('fa-vc-weekly-off').value.trim() || undefined,
            locality: document.getElementById('fa-vc-locality').value.trim() || undefined,
            latitude: document.getElementById('fa-vc-latitude').value ? Number(document.getElementById('fa-vc-latitude').value) : undefined,
            longitude: document.getElementById('fa-vc-longitude').value ? Number(document.getElementById('fa-vc-longitude').value) : undefined,
            experienceRequiredYears: Number(document.getElementById('fa-vc-experience').value) || undefined,
            educationRequired: document.getElementById('fa-vc-education').value.trim() || undefined,
            languagesRequired: csv('fa-vc-languages'), licencesRequired: csv('fa-vc-licences'),
            ageMin: Number(document.getElementById('fa-vc-age-min').value) || undefined, ageMax: Number(document.getElementById('fa-vc-age-max').value) || undefined,
            genderRequirement: document.getElementById('fa-vc-gender').value, genderReason: document.getElementById('fa-vc-gender-reason').value.trim() || undefined,
            startDate: document.getElementById('fa-vc-start-date').value || undefined,
            urgency: document.getElementById('fa-vc-urgency').value,
            probationDays: Number(document.getElementById('fa-vc-probation').value) || undefined,
            interviewType,
            interviewContactName: document.getElementById('fa-vc-interview-contact').value.trim() || undefined,
            walkInDate: document.getElementById('fa-vc-walk-in-date').value || undefined,
            interviewSlots: interviewType === 'scheduled' && slotStart && slotEnd ? [{ startsAt: new Date(slotStart).toISOString(), endsAt: new Date(slotEnd).toISOString(), capacity: Number(document.getElementById('fa-vc-slot-capacity').value) }] : undefined
          }
        });
        showAlert('Vacancy captured: ' + res.code);
        document.getElementById('fa-shortlist-vc-id').value = res.id;
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    function browserLocation() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Location is unavailable on this device'));
        navigator.geolocation.getCurrentPosition(
          position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }),
          () => reject(new Error('Location permission is required for this action')),
          { enableHighAccuracy: true, timeout: 15000 }
        );
      });
    }

    async function checkInForVisits() {
      try {
        const location = await browserLocation();
        const result = await api('/field-agent/check-in', { method: 'POST', body: location });
        document.getElementById('fa-check-in-status').textContent = 'Checked in at ' + new Date(result.checkedInAt).toLocaleTimeString();
      } catch (e) { document.getElementById('fa-check-in-status').textContent = e.message; }
    }

    async function loadMyAssignments() {
      try {
        const rows = await api('/businesses/visit-assignments');
        const target = document.getElementById('fa-assignment-list');
        target.replaceChildren();
        if (!rows.length) { target.textContent = 'No open visit assignments.'; return; }
        rows.forEach(assignment => {
          const row = document.createElement('div');
          row.className = 'board-card';
          row.textContent = assignment.business.code + ' · ' + assignment.business.name + ' · ' + (assignment.business.locality || '') + ' · ' + assignment.purpose;
          const button = document.createElement('button'); button.textContent = 'Start visit'; button.className = 'btn-sm';
          button.addEventListener('click', () => {
            document.getElementById('fa-visit-business-id').value = assignment.business.id;
            document.getElementById('fa-visit-assignment-id').value = assignment.id;
            document.getElementById('fa-visit-business-label').textContent = assignment.business.code + ' · ' + assignment.business.name;
            document.getElementById('fa-visit-step').hidden = false;
          });
          row.appendChild(button); target.appendChild(row);
        });
      } catch (e) { document.getElementById('fa-assignment-list').textContent = e.message; }
    }

    let ownerOtpRequestId = '';
    async function requestOwnerPresenceOtp() {
      try {
        const businessId = document.getElementById('fa-visit-business-id').value;
        const assignmentId = document.getElementById('fa-visit-assignment-id').value;
        const result = await api('/businesses/' + businessId + '/visit-assignments/' + assignmentId + '/owner-otp', { method: 'POST', body: {} });
        ownerOtpRequestId = result.requestId;
        showAlert('Presence code sent to owner ending ' + result.phone.slice(-4));
      } catch (e) { showAlert(e.message, false); }
    }

    async function completeVerificationVisit() {
      try {
        if (!ownerOtpRequestId) throw new Error('Send the owner presence OTP first');
        const file = document.getElementById('fa-visit-photo').files?.[0];
        if (!file) throw new Error('Take a storefront photo during the visit');
        const location = await browserLocation();
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const photoHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        const result = await api('/businesses/' + document.getElementById('fa-visit-business-id').value + '/visits', { method: 'POST', body: {
          ...location, selfieUrl: dataUrl, selfieHash: photoHash, ownerOtpRequestId,
          ownerOtpCode: document.getElementById('fa-owner-otp-code').value.trim(), assignmentId: document.getElementById('fa-visit-assignment-id').value,
          purpose: 'verification'
        }});
        document.getElementById('fa-visit-step').hidden = true;
        ownerOtpRequestId = '';
        showAlert('Visit recorded. Business status: ' + result.verificationStatus);
        loadMyAssignments();
      } catch (e) { showAlert(e.message, false); }
    }

    let faShortlistPage = 1;
    let faShortlistPageCount = 1;
    let faShortlistSelectedIds = new Set();

    async function loadFieldShortlist() {
      faShortlistSelectedIds = new Set();
      await loadFieldShortlistPage(1);
    }

    async function loadFieldShortlistPage(page) {
      const vcId = document.getElementById('fa-shortlist-vc-id').value.trim();
      if (!vcId) return alert('Vacancy ID required');
      try {
        const data = await api('/vacancies/' + encodeURIComponent(vcId) + '/shortlist?page=' + page);
        faShortlistPage = data.page;
        faShortlistPageCount = Math.ceil(data.total / data.pageSize);
        const container = document.getElementById('fa-shortlist-cards');
        container.replaceChildren();
        data.matches.forEach(match => {
          const card = match.card;
          const article = document.createElement('article');
          article.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--card-bg)';
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = faShortlistSelectedIds.has(match.jobSeekerId);
          checkbox.addEventListener('change', () => checkbox.checked ? faShortlistSelectedIds.add(match.jobSeekerId) : faShortlistSelectedIds.delete(match.jobSeekerId));
          label.append(checkbox, document.createTextNode(' Select candidate'));
          article.appendChild(label);
          if (card.photoUrl) { const photo = document.createElement('img'); photo.src = card.photoUrl; photo.alt = 'Candidate photo'; photo.width = 72; photo.height = 72; photo.style.cssText = 'display:block;object-fit:cover;border-radius:50%;margin:10px 0'; article.appendChild(photo); }
          const title = document.createElement('h3'); title.textContent = card.firstName + ', ' + card.age; article.appendChild(title);
          [card.trade + ' · ' + card.yearsExperience + ' yrs', card.languages.join(', '), card.distanceKm + ' km away', '₹' + (card.expectedSalary.minPaise / 100).toLocaleString('en-IN') + ' – ₹' + (card.expectedSalary.maxPaise / 100).toLocaleString('en-IN'), match.matchReasons.join(' · ')].filter(Boolean).forEach(value => { const row = document.createElement('p'); row.textContent = value; article.appendChild(row); });
          const book = document.createElement('button'); book.textContent = 'Book interview'; book.className = 'btn-success';
          book.addEventListener('click', () => bookFieldInterviewFromCard(vcId, match.jobSeekerId, article)); article.appendChild(book);
          container.appendChild(article);
        });
        if (!data.matches.length) { const empty = document.createElement('p'); empty.textContent = 'No matching candidates on this page.'; container.appendChild(empty); }
        const leftOut = data.leftOut;
        document.getElementById('fa-shortlist-left-out').textContent = 'Left out — no location: ' + leftOut.no_location + ' (complete home location); no travel distance: ' + leftOut.no_travel_distance + ' (complete travel distance); consent missing: ' + leftOut.consent_missing + ' (confirm matching and profile sharing consent).';
        document.getElementById('fa-shortlist-next').hidden = faShortlistPage >= faShortlistPageCount;
      } catch (e) { showAlert(e.message, false); }
    }

    async function submitFieldIntroductions(path, body, successMessage) {
      const vcId = document.getElementById('fa-shortlist-vc-id').value.trim();
      if (!vcId) return showAlert('Vacancy ID required', false);
      if (!faShortlistSelectedIds.size) return showAlert('Select at least one candidate', false);
      try {
        const result = await api('/vacancies/' + encodeURIComponent(vcId) + path, { method: 'POST', body: Object.assign({ jobSeekerIds: Array.from(faShortlistSelectedIds) }, body || {}) });
        showAlert(successMessage + ' (' + result.count + ')');
        faShortlistSelectedIds = new Set();
        await loadFieldShortlist();
      } catch (e) { showAlert(e.message, false); }
    }

    function showFieldSelectedInPerson() { return submitFieldIntroductions('/introductions/in-person', {}, 'Candidates recorded as shown in person'); }
    function sendFieldSelectedToOwner() { return submitFieldIntroductions('/introductions', { channel: document.getElementById('fa-shortlist-channel').value }, 'Candidates sent to owner'); }

    async function bookFieldInterviewFromCard(vacancyId, jobSeekerId, article) {
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
            showAlert('Interview booked; offer sent to candidate.'); panel.replaceChildren(); await loadFieldInterviews();
          } catch (e) { showAlert(e.message, false); }
        });
        panel.append(select, confirm);
      } catch (e) { showAlert(e.message, false); }
    }

    async function loadFieldInterviews() {
      const target = document.getElementById('fa-interview-list');
      try {
        const vacancyId = document.getElementById('fa-interview-filter-vacancy').value.trim();
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
            const p = interview.placement;
            const pStatus = p.paidAt ? 'Paid' : p.status === 'awaiting_payment' && p.paymentDueAt && new Date(p.paymentDueAt).getTime() <= Date.now() ? 'Overdue' : p.status === 'awaiting_payment' ? 'Awaiting payment' : '—';
            const workerCallCheck = p.joiningWorkerCallId ? '✓ Worker call' : '✗ Worker call';
            const bizCallCheck = p.joiningBusinessCallId ? '✓ Business call' : '✗ Business call';
            const guaranteeLeft = p.guaranteeEndedReason ? 'Ended: ' + p.guaranteeEndedReason : (p.guaranteeDaysLeft !== undefined && p.guaranteeDaysLeft !== null ? p.guaranteeDaysLeft + ' days left' : (p.joinedDate ? Math.max(0, 60 - Math.floor((Date.now() - new Date(p.joinedDate).getTime()) / 86400000)) + ' days left' : '—'));
            const replacementsUsed = p.replacementNumber + ' / 2';
            const rejectionsUsed = (p.rejectionsUsed || 0) + ' / 2';
            const openClaimText = p.openClaim ? 'Pending (Due: ' + new Date(p.openClaim.decisionDueAt).toLocaleString('en-IN') + ')' : 'None';

            const placement = document.createElement('p');
            placement.innerHTML = 'Placement ' + p.code + ' · ' + p.status +
              (p.paymentDueAt ? ' · Payment due ' + new Date(p.paymentDueAt).toLocaleString('en-IN') : '') +
              ' · ' + pStatus + '<br>' +
              'Joining checklist: ' + workerCallCheck + ', ' + bizCallCheck + '<br>' +
              'Guarantee: ' + guaranteeLeft + ' · Replacements: ' + replacementsUsed + ' · Rejections: ' + rejectionsUsed + '<br>' +
              'Open Claim: ' + openClaimText;
            card.appendChild(placement);

            const actionsDiv = document.createElement('div');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '8px';
            actionsDiv.style.marginTop = '6px';

            if (!p.paidAt && p.status === 'awaiting_payment') {
              const resendBtn = document.createElement('button');
              resendBtn.className = 'btn-sm';
              resendBtn.textContent = 'Resend payment link';
              resendBtn.onclick = async () => {
                try {
                  await api('/placements/' + p.id + '/resend-payment', { method: 'POST' });
                  showAlert('Payment link resent to business');
                } catch (e) {
                  showAlert(e.message, false);
                }
              };
              actionsDiv.appendChild(resendBtn);
            }

            if (p.status === 'confirmed') {
              const joinBtn = document.createElement('button');
              joinBtn.className = 'btn-sm';
              joinBtn.textContent = 'Record Joining';
              joinBtn.onclick = async () => {
                try {
                  await api('/placements/' + p.id + '/joined', { method: 'POST', body: {} });
                  showAlert('Joining recorded');
                  loadFieldInterviews();
                } catch (e) {
                  showAlert('Failed to record joining: ' + e.message, false);
                }
              };
              actionsDiv.appendChild(joinBtn);
            }

            if (p.status === 'active') {
              const claimBtn = document.createElement('button');
              claimBtn.className = 'btn-sm btn-secondary';
              claimBtn.textContent = 'Report Claim';
              claimBtn.onclick = () => openFaClaimModal(p.id, p.code);
              actionsDiv.appendChild(claimBtn);
            }

            if (actionsDiv.children.length > 0) {
              card.appendChild(actionsDiv);
            }
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
                showAlert('Interview reply recorded.'); await loadFieldInterviews();
              } catch (e) { showAlert(e.message, false); }
            });
            form.append(answer, reason, submit); card.appendChild(form);
          }
          target.appendChild(card);
        });
      } catch (e) { target.textContent = e.message; }
    }

    function formatPhoneLast4(val) {
      if (!val) return '—';
      const digits = String(val).replace(/[^0-9]/g, '');
      return digits.length >= 4 ? '••••••' + digits.slice(-4) : '••••••';
    }

    // Field Agent Calling & History
    let faCallingSubject = null;
    let faActiveCallRecordId = null;

    async function openFaCalling(subjectType, id, code, name) {
      document.getElementById('fa-call-blocked-alert').style.display = 'none';
      document.getElementById('fa-call-progress-section').style.display = 'none';
      document.getElementById('fa-answered-outcome-form').style.display = 'none';
      document.getElementById('fa-calling-modal').classList.remove('hidden');

      try {
        let endpoint = '/job-seekers/' + encodeURIComponent(id);
        if (subjectType === 'business') endpoint = '/businesses/' + encodeURIComponent(id);
        if (subjectType === 'referral') endpoint = '/referrals/' + encodeURIComponent(id);

        const data = await api(endpoint);
        faCallingSubject = { type: subjectType, id: data.id || id, code: data.code || code, data: data };

        document.getElementById('fa-profile-name').textContent = data.name || data.ownerName || name || '—';
        document.getElementById('fa-profile-code').textContent = data.code || code;
        document.getElementById('fa-profile-phone').textContent = formatPhoneLast4(data.phone);
        document.getElementById('fa-profile-status').textContent = data.status || 'Active';

        // Phase 18 Task 5: Payout details (masked only)
        try {
          const payoutAccounts = await api('/payout-accounts/' + subjectType + '/' + encodeURIComponent(data.id || id));
          const pStatusEl = document.getElementById('fa-profile-payout-status');
          if (pStatusEl) {
            if (Array.isArray(payoutAccounts) && payoutAccounts.length > 0) {
              const activeAcc = payoutAccounts.find(a => a.status !== 'superseded') || payoutAccounts[0];
              pStatusEl.textContent = activeAcc.maskedValue || (activeAcc.method === 'upi' ? 'UPI on file' : 'Bank on file');
              pStatusEl.className = 'badge ' + (activeAcc.status === 'verified' ? 'badge-success' : '');
            } else {
              pStatusEl.textContent = 'None on file';
              pStatusEl.className = 'badge';
            }
          }
        } catch {
          const pStatusEl = document.getElementById('fa-profile-payout-status');
          if (pStatusEl) {
            pStatusEl.textContent = 'None on file';
            pStatusEl.className = 'badge';
          }
        }

        // Setup Edit Profile Section
        let faInitialValues = {
          name: data.name || data.ownerName || '',
          phone: data.phone || '',
          locality: data.locality || '',
        };
        window.faCurrentInitialValues = faInitialValues;

        document.getElementById('fa-edit-name').value = faInitialValues.name;
        document.getElementById('fa-edit-phone').value = faInitialValues.phone;
        document.getElementById('fa-edit-locality').value = faInitialValues.locality;

        const faReasonContainer = document.getElementById('fa-edit-reason-container');
        const faReasonInput = document.getElementById('fa-edit-reason');
        const faLockedNotice = document.getElementById('fa-edit-locked-notice');
        const saveFaBtn = document.getElementById('fa-btn-save-edit');

        faReasonContainer.style.display = 'none';
        faReasonInput.value = '';

        // Check edit lock via /edit-policy/check
        let isFaLocked = false;
        try {
          const perm = await api('/edit-policy/check?entityType=' + encodeURIComponent(subjectType) + '&id=' + encodeURIComponent(data.id || id));
          if (!perm.allowed && perm.reason && perm.reason.includes('Locked — money involved, ask your Team Lead')) {
            isFaLocked = true;
          }
        } catch (err) {
          if (err.message && err.message.includes('Locked — money involved, ask your Team Lead')) {
            isFaLocked = true;
          }
        }

        if (isFaLocked) {
          faLockedNotice.style.display = 'block';
          saveFaBtn.disabled = true;
          document.getElementById('fa-edit-name').disabled = true;
          document.getElementById('fa-edit-phone').disabled = true;
          document.getElementById('fa-edit-locality').disabled = true;
        } else {
          faLockedNotice.style.display = 'none';
          saveFaBtn.disabled = false;
          document.getElementById('fa-edit-name').disabled = false;
          document.getElementById('fa-edit-phone').disabled = false;
          document.getElementById('fa-edit-locality').disabled = false;
        }

        function checkFaEditFieldsChanged() {
          const init = window.faCurrentInitialValues || {};
          const curName = document.getElementById('fa-edit-name').value.trim();
          const curPhone = document.getElementById('fa-edit-phone').value.trim();
          const curLocality = document.getElementById('fa-edit-locality').value.trim();

          let savedChanged = false;
          if (init.name && curName !== init.name) savedChanged = true;
          if (init.phone && curPhone !== init.phone) savedChanged = true;
          if (init.locality && curLocality !== init.locality) savedChanged = true;

          faReasonContainer.style.display = savedChanged ? 'block' : 'none';
        }

        document.getElementById('fa-edit-name').oninput = checkFaEditFieldsChanged;
        document.getElementById('fa-edit-phone').oninput = checkFaEditFieldsChanged;
        document.getElementById('fa-edit-locality').oninput = checkFaEditFieldsChanged;

        // Change History: visible to Team Leads and above only
        const historySection = document.getElementById('fa-change-history-section');
        const isLeadOrAbove = currentUser && ['team_lead', 'manager', 'ceo'].includes(currentUser.role);
        if (isLeadOrAbove) {
          historySection.style.display = 'block';
          loadFaChangeHistory(subjectType, data.code || code || id);
        } else {
          historySection.style.display = 'none';
        }

        await loadFaHistory(subjectType, data.id || id);
      } catch (e) {
        showAlert('Could not load profile: ' + e.message, false);
      }
    }

    async function sendFaProfilePayoutLink() {
      if (!faCallingSubject) return alert('No profile loaded');
      try {
        await api('/payout-accounts/links', {
          method: 'POST',
          body: { ownerType: faCallingSubject.type, ownerId: faCallingSubject.id },
        });
        showAlert('Payout details link sent via SMS.');
      } catch (e) {
        showAlert('Failed to send payout link: ' + e.message, false);
      }
    }

    function closeFaCallingModal() {
      document.getElementById('fa-calling-modal').classList.add('hidden');
    }

    async function triggerFaCall() {
      if (!faCallingSubject) return alert('No profile loaded');
      const btn = document.getElementById('btn-fa-call');
      btn.disabled = true;
      document.getElementById('fa-call-blocked-alert').style.display = 'none';
      document.getElementById('fa-answered-outcome-form').style.display = 'none';

      const purpose = document.getElementById('fa-call-purpose').value;
      try {
        const res = await api('/calls', {
          method: 'POST',
          body: {
            subjectType: faCallingSubject.type,
            subjectId: faCallingSubject.id,
            purpose: purpose,
          }
        });
        faActiveCallRecordId = res.callRecordId || res.id;
        document.getElementById('fa-call-progress-section').style.display = 'block';

        let callData = null;
        try {
          callData = await api('/calls/' + faActiveCallRecordId);
        } catch {}

        if (callData && callData.answered) {
          document.getElementById('fa-call-status-msg').textContent = 'Call answered (' + (callData.code || faActiveCallRecordId) + '). Record outcome:';
          document.getElementById('fa-answered-outcome-form').style.display = 'block';
        } else {
          document.getElementById('fa-call-status-msg').textContent = 'Call placed: ' + (callData ? (callData.answered ? 'answered' : 'unanswered (' + callData.providerStatus + ')') : 'initiated') + '.';
          document.getElementById('fa-answered-outcome-form').style.display = callData && callData.answered ? 'block' : 'none';
        }
        showAlert('Call placed: ' + (callData ? callData.code : faActiveCallRecordId));
        await loadFaHistory(faCallingSubject.type, faCallingSubject.id);
      } catch (e) {
        const msg = e.message || 'Calling is currently blocked';
        document.getElementById('fa-call-blocked-alert').textContent = 'Calling blocked: ' + msg;
        document.getElementById('fa-call-blocked-alert').style.display = 'block';
        showAlert('Calling blocked: ' + msg, false);
      } finally {
        btn.disabled = false;
      }
    }

    async function submitFaOutcome() {
      if (!faActiveCallRecordId) return alert('No active answered call');
      const outcome = document.getElementById('fa-call-outcome').value;
      const reason = document.getElementById('fa-call-outcome-reason').value.trim();
      try {
        await api('/calls/' + faActiveCallRecordId + '/outcome', {
          method: 'POST',
          body: { agentOutcome: outcome, reason: reason || undefined }
        });
        showAlert('Outcome recorded: ' + outcome);
        document.getElementById('fa-answered-outcome-form').style.display = 'none';
        document.getElementById('fa-call-status-msg').textContent = 'Outcome recorded: ' + outcome;
        if (faCallingSubject) {
          await loadFaHistory(faCallingSubject.type, faCallingSubject.id);
        }
      } catch (e) {
        showAlert(e.message, false);
      }
    }

    async function loadFaHistory(subjectType, subjectId) {
      const tbody = document.getElementById('fa-history-tbody');
      tbody.innerHTML = '<tr><td colspan="6">Loading history...</td></tr>';
      try {
        const calls = await api('/calls?subjectType=' + subjectType + '&subjectId=' + encodeURIComponent(subjectId));

        const items = [];
        (calls || []).forEach(function (c) {
          items.push({
            time: c.startedAt || c.createdAt,
            type: 'Call (' + (c.direction || 'outbound') + ')',
            purpose: c.purpose || 'general',
            answered: c.answered ? 'Yes' : 'No',
            duration: c.durationSec != null ? c.durationSec + 's' : '—',
            outcome: c.agentOutcome || c.providerStatus || '—',
          });
        });

        items.sort(function (a, b) {
          return new Date(b.time).getTime() - new Date(a.time).getTime();
        });

        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6">No call history found</td></tr>';
          return;
        }

        tbody.innerHTML = items.map(function (it) {
          return '<tr>' +
            '<td>' + (it.time ? new Date(it.time).toLocaleString('en-IN') : '—') + '</td>' +
            '<td>' + it.type + '</td>' +
            '<td>' + it.purpose + '</td>' +
            '<td>' + it.answered + '</td>' +
            '<td>' + it.duration + '</td>' +
            '<td>' + it.outcome + '</td>' +
          '</tr>';
        }).join('');
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6">Could not load history: ' + e.message + '</td></tr>';
      }
    }

    function openFaClaimModal(placementId, placementCode) {
      document.getElementById('fa-claim-placement-id').value = placementId;
      document.getElementById('fa-claim-call-record-id').value = '';
      document.getElementById('fa-claim-worker-left-on').value = new Date().toISOString().split('T')[0];
      document.getElementById('fa-claim-notes').value = '';
      document.getElementById('fa-claim-modal').classList.remove('hidden');
    }

    function closeFaClaimModal() {
      document.getElementById('fa-claim-modal').classList.add('hidden');
    }

    async function submitFaClaim() {
      const placementId = document.getElementById('fa-claim-placement-id').value;
      const callRecordId = document.getElementById('fa-claim-call-record-id').value.trim();
      const workerLeftOn = document.getElementById('fa-claim-worker-left-on').value;
      const reason = document.getElementById('fa-claim-reason').value;
      const notes = document.getElementById('fa-claim-notes').value.trim();

      if (!callRecordId) return alert('Answered owner call record ID is required');
      if (!workerLeftOn) return alert('Worker left date is required');

      try {
        await api('/placements/' + placementId + '/claims', {
          method: 'POST',
          body: { callRecordId, workerLeftOn, reason, notes: notes || undefined },
        });
        showAlert('Replacement claim submitted successfully');
        closeFaClaimModal();
        loadFieldInterviews();
      } catch (e) {
        showAlert('Claim submission failed: ' + e.message, false);
      }
    }

    let faActiveFollowUpTaskId = null;

    async function loadFaFollowUps() {
      const tbody = document.getElementById('fa-follow-ups-tbody');
      if (!tbody) return;
      try {
        const tasks = await api('/follow-up-tasks');
        const now = Date.now();
        tbody.innerHTML = tasks.map(function(t) {
          const isOverdue = t.status === 'pending' && new Date(t.dueAt).getTime() <= now;
          const statusDisplay = t.status === 'done' ? '<span class="badge" style="background:var(--success);">Completed</span>' : isOverdue ? '<span class="badge" style="background:var(--danger);">Overdue</span>' : '<span class="badge">' + t.status + '</span>';
          const seekerText = t.jobSeeker ? t.jobSeeker.code + ' (' + t.jobSeeker.name + ')' : (t.jobSeekerId || '—');
          const actionBtn = t.status === 'pending' ? '<button class="btn-sm" data-id="' + t.id + '" onclick="openFaCompleteFollowUpModal(this.dataset.id)">Complete Task</button>' : '—';
          return '<tr>' +
            '<td><strong>' + t.code + '</strong></td>' +
            '<td>' + seekerText + '</td>' +
            '<td><span class="badge">' + t.kind + '</span></td>' +
            '<td>' + new Date(t.dueAt).toLocaleDateString() + '</td>' +
            '<td>' + statusDisplay + '</td>' +
            '<td>' + actionBtn + '</td>' +
          '</tr>';
        }).join('') || '<tr><td colspan="6" style="text-align: center;">No follow-up tasks found</td></tr>';
      } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger);">Failed to load follow-ups: ' + e.message + '</td></tr>';
      }
    }

    function openFaCompleteFollowUpModal(taskId) {
      faActiveFollowUpTaskId = taskId;
      document.getElementById('fa-complete-task-id').value = taskId;
      document.getElementById('fa-follow-up-call-record-id').value = '';
      document.getElementById('fa-follow-up-answer').value = 'working_elsewhere';
      document.getElementById('fa-follow-up-introduced-business-group').classList.add('hidden');
      document.getElementById('fa-follow-up-notes').value = '';
      document.getElementById('fa-follow-up-modal').classList.remove('hidden');
    }

    function closeFaFollowUpModal() {
      document.getElementById('fa-follow-up-modal').classList.add('hidden');
      faActiveFollowUpTaskId = null;
    }

    async function onFaFollowUpAnswerChange() {
      const answer = document.getElementById('fa-follow-up-answer').value;
      const group = document.getElementById('fa-follow-up-introduced-business-group');
      const select = document.getElementById('fa-follow-up-introduced-business');
      if (answer === 'working_at_introduced_business') {
        group.classList.remove('hidden');
        select.innerHTML = '<option value="">Loading introduced businesses...</option>';
        try {
          const businesses = await api('/follow-up-tasks/' + faActiveFollowUpTaskId + '/introduced-businesses');
          select.innerHTML = '<option value="">Select introduced business...</option>' + businesses.map(function(b) {
            return '<option value="' + b.id + '">' + b.code + ' · ' + b.name + '</option>';
          }).join('');
        } catch (e) {
          select.innerHTML = '<option value="">Failed to load businesses</option>';
        }
      } else {
        group.classList.add('hidden');
      }
    }

    async function submitFaCompleteFollowUp() {
      const taskId = document.getElementById('fa-complete-task-id').value;
      const callRecordId = document.getElementById('fa-follow-up-call-record-id').value.trim();
      const answer = document.getElementById('fa-follow-up-answer').value;
      const answerBusinessId = document.getElementById('fa-follow-up-introduced-business').value;
      const notes = document.getElementById('fa-follow-up-notes').value.trim();

      if (!callRecordId) return alert('Answered call record ID is required');
      if (answer === 'working_at_introduced_business' && !answerBusinessId) {
        return alert('Please select the introduced business');
      }

      try {
        await api('/follow-up-tasks/' + taskId + '/complete', {
          method: 'POST',
          body: {
            callRecordId,
            answer,
            answerBusinessId: answer === 'working_at_introduced_business' ? answerBusinessId : undefined,
            notes: notes || undefined,
          },
        });
        showAlert('Follow-up task completed successfully');
        closeFaFollowUpModal();
        loadFaFollowUps();
      } catch (e) {
        showAlert('Failed to complete follow-up: ' + e.message, false);
      }
    }

    async function submitFaProfileEdit() {
      if (!faCallingSubject) return alert('Load a profile first');
      const init = window.faCurrentInitialValues || {};
      const curName = document.getElementById('fa-edit-name').value.trim();
      const curPhone = document.getElementById('fa-edit-phone').value.trim();
      const curLocality = document.getElementById('fa-edit-locality').value.trim();

      const body = {};
      let savedChanged = false;
      if (curName !== (init.name || '')) {
        if (init.name) savedChanged = true;
        body.name = curName || undefined;
      }
      if (curPhone !== (init.phone || '')) {
        if (init.phone) savedChanged = true;
        body.phone = curPhone || undefined;
      }
      if (curLocality !== (init.locality || '')) {
        if (init.locality) savedChanged = true;
        body.locality = curLocality || undefined;
      }

      if (Object.keys(body).length === 0) {
        showAlert('No changes detected', false);
        return;
      }

      const reason = document.getElementById('fa-edit-reason').value.trim();
      if (savedChanged) {
        if (!reason) {
          showAlert('A reason is required when changing an existing saved value', false);
          return;
        }
        body.reason = reason;
      } else if (reason) {
        body.reason = reason;
      }

      try {
        let endpoint = '/job-seekers/' + encodeURIComponent(faCallingSubject.id);
        if (faCallingSubject.type === 'business') endpoint = '/businesses/' + encodeURIComponent(faCallingSubject.id);
        else if (faCallingSubject.type === 'referral') endpoint = '/referrals/' + encodeURIComponent(faCallingSubject.id);

        await api(endpoint, { method: 'PATCH', body });
        showAlert('Profile updated successfully');
        await openFaCalling(faCallingSubject.type, faCallingSubject.id, faCallingSubject.code, curName);
      } catch (err) {
        showAlert('Update failed: ' + err.message, false);
      }
    }

    async function loadFaChangeHistory(subjectType, code) {
      const tbody = document.getElementById('fa-change-history-tbody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Loading history...</td></tr>';
      try {
        const logs = await api('/audit-logs?entityType=' + encodeURIComponent(subjectType) + '&entityCode=' + encodeURIComponent(code));
        if (!logs || !logs.length) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No changes recorded</td></tr>';
          return;
        }
        tbody.innerHTML = logs.map(l => \`
          <tr>
            <td><strong>\${l.actor?.name || l.actor?.code || 'Staff'}</strong></td>
            <td>\${new Date(l.createdAt).toLocaleString('en-IN')}</td>
            <td><code style="color: #38bdf8;">\${Array.isArray(l.changedFields) ? l.changedFields.join(', ') : '—'}</code></td>
            <td>\${l.reason || '—'}</td>
          </tr>
        \`).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" style="color: var(--danger); text-align: center;">Failed to load history: ' + err.message + '</td></tr>';
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      initUser();
    });
  </script>
</body>
</html>`;
}
