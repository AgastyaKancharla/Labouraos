import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import type { SheetPurpose } from '@/api/types';
import { useI18n } from '@/i18n';
import { openSecureSheet, type SheetOutcome } from '@/sheet/openSheet';

/**
 * Ask the server for a fresh link page for this profile, open it in the
 * secure sheet, and refresh Home when the person comes back.
 */
export function useSecureSheet() {
  const api = useCustomerApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SheetOutcome | null>(null);

  const open = async (profileId: string, purpose: SheetPurpose, documentId?: string): Promise<SheetOutcome | null> => {
    setBusy(true);
    setError(null);
    try {
      const link = await api.sheetLink(profileId, purpose, documentId);
      const result = await openSecureSheet(link.url);
      setOutcome(result);
      await queryClient.invalidateQueries({ queryKey: queryKeys.home(profileId) });
      return result;
    } catch (err) {
      setError(isApiError(err) && err.isNetworkError ? t('common.networkError') : t('sheet.failed'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { open, busy, error, outcome };
}
