import { CONSENT_NOTICES } from './consent-notices';
import {
  JOB_SEEKER_REQUIRED_CONSENT_PURPOSES,
  JOB_SEEKER_OPTIONAL_CONSENT_PURPOSES,
} from './consent.constants';

export function renderConsentPageHtml(token: string, candidateName?: string, lang: 'kn' | 'hi' | 'en' = 'kn'): string {
  const notices = CONSENT_NOTICES;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Laboura — Candidate Consent</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
    h1 { font-size: 20px; font-weight: 700; margin-top: 0; color: #0f172a; }
    .subtitle { color: #64748b; font-size: 14px; margin-bottom: 20px; }
    .purpose-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 12px; }
    .purpose-card input[type="checkbox"] { margin-top: 4px; width: 18px; height: 18px; cursor: pointer; }
    .purpose-info { flex: 1; }
    .purpose-title { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
    .purpose-desc { font-size: 13px; color: #475569; line-height: 1.4; }
    .badge-req { font-size: 11px; background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: 600; margin-left: 6px; }
    .badge-opt { font-size: 11px; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; margin-left: 6px; }
    .otp-section { background: #f1f5f9; border-radius: 8px; padding: 16px; margin-top: 20px; margin-bottom: 20px; }
    .btn { display: inline-block; width: 100%; background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 16px; font-weight: 600; cursor: pointer; text-align: center; }
    .btn:disabled { background: #94a3b8; cursor: not-allowed; }
    .btn-secondary { background: #e2e8f0; color: #1e293b; width: auto; padding: 8px 14px; font-size: 14px; margin-top: 8px; }
    .otp-input { width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 18px; letter-spacing: 4px; text-align: center; box-sizing: border-box; margin-top: 8px; }
    .msg-box { padding: 12px; border-radius: 6px; margin-bottom: 16px; font-size: 14px; display: none; }
    .msg-success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
    .msg-error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Laboura Candidate Consent / ಅಭ್ಯರ್ಥಿ ಒಪ್ಪಿಗೆ</h1>
    <div class="subtitle">
      ${candidateName ? `Welcome, <strong>${candidateName}</strong>. ` : ''}
      Please review and select the consent purposes below.
    </div>

    <div id="alert-box" class="msg-box"></div>

    <form id="consent-form">
      ${JOB_SEEKER_REQUIRED_CONSENT_PURPOSES.map((purpose) => {
        const item = notices[purpose]?.[lang] || notices[purpose]?.en;
        return `
        <div class="purpose-card">
          <input type="checkbox" id="chk-${purpose}" name="purposes" value="${purpose}" checked required />
          <div class="purpose-info">
            <div class="purpose-title">${item?.title || purpose} <span class="badge-req">Required</span></div>
            <div class="purpose-desc">${item?.description || ''}</div>
          </div>
        </div>`;
      }).join('')}

      ${JOB_SEEKER_OPTIONAL_CONSENT_PURPOSES.map((purpose) => {
        const item = notices[purpose]?.[lang] || notices[purpose]?.en;
        return `
        <div class="purpose-card">
          <input type="checkbox" id="chk-${purpose}" name="purposes" value="${purpose}" />
          <div class="purpose-info">
            <div class="purpose-title">${item?.title || purpose} <span class="badge-opt">Optional</span></div>
            <div class="purpose-desc">${item?.description || ''}</div>
          </div>
        </div>`;
      }).join('')}

      <div class="otp-section">
        <label style="font-weight: 600; font-size: 14px;">Verify via OTP on your registered mobile</label>
        <div>
          <button type="button" id="btn-send-otp" class="btn btn-secondary">Send OTP via SMS</button>
        </div>
        <div id="otp-input-container" style="display: none; margin-top: 12px;">
          <label style="font-size: 13px; color: #475569;">Enter the 6-digit OTP code received:</label>
          <input type="text" id="otp-code" class="otp-input" maxlength="6" placeholder="------" />
        </div>
      </div>

      <button type="submit" id="btn-submit" class="btn">Submit Consent / ಒಪ್ಪಿಗೆ ಸಲ್ಲಿಸಿ</button>
    </form>
  </div>

  <script>
    const token = ${JSON.stringify(token)};
    let activeOtpRequestId = null;

    const alertBox = document.getElementById('alert-box');
    function showAlert(text, isError) {
      alertBox.textContent = text;
      alertBox.className = 'msg-box ' + (isError ? 'msg-error' : 'msg-success');
      alertBox.style.display = 'block';
    }

    document.getElementById('btn-send-otp').addEventListener('click', async () => {
      try {
        const res = await fetch('/consent/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (!res.ok) {
          showAlert(data.message || 'Failed to send OTP', true);
          return;
        }
        activeOtpRequestId = data.requestId;
        document.getElementById('otp-input-container').style.display = 'block';
        showAlert('OTP has been sent to your phone.', false);
      } catch (err) {
        showAlert('Network error while requesting OTP', true);
      }
    });

    document.getElementById('consent-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('otp-code').value.trim();
      if (!activeOtpRequestId || !code) {
        showAlert('Please request and enter your OTP first.', true);
        return;
      }
      const checkedPurposes = Array.from(document.querySelectorAll('input[name="purposes"]:checked')).map(el => el.value);

      try {
        const res = await fetch('/consent/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            otpRequestId: activeOtpRequestId,
            otpCode: code,
            purposes: checkedPurposes,
            language: '${lang}'
          })
        });
        const data = await res.json();
        if (!res.ok) {
          showAlert(data.message || 'Submission failed', true);
          return;
        }
        showAlert('Consent recorded successfully! Thank you.', false);
        document.getElementById('consent-form').style.display = 'none';
      } catch (err) {
        showAlert('Network error while submitting consent', true);
      }
    });
  </script>
</body>
</html>`;
}
