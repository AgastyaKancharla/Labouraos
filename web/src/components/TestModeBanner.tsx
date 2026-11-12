import { useEffect, useState } from 'react';
import { onTestModeBanner } from '../lib/api/testMode';

/**
 * The yellow "Test mode code: 123456" strip shown after any "Send OTP" while
 * the server is in OTP test mode (pretend vendors). Stays until closed or the
 * next code replaces it. Never appears on a live system: the server does not
 * send the code there.
 */
export function TestModeBanner() {
  const [banner, setBanner] = useState<string | null>(null);
  useEffect(() => onTestModeBanner(setBanner), []);
  if (!banner) return null;
  return (
    <div className="lb-testmode" role="status" aria-live="assertive" data-testid="test-mode-banner">
      <strong>{banner}</strong>
      <span>Test mode: no SMS is sent, so the code is shown here.</span>
      <button type="button" onClick={() => setBanner(null)} aria-label="Close">
        ×
      </button>
    </div>
  );
}
