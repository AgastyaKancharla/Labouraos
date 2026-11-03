/** Shared login markup and script for the three server-rendered consoles. */

export function staffLoginFieldsHtml(): string {
  return `
      <div id="login-form-fields">
        <div class="form-group">
          <label>Staff code</label>
          <input type="text" id="login-staff-code" autocomplete="username" style="width: 100%;" placeholder="CA-00001">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="login-password" autocomplete="current-password" style="width: 100%;" placeholder="••••••••">
        </div>
        <div class="form-group hidden" id="login-totp-group">
          <label>Authenticator code</label>
          <input type="text" id="login-totp" maxlength="6" inputmode="numeric" style="width: 100%; letter-spacing: 2px;" placeholder="123456" autocomplete="one-time-code">
        </div>
        <button id="btn-login" type="button" style="width: 100%; margin-top: 8px;">Log In</button>
      </div>
      <div id="login-code-panel" class="hidden" style="margin-top: 12px;">
        <h3 style="font-size: 1rem; margin-bottom: 8px;">Ask your Team Lead for your code</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted);">This code expires in <span id="login-code-countdown">—</span>.</p>
        <div class="form-group">
          <label>Login code</label>
          <input type="text" id="login-code" maxlength="6" inputmode="numeric" style="width: 100%; letter-spacing: 2px;" placeholder="000000" autocomplete="one-time-code">
        </div>
        <button id="btn-verify-code" type="button" style="width: 100%;">Enter code</button>
      </div>`;
}

export function staffLoginHandlersJs(): string {
  return `
    var labouraLoginRequestId = null;
    var labouraCodeTimer = null;
    var labouraRefreshTimer = null;

    function labouraDeviceId() {
      var key = 'laboura_device_id';
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var created = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('dev-' + Date.now());
      localStorage.setItem(key, created);
      return created;
    }

    function labouraScheduleRefresh(accessToken) {
      if (labouraRefreshTimer) clearTimeout(labouraRefreshTimer);
      var payload = parseJwt(accessToken);
      if (!payload || !payload.exp) return;
      var wait = payload.exp * 1000 - Date.now() - 60000;
      if (wait < 1000) wait = 1000;
      labouraRefreshTimer = setTimeout(async function () {
        try {
          var res = await fetch('/auth/refresh', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (!res.ok) throw new Error('Session ended');
          var data = await res.json();
          token = data.accessToken;
          sessionStorage.setItem('laboura_token', token);
          labouraScheduleRefresh(token);
        } catch (err) {
          sessionStorage.removeItem('laboura_token');
          token = '';
          showLoginModal();
        }
      }, wait);
    }

    function labouraAcceptSession(data) {
      if (data.totpEnrollmentRequired) {
        setupScopedToken = data.accessToken;
        token = data.accessToken;
        sessionStorage.setItem('laboura_token', token);
        return fetch('/staff/2fa/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + setupScopedToken
          }
        }).then(function (setupRes) {
          if (!setupRes.ok) throw new Error('Failed to start 2FA setup');
          return setupRes.json();
        }).then(function (setupData) {
          document.getElementById('totp-setup-secret').textContent = setupData.secret;
          document.getElementById('login-form-fields').classList.add('hidden');
          document.getElementById('login-code-panel').classList.add('hidden');
          document.getElementById('totp-enroll-section').classList.remove('hidden');
        });
      }
      token = data.accessToken;
      sessionStorage.setItem('laboura_token', token);
      labouraScheduleRefresh(token);
      hideLoginModal();
      return initUser();
    }

    function labouraShowCodePanel(data) {
      labouraLoginRequestId = data.loginRequestId;
      document.getElementById('login-form-fields').classList.add('hidden');
      document.getElementById('login-code-panel').classList.remove('hidden');
      if (labouraCodeTimer) clearTimeout(labouraCodeTimer);
      var expiresAt = new Date(data.expiresAt).getTime();
      var tick = function () {
        var left = expiresAt - Date.now();
        var label = document.getElementById('login-code-countdown');
        if (left <= 0) {
          label.textContent = 'expired';
          return;
        }
        label.textContent = Math.ceil(left / 1000) + 's';
        labouraCodeTimer = setTimeout(tick, 1000);
      };
      tick();
    }

    document.getElementById('btn-login').addEventListener('click', async function () {
      var staffCode = document.getElementById('login-staff-code').value;
      var password = document.getElementById('login-password').value;
      var totpEl = document.getElementById('login-totp');
      var totpCode = totpEl ? totpEl.value.trim() : '';
      var errEl = document.getElementById('login-error');
      var infoEl = document.getElementById('login-info');
      try {
        errEl.classList.add('hidden');
        if (infoEl) infoEl.classList.add('hidden');
        var payload = { staffCode: staffCode, password: password, deviceId: labouraDeviceId() };
        if (totpCode) payload.totpCode = totpCode;
        var res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json().catch(function () { return { message: 'Login failed' }; });
        if (!res.ok) {
          var message = data.message || 'Invalid credentials';
          if (String(message).indexOf('TOTP') !== -1) {
            document.getElementById('login-totp-group').classList.remove('hidden');
          }
          throw new Error(message);
        }
        if (data.status === 'awaiting_code') {
          labouraShowCodePanel(data);
          return;
        }
        await labouraAcceptSession(data);
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('hidden');
      }
    });

    document.getElementById('btn-verify-code').addEventListener('click', async function () {
      var errEl = document.getElementById('login-error');
      var code = document.getElementById('login-code').value.trim();
      try {
        errEl.classList.add('hidden');
        var res = await fetch('/auth/login/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loginRequestId: labouraLoginRequestId, code: code })
        });
        var data = await res.json().catch(function () { return { message: 'Login code is not valid' }; });
        if (!res.ok) throw new Error(data.message || 'Login code is not valid');
        await labouraAcceptSession(data);
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('hidden');
      }
    });
  `;
}

