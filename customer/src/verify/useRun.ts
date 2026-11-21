import { useCallback, useState } from 'react';
import { useI18n } from '@/i18n';
import { stepErrorText } from './errors';
import { isCodeExpired } from './stepsApi';

/**
 * Runs one step's call: busy while it runs, the problem in the person's
 * words if it fails. A code that ran out sends them back to the code step
 * (finished steps stay finished on the server).
 */
export function useRun(onCodeExpired: () => void) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (work: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await work();
        return true;
      } catch (e) {
        if (isCodeExpired(e)) onCodeExpired();
        else setError(stepErrorText(t, e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onCodeExpired, t],
  );
  return { busy, error, setError, run };
}
