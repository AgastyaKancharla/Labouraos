import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthProvider';
import { useFieldAppUrl } from '../../auth/fieldApp';
import { useT } from '../../i18n/I18nProvider';

/** Field agents sign in to Laboura Field, not this app; this tells them where to go. */
export function FieldAgentNotice() {
  const t = useT();
  const { signOut } = useAuth();
  const fieldAppUrl = useFieldAppUrl();
  return (
    <div className="lb-center console">
      <div className="card lb-auth-card">
        <h1 className="h1">{t('auth.fieldAgent.title')}</h1>
        <p className="muted">{t('auth.fieldAgent.body')}</p>
        {/* Laboura Field's real address (FIELD_HOST), from GET /auth/apps. */}
        <a className="btn bp full" href={fieldAppUrl}>
          {t('auth.fieldAgent.open')}
        </a>
        <Button onClick={() => void signOut()} fullWidth>
          {t('common.logout')}
        </Button>
      </div>
    </div>
  );
}
