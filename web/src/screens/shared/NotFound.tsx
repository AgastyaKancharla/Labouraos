import { ButtonLink } from '../../components/Button';
import { useAuth } from '../../auth/AuthProvider';
import { ROLE_HOME } from '../../auth/roles';
import { useT } from '../../i18n/I18nProvider';

export function NotFound() {
  const t = useT();
  const { session } = useAuth();
  return (
    <div className="lb-center">
      <div className="card lb-auth-card">
        <h1 className="h1">{t('error.pageNotFound')}</h1>
        <p className="lb-muted">{t('error.pageNotFoundBody')}</p>
        <ButtonLink to={session ? ROLE_HOME[session.staff.role] : '/login'} variant="primary" size="regular">
          {t('error.goHome')}
        </ButtonLink>
      </div>
    </div>
  );
}
