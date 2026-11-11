import { CONSENT_NOTICES } from './consent-notices';
import {
  JOB_SEEKER_REQUIRED_CONSENT_PURPOSES,
  JOB_SEEKER_OPTIONAL_CONSENT_PURPOSES,
} from './consent.constants';

/** The public referral partner terms page in the web app (web/src/screens/public/P-ReferralTerms). */
export const REFERRAL_TERMS_PAGE_PATH = '/app/p/referral-terms';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderConsentOtpScript(token: string, language: string, successMessage: string): string {
  return `<script>
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
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (!res.ok) { showAlert(data.message || 'Failed to send OTP', true); return; }
        activeOtpRequestId = data.requestId;
        document.getElementById('otp-input-container').style.display = 'block';
        showAlert('OTP has been sent to your phone.', false);
      } catch (err) { showAlert('Network error while requesting OTP', true); }
    });
    document.getElementById('consent-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('otp-code').value.trim();
      if (!activeOtpRequestId || !code) { showAlert('Please request and enter your OTP first.', true); return; }
      const checkedPurposes = Array.from(document.querySelectorAll('input[name="purposes"]:checked')).map(el => el.value);
      const payload = { token, otpRequestId: activeOtpRequestId, otpCode: code, purposes: checkedPurposes, language: ${JSON.stringify(language)} };
      const signedNameField = document.getElementById('signed-name');
      if (signedNameField) payload.signedName = signedNameField.value.trim();
      try {
        const res = await fetch('/consent/submit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) { showAlert(data.message || 'Submission failed', true); return; }
        showAlert(${JSON.stringify(successMessage)}, false);
        document.getElementById('consent-form').style.display = 'none';
      } catch (err) { showAlert('Network error while submitting consent', true); }
    });
  </script>`;
}

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

  ${renderConsentOtpScript(token, lang, 'Consent recorded successfully! Thank you.')}
