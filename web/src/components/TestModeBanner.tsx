import { useEffect, useState } from 'react';
import { useT } from '../i18n/I18nProvider';
import { onTestModeBanner, type TestModeNotice } from '../lib/api/testMode';

/**
 * The yellow test-mode strip (pretend vendors only): "Test mode code: 123456"
 * after any "Send OTP", and "Test mode link · Open link" after anything that
 * sends a link by SMS (the SMS never arrives on the test site). Stays until
 * closed or the next one replaces it. Never appears on a live system: the
 * server does not send the code or the link there.
 */
export function TestModeBanner() {
  const t = useT();
  const [notice, setNotice] = useState<TestModeNotice | null>(null);
  useEffect(
    () =>
      onTestModeBanner((next) =>
        setNotice((prev) => ({
          code: next.code ?? (next.links ? undefined : prev?.code),
          links: next.links ?? (next.code ? undefined : prev?.links),
        })),
      ),
    [],
  );
  if (!notice || (!notice.code && !notice.links?.length)) return null;
  const links = notice.links ?? [];
  return (
    <div className="lb-testmode" role="status" aria-live="assertive" data-testid="test-mode-banner">
      {notice.code && <strong>{notice.code}</strong>}
      {links.length > 0 && (
        <span className="lb-testmode__links" data-testid="test-mode-link">
          <strong>{t('testMode.link')}</strong>
          {links.map((url, i) => (
            <a key={url} className="lb-testmode__open" href={url} target="_blank" rel="noopener noreferrer" title={url}>
              {links.length > 1 ? t('testMode.openLinkN', { n: i + 1 }) : t('testMode.openLink')}
            </a>
          ))}
        </span>
      )}
      <span>{links.length > 0 ? t('testMode.linkNote') : t('testMode.codeNote')}</span>
      <button type="button" onClick={() => setNotice(null)} aria-label={t('common.close')}>
        ×
      </button>
    </div>
  );
}
