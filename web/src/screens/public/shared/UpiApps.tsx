import { useMemo } from 'react';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { detectUpiPlatform, UPI_APPS, upiAppLink, type UpiApp, type UpiPlatform } from './upiApps';

const LABEL: Record<UpiApp, MessageKey> = {
  phonepe: 'pub.upiApps.phonepe',
  gpay: 'pub.upiApps.gpay',
  paytm: 'pub.upiApps.paytm',
  bhim: 'pub.upiApps.bhim',
  other: 'pub.upiApps.other',
};

export interface ExtraMethod {
  kind: 'card' | 'netbanking';
  label: string;
  startUrl: string;
}

/**
 * Under the QR (21 Nov, rev 204): "Or pay with" PhonePe, Google Pay, Paytm,
 * BHIM and any other UPI app, each opening the app with Laboura's account, the
 * exact amount and the reference already filled. Phones only; on a laptop a
 * short note says to scan the QR. Card and netbanking show only when a bank
 * API offers them (`extraMethods`, empty today).
 */
export function UpiAppButtons({
  upiUri,
  onTap,
  extraMethods = [],
  platform,
}: {
  upiUri: string;
  /** After a tap (the page moves on to "Paid — confirming"). */
  onTap?: (app: UpiApp) => void;
  extraMethods?: ExtraMethod[];
  /** For tests; detected from the browser otherwise. */
  platform?: UpiPlatform;
}) {
  const t = useT();
  const where = useMemo(() => platform ?? detectUpiPlatform(), [platform]);
  const links = UPI_APPS.map((app) => ({ app, href: upiAppLink(app, upiUri, where) })).filter((l): l is { app: UpiApp; href: string } => l.href !== null);
  const extras = extraMethods.filter((m) => /^https:\/\//i.test(m.startUrl));
  if (links.length === 0) {
    return (
      <div className="lb-upi-apps lb-upi-apps--desktop" data-testid="upi-apps-desktop">
        <span className="sub">{t('pub.upiApps.desktopNote')}</span>
        {extras.map((m) => (
          <a key={m.kind} className="btn bs full" href={m.startUrl}>
            {m.label}
          </a>
        ))}
      </div>
    );
  }
  return (
    <div className="lb-upi-apps" role="group" aria-label={t('pub.upiApps.title')} data-testid="upi-apps">
      <span className="lbl">{t('pub.upiApps.title')}</span>
      <div className="lb-upi-apps__grid">
        {links.map(({ app, href }) => (
          <a key={app} className={`btn ${app === 'other' ? 'bs' : 'bp'} lb-upi-app lb-upi-app--${app}`} href={href} data-app={app} onClick={() => onTap?.(app)}>
            {t(LABEL[app])}
          </a>
        ))}
      </div>
      {extras.map((m) => (
        <a key={m.kind} className="btn bs full" href={m.startUrl}>
          {m.label}
        </a>
      ))}
    </div>
  );
}
