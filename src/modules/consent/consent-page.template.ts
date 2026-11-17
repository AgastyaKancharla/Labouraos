/** The public referral partner terms page in the web app (web/src/screens/public/P-ReferralTerms). */
export const REFERRAL_TERMS_PAGE_PATH = '/p/referral-terms';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One button (Master Guide rev 193): "Send code to sign" checks the ticks and
 * sends the code to the person's own phone; typing the sixth digit signs in
 * the same step. The server checks the OTP, its expiry and the rate limits on
 * /consent/submit exactly as before.
 */
function renderConsentOtpScript(token: string, successMessage: string): string {
  return `<script>
    const token = ${JSON.stringify(token)};
    let activeOtpRequestId = null;
    let submitting = false;
    const form = document.getElementById('consent-form');
    const codeInput = document.getElementById('otp-code');
    const alertBox = document.getElementById('alert-box');
    function showAlert(text, isError) {
      alertBox.textContent = text;
      alertBox.className = 'msg-box ' + (isError ? 'msg-error' : 'msg-success');
      alertBox.style.display = 'block';
    }
    async function submitCode() {
      const code = codeInput.value.trim();
      if (submitting || !activeOtpRequestId || code.length !== 6) return;
      submitting = true;
      const checkedPurposes = Array.from(document.querySelectorAll('input[name="purposes"]:checked')).map(el => el.value);
      const payload = { token, otpRequestId: activeOtpRequestId, otpCode: code, purposes: checkedPurposes, language: 'en' };
      const signedNameField = document.getElementById('signed-name');
      if (signedNameField) payload.signedName = signedNameField.value.trim();
      showAlert('Signing…', false);
      try {
        const res = await fetch('/consent/submit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) { showAlert(data.message || 'Submission failed', true); codeInput.value = ''; return; }
        showAlert(${JSON.stringify(successMessage)}, false);
        form.style.display = 'none';
      } catch (err) { showAlert('Network error while signing', true); }
      finally { submitting = false; }
    }
    document.getElementById('btn-send-otp').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      try {
        const res = await fetch('/consent/send-otp', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (!res.ok) { showAlert(data.message || 'Failed to send the code', true); return; }
        activeOtpRequestId = data.requestId;
        document.getElementById('otp-input-container').style.display = 'block';
        codeInput.focus();
        showAlert(data.testModeBanner ? data.testModeBanner : 'Code sent. Type it to sign.', false);
      } catch (err) { showAlert('Network error while sending the code', true); }
    });
    codeInput.addEventListener('input', () => { if (codeInput.value.trim().length === 6) void submitCode(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); void submitCode(); });
  </script>`;
}

/**
 * The fallback referral partner terms page (the web app's /p/... page is
 * normally chosen first). English only (rev 193); one button to sign.
 */
export function renderReferralTermsPageHtml(
  token: string,
  partnerName: string,
  maskedPhone: string,
  termsHtml: string,
): string {
  const labels = {
    title: 'Referral Partner Terms',
    terms: 'I agree to the referral partner terms',
    recording: 'I consent to call recording',
    sendOtp: 'Send code to sign',
    codeLabel: 'Type the 6-digit code: that signs the terms',
    fullTerms: 'Read the full referral partner terms',
  };

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${labels.title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}.container{max-width:680px;margin:auto;background:white;border-radius:12px;padding:24px;box-shadow:0 4px 6px #0001}article{line-height:1.6;border:1px solid #cbd5e1;border-radius:8px;padding:18px;margin:20px 0}.row{display:flex;gap:10px;margin:16px 0}.btn{width:100%;padding:12px;border:0;border-radius:8px;background:#2563eb;color:white;font-size:16px}.msg-box{display:none;padding:12px;margin:16px 0}.msg-success{background:#dcfce7}.msg-error{background:#fee2e2}.otp-input,input[type=text]{padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:16px}.otp-input{width:100%;box-sizing:border-box}.otp-section{background:#f1f5f9;padding:16px;border-radius:8px;margin:20px 0}</style></head>
<body><main class="container"><h1>${labels.title}</h1><p>${escapeHtml(partnerName)}</p><p>OTP phone: ${escapeHtml(maskedPhone)}</p>
<div id="alert-box" class="msg-box"></div>${termsHtml}
<p><a id="full-terms" href="${REFERRAL_TERMS_PAGE_PATH}" target="_blank" rel="noopener">${labels.fullTerms}</a></p>
<form id="consent-form">
<div class="row"><input type="checkbox" name="purposes" value="agreement_terms" required><label>${labels.terms}</label></div>
<div class="row"><input type="checkbox" name="purposes" value="call_recording" required><label>${labels.recording}</label></div>
<section class="otp-section"><button type="button" id="btn-send-otp" class="btn">${labels.sendOtp}</button>
<div id="otp-input-container" style="display:none;margin-top:12px"><label for="otp-code">${labels.codeLabel}</label><input type="text" id="otp-code" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div></section>
</form></main>
${renderConsentOtpScript(token, 'Referral terms signed. Thank you.')}</body></html>`;
}
