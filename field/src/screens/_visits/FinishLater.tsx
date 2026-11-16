import { Button } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { finishLater } from '@/navigation/useFlow';

/**
 * "Finish later" on every onboarding step from the agreement on (redesign,
 * 16 Nov): back to the Visits page; the job then waits in Needs you now on
 * Today, which opens this exact step again.
 */
export function FinishLaterButton() {
  const { t } = useI18n();
  return <Button label={t('steps.finishLater')} variant="secondary" onPress={() => finishLater(routes.visits)} testID="finish-later" />;
}
