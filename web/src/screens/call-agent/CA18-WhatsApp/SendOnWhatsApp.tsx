import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../../components/Button';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';

/** A referral partner's personal share link and QR (GET /referrals/:id/share-link), to send or show. */
export function PartnerShareLink({ referralId, code }: { referralId: string | undefined; code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const link = useQuery({
    queryKey: ['referral-share-link', referralId],
    queryFn: () => api.get<{ url: string; qrSvg: string; code: string }>(`/referrals/${encodeURIComponent(referralId!)}/share-link`),
    enabled: Boolean(referralId),
    staleTime: Infinity,
  });
  if (!link.data) return null;
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.data.qrSvg)}`;
  return (
    <div className="wa-share">
      <div className="lbl">{t('wa.partnerLink')}</div>
      <img src={src} alt={t('wa.partnerLink')} width={140} height={140} />
      <code className="wa-share-url">{link.data.url}</code>
      <div className="lb-ca-actions">
        <Button
          className="lb-ca-small"
          onClick={() => {
            void navigator.clipboard?.writeText(link.data!.url).then(() => setCopied(true)).catch(() => undefined);
          }}
        >
          {copied ? t('wa.copied') : t('wa.copyLink')}
        </Button>
      </div>
      <p className="muted">{t('wa.partnerLinkNote', { code })}</p>
    </div>
  );
}