</body>
</html>`;
}

export function renderBusinessAgreementPageHtml(
  token: string,
  businessName: string,
  maskedPhone: string,
  termsHtml: string,
  language: 'kn' | 'hi' | 'en',
): string {
  const labels = {
    en: { title: 'Business agreement', owner: 'Owner name', terms: 'I agree to the agreement terms', recording: 'I consent to call recording', sendOtp: 'Send OTP to the owner phone', submit: 'Sign agreement' },
    hi: { title: 'व्यवसाय समझौता', owner: 'मालिक का नाम', terms: 'मैं समझौते की शर्तों से सहमत हूँ', recording: 'मैं कॉल रिकॉर्डिंग की सहमति देता/देती हूँ', sendOtp: 'मालिक के फोन पर OTP भेजें', submit: 'समझौते पर हस्ताक्षर करें' },
    kn: { title: 'ವ್ಯವಹಾರ ಒಪ್ಪಂದ', owner: 'ಮಾಲೀಕರ ಹೆಸರು', terms: 'ನಾನು ಒಪ್ಪಂದದ ನಿಯಮಗಳಿಗೆ ಒಪ್ಪುತ್ತೇನೆ', recording: 'ಕರೆ ರೆಕಾರ್ಡಿಂಗ್‌ಗೆ ನಾನು ಒಪ್ಪುತ್ತೇನೆ', sendOtp: 'ಮಾಲೀಕರ ಫೋನ್‌ಗೆ OTP ಕಳುಹಿಸಿ', submit: 'ಒಪ್ಪಂದಕ್ಕೆ ಸಹಿ ಮಾಡಿ' },
  }[language];
  return `<!DOCTYPE html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${labels.title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}.container{max-width:680px;margin:auto;background:white;border-radius:12px;padding:24px;box-shadow:0 4px 6px #0001}article{line-height:1.6;border:1px solid #cbd5e1;border-radius:8px;padding:18px;margin:20px 0}.row{display:flex;gap:10px;margin:16px 0}.btn{width:100%;padding:12px;border:0;border-radius:8px;background:#2563eb;color:white;font-size:16px}.btn-secondary{width:auto;background:#e2e8f0;color:#1e293b}.msg-box{display:none;padding:12px;margin:16px 0}.msg-success{background:#dcfce7}.msg-error{background:#fee2e2}.otp-input,input[type=text]{padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:16px}.otp-input{width:100%;box-sizing:border-box}.otp-section{background:#f1f5f9;padding:16px;border-radius:8px;margin:20px 0}</style></head>
<body><main class="container"><h1>${labels.title}</h1><p>${escapeHtml(businessName)}</p><p>OTP phone: ${escapeHtml(maskedPhone)}</p>
<div id="alert-box" class="msg-box"></div>${termsHtml}
<form id="consent-form"><label>${labels.owner}<br><input id="signed-name" name="signedName" type="text" required autocomplete="name"></label>
<div class="row"><input type="checkbox" name="purposes" value="agreement_terms" required><label>${labels.terms}</label></div>
<div class="row"><input type="checkbox" name="purposes" value="call_recording" required><label>${labels.recording}</label></div>
<section class="otp-section"><button type="button" id="btn-send-otp" class="btn btn-secondary">${labels.sendOtp}</button>
<div id="otp-input-container" style="display:none;margin-top:12px"><label>Enter the 6-digit OTP</label><input type="text" id="otp-code" class="otp-input" inputmode="numeric" maxlength="6" required></div></section>
<button type="submit" id="btn-submit" class="btn">${labels.submit}</button></form></main>
${renderConsentOtpScript(token, language, 'Agreement signed successfully. Thank you.')}</body></html>`;
}

export function renderReferralTermsPageHtml(
  token: string,
  partnerName: string,
  maskedPhone: string,
  termsHtml: string,
  language: 'kn' | 'hi' | 'en' = 'en',
): string {
  const labels = {
    en: {
      title: 'Referral Partner Terms',
      partner: 'Partner Name',
      terms: 'I agree to the referral partner terms',
      recording: 'I consent to call recording',
      sendOtp: 'Send OTP to registered phone',
      submit: 'Sign Referral Terms',
      fullTerms: 'Read the full referral partner terms',
    },
    hi: {
      title: 'रेफरल पार्टनर शर्तें',
      partner: 'पार्टनर का नाम',
      terms: 'मैं रेफरल पार्टनर की शर्तों से सहमत हूँ',
      recording: 'मैं कॉल रिकॉर्डिंग की सहमति देता/देती हूँ',
      sendOtp: 'पंजीकृत फोन पर OTP भेजें',
      submit: 'शर्तों पर हस्ताक्षर करें',
      fullTerms: 'रेफ़रल पार्टनर की पूरी शर्तें पढ़ें',
    },
    kn: {
      title: 'ರೆಫರಲ್ ಪಾಲುದಾರರ ನಿಯಮಗಳು',
      partner: 'ಪಾಲುದಾರರ ಹೆಸರು',
      terms: 'ನಾನು ರೆಫರಲ್ ನಿಯಮಗಳಿಗೆ ಒಪ್ಪುತ್ತೇನೆ',
      recording: 'ಕರೆ ರೆಕಾರ್ಡಿಂಗ್‌ಗೆ ನಾನು ಒಪ್ಪುತ್ತೇನೆ',
      sendOtp: 'ನೋಂದಾಯಿತ ಫೋನ್‌ಗೆ OTP ಕಳುಹಿಸಿ',
      submit: 'ನಿಯಮಗಳಿಗೆ ಸಹಿ ಮಾಡಿ',
      fullTerms: 'ರೆಫರಲ್ ಪಾಲುದಾರರ ಪೂರ್ಣ ನಿಯಮಗಳನ್ನು ಓದಿ',
    },
  }[language] || {
    title: 'Referral Partner Terms',
    partner: 'Partner Name',
    terms: 'I agree to the referral partner terms',
    recording: 'I consent to call recording',
    sendOtp: 'Send OTP to registered phone',
    submit: 'Sign Referral Terms',
    fullTerms: 'Read the full referral partner terms',
  };

  return `<!DOCTYPE html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${labels.title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}.container{max-width:680px;margin:auto;background:white;border-radius:12px;padding:24px;box-shadow:0 4px 6px #0001}article{line-height:1.6;border:1px solid #cbd5e1;border-radius:8px;padding:18px;margin:20px 0}.row{display:flex;gap:10px;margin:16px 0}.btn{width:100%;padding:12px;border:0;border-radius:8px;background:#2563eb;color:white;font-size:16px}.btn-secondary{width:auto;background:#e2e8f0;color:#1e293b}.msg-box{display:none;padding:12px;margin:16px 0}.msg-success{background:#dcfce7}.msg-error{background:#fee2e2}.otp-input,input[type=text]{padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:16px}.otp-input{width:100%;box-sizing:border-box}.otp-section{background:#f1f5f9;padding:16px;border-radius:8px;margin:20px 0}</style></head>
<body><main class="container"><h1>${labels.title}</h1><p>${escapeHtml(partnerName)}</p><p>OTP phone: ${escapeHtml(maskedPhone)}</p>
<div id="alert-box" class="msg-box"></div>${termsHtml}
<p><a id="full-terms" href="${REFERRAL_TERMS_PAGE_PATH}?lang=${language}" target="_blank" rel="noopener">${labels.fullTerms}</a></p>
<form id="consent-form">
<div class="row"><input type="checkbox" name="purposes" value="agreement_terms" required><label>${labels.terms}</label></div>
<div class="row"><input type="checkbox" name="purposes" value="call_recording" required><label>${labels.recording}</label></div>
<section class="otp-section"><button type="button" id="btn-send-otp" class="btn btn-secondary">${labels.sendOtp}</button>
<div id="otp-input-container" style="display:none;margin-top:12px"><label>Enter the 6-digit OTP</label><input type="text" id="otp-code" class="otp-input" inputmode="numeric" maxlength="6" required></div></section>
<button type="submit" id="btn-submit" class="btn">${labels.submit}</button></form></main>
${renderConsentOtpScript(token, language, 'Referral terms signed successfully. Thank you.')}</body></html>`;
}