export function officeApproverHtml(): string {
  return `
    <button class="tab-btn hidden approver-tab" id="tab-login-codes" data-tab="login-codes">Login codes</button>
    <button class="tab-btn hidden approver-tab" id="tab-devices" data-tab="devices">Device approvals</button>
    <button class="tab-btn hidden approver-tab" id="tab-staff" data-tab="staff">Staff</button>
    <button class="tab-btn hidden approver-tab" id="tab-login-report" data-tab="login-report">Login code report</button>`;
}

export function officeApproverViewsHtml(): string {
  return `
    <div id="view-login-codes" class="tab-view hidden">
      <div class="card">
        <h2 style="font-size: 1.1rem; margin-bottom: 12px;">Login codes</h2>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">Pending requests refresh every 10 seconds.</p>
        <div id="login-code-cards"></div>
      </div>
    </div>
    <div id="view-devices" class="tab-view hidden">
      <div class="card">
        <h2 style="font-size: 1.1rem; margin-bottom: 12px;">Device approvals</h2>
        <div id="device-cards"></div>
      </div>
    </div>
    <div id="view-staff" class="tab-view hidden">
      <div class="card">
        <h2 style="font-size: 1.1rem; margin-bottom: 12px;">Staff</h2>
        <div id="staff-list"></div>
      </div>
    </div>
    <div id="view-login-report" class="tab-view hidden">
      <div class="card">
        <h2 style="font-size: 1.1rem; margin-bottom: 12px;">Login code report</h2>
        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
          <input type="date" id="report-from">
          <input type="date" id="report-to">
          <button id="btn-load-report" type="button" class="btn-sm">Show report</button>
        </div>
        <pre id="login-code-report" style="white-space: pre-wrap; font-size: 0.8rem;"></pre>
      </div>
    </div>`;
}

