import { Button } from '../../../components/Button';
import { useT } from '../../../i18n/I18nProvider';
import { useCallActions } from './useCallActions';

/** "☎ Call next · Ramesh Gowda": opens and dials the most urgent person (server-side queue). */
export function CallNextButton({ name, disabled, compact = true }: { name?: string | null; disabled?: boolean; compact?: boolean }) {
  const t = useT();
  const { callNext, callingNext } = useCallActions();
  return (
    <Button
      variant="primary"
      onClick={callNext}
      loading={callingNext}
      disabled={disabled}
      style={compact ? { minHeight: 38, padding: '8px 18px' } : undefined}
    >
      {name ? t('ca.callNext', { name }) : t('ca.callNextNone')}
    </Button>
  );
}
