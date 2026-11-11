import { Card } from '../../components/Card';
import { TopBar } from '../../components/TopBar';
import { useT } from '../../i18n/I18nProvider';
import type { ScreenDef } from '../../portals/types';

/** Stands in for a screen until its folder exists (see screens/registry.ts). */
export function Placeholder({ screen }: { screen: ScreenDef }) {
  const t = useT();
  return (
    <div className="lb-page">
      <TopBar title={t(screen.title)} />
      <Card>
        <p className="lb-placeholder__body">{t('placeholder.body')}</p>
        <p className="code" data-testid="placeholder-design">
          {t('placeholder.design', { id: `${screen.id}.dc.html` })}
        </p>
        {screen.variants && screen.variants.length > 0 && (
          <p className="sub">{t('placeholder.variants', { ids: screen.variants.join(', ') })}</p>
        )}
      </Card>
    </div>
  );
}

/** Public-page version: no staff top bar. */
export function PublicPlaceholder({ screen }: { screen: ScreenDef }) {
  const t = useT();
  return (
    <>
      <h1 className="h2">{t(screen.title)}</h1>
      <p className="muted">{t('placeholder.body')}</p>
      <p className="code">{t('placeholder.design', { id: `${screen.id}.dc.html` })}</p>
    </>
  );
}