export function officeApproverJs(): string {
  return `
    function labouraEsc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function labouraIsApprover() {
      return currentUser && ['ceo', 'manager', 'team_lead'].indexOf(currentUser.role) !== -1;
    }

    function labouraShowApproverTabs() {
      var show = labouraIsApprover();
      document.querySelectorAll('.approver-tab').forEach(function (btn) {
        btn.classList.toggle('hidden', !show);
      });
      var canLock = currentUser && (currentUser.role === 'ceo' || currentUser.role === 'manager');
      document.querySelectorAll('.lock-control').forEach(function (el) {
        el.classList.toggle('hidden', !canLock);
      });
    }

    async function loadLoginCodes() {
      if (!labouraIsApprover()) return;
      var rows = await api('/login-codes/pending');
      var host = document.getElementById('login-code-cards');
      if (!host) return;
      if (!rows.length) {
        host.innerHTML = '<p style="color: var(--text-muted);">No pending requests.</p>';
        return;
      }
      host.innerHTML = rows.map(function (row) {
        var person = row.staff || {};
        var device = row.staffDevice || {};
        return '<div class="card" style="margin-bottom: 10px;" data-request-id="' + labouraEsc(row.id) + '">'
          + '<div><strong>' + labouraEsc(person.name || person.code) + '</strong> · ' + labouraEsc(person.code) + '</div>'
          + '<div style="font-size: 0.8rem; color: var(--text-muted);">'
          + labouraEsc(person.role) + ' · ' + labouraEsc(device.label || 'device')
          + ' · office network ' + (row.onOfficeNetwork ? 'yes' : 'no')
          + ' · ' + labouraEsc(new Date(row.createdAt).toLocaleString())
          + '</div>'
          + '<div style="margin-top: 8px;">'
          + '<button type="button" class="btn-sm" data-show-code="' + labouraEsc(row.id) + '">Show code</button> '
          + '<button type="button" class="btn-sm btn-secondary" data-refuse-code="' + labouraEsc(row.id) + '">Refuse</button>'
          + '</div></div>';
      }).join('');
    }

    async function loadDevices() {
      if (!labouraIsApprover()) return;
      var rows = await api('/staff/devices/pending');
      var host = document.getElementById('device-cards');
      if (!host) return;
      if (!rows.length) {
        host.innerHTML = '<p style="color: var(--text-muted);">No devices waiting.</p>';
        return;
      }
      host.innerHTML = rows.map(function (row) {
        var person = row.staff || {};
        return '<div class="card" style="margin-bottom: 10px;">'
          + '<div><strong>' + labouraEsc(person.name || person.code) + '</strong> · ' + labouraEsc(row.label) + '</div>'
          + '<div style="font-size: 0.8rem; color: var(--text-muted);">' + labouraEsc(person.code) + ' · ' + labouraEsc(row.platform) + '</div>'
          + '<div style="margin-top: 8px;">'
          + '<button type="button" class="btn-sm" data-approve-device="' + labouraEsc(row.id) + '">Approve</button> '
          + '<button type="button" class="btn-sm btn-secondary" data-reject-device="' + labouraEsc(row.id) + '">Reject</button>'
          + '</div></div>';
      }).join('');
    }

    async function loadStaffList() {
      if (!labouraIsApprover()) return;
      var rows = await api('/staff');
      var host = document.getElementById('staff-list');
      if (!host) return;
      var canLock = currentUser.role === 'ceo' || currentUser.role === 'manager';
      host.innerHTML = '<table><thead><tr><th>Code</th><th>Name</th><th>Role</th><th></th></tr></thead><tbody>'
        + rows.map(function (row) {
          return '<tr><td>' + labouraEsc(row.code) + '</td><td>' + labouraEsc(row.name) + '</td><td>' + labouraEsc(row.role) + '</td><td>'
            + '<button type="button" class="btn-sm" data-unlock="' + labouraEsc(row.id) + '">Unlock</button> '
            + (canLock
              ? '<span class="lock-control"><input data-lock-reason="' + labouraEsc(row.id) + '" placeholder="Reason" style="width: 140px;"> '
                + '<button type="button" class="btn-sm btn-secondary" data-lock="' + labouraEsc(row.id) + '">Lock</button></span>'
              : '')
            + '</td></tr>';
        }).join('')
        + '</tbody></table>';
    }

    async function loadLoginReport() {
      if (!labouraIsApprover()) return;
      var from = document.getElementById('report-from').value;
      var to = document.getElementById('report-to').value;
      var query = [];
      if (from) query.push('from=' + encodeURIComponent(from));
      if (to) query.push('to=' + encodeURIComponent(to));
      var path = '/login-codes/report' + (query.length ? '?' + query.join('&') : '');
      var report = await api(path);
      document.getElementById('login-code-report').textContent = JSON.stringify(report, null, 2);
    }

    document.getElementById('login-code-cards').addEventListener('click', async function (event) {
      var show = event.target.getAttribute('data-show-code');
      var refuse = event.target.getAttribute('data-refuse-code');
      try {
        if (show) {
          var revealed = await api('/login-codes/' + show + '/reveal', { method: 'POST', body: {} });
          showAlert('Code ' + revealed.code + ' for this request');
          await loadLoginCodes();
        }
        if (refuse) {
          await api('/login-codes/' + refuse + '/refuse', { method: 'POST', body: { reason: 'refused from the login code screen' } });
          showAlert('Request refused');
          await loadLoginCodes();
        }
      } catch (e) {
        showAlert(e.message, false);
      }
    });

    document.getElementById('device-cards').addEventListener('click', async function (event) {
      var approve = event.target.getAttribute('data-approve-device');
      var reject = event.target.getAttribute('data-reject-device');
      try {
        if (approve) {
          await api('/staff/devices/' + approve + '/approve', { method: 'POST', body: {} });
          showAlert('Device approved');
          await loadDevices();
        }
        if (reject) {
          await api('/staff/devices/' + reject + '/revoke', { method: 'POST', body: {} });
          showAlert('Device rejected');
          await loadDevices();
        }
      } catch (e) {
        showAlert(e.message, false);
      }
    });

    document.getElementById('staff-list').addEventListener('click', async function (event) {
      var unlock = event.target.getAttribute('data-unlock');
      var lock = event.target.getAttribute('data-lock');
      try {
        if (unlock) {
          await api('/staff/' + unlock + '/unlock', { method: 'POST', body: {} });
          showAlert('Account unlocked');
        }
        if (lock) {
          var reasonEl = document.querySelector('[data-lock-reason="' + lock + '"]');
          var reason = reasonEl ? reasonEl.value : '';
          await api('/staff/' + lock + '/lock', { method: 'POST', body: { reason: reason } });
          showAlert('Account locked');
        }
      } catch (e) {
        showAlert(e.message, false);
      }
    });

    document.getElementById('btn-load-report').addEventListener('click', function () {
      loadLoginReport().catch(function (e) { showAlert(e.message, false); });
    });

    setInterval(function () {
      if (!labouraIsApprover()) return;
      loadLoginCodes().catch(function () {});
    }, 10000);
  `;
}
