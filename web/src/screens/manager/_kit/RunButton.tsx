import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, type ButtonVariant } from '../../../components/Button';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../lib/api/errors';

/** A one-tap action (no confirm step): calls the API, toasts the result, refreshes the Manager's screens. */
export function RunButton<T>({
  label,
  run,
  success,
  variant = 'secondary',
  disabled,
}: {
  label: ReactNode;
  run: () => Promise<T>;
  success: string | ((result: T) => string);
  variant?: ButtonVariant;
  disabled?: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: run,
    onSuccess: (result) => {
      toast.success(typeof success === 'function' ? success(result) : success);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'),
  });
  return (
    <Button variant={variant} onClick={() => m.mutate()} loading={m.isPending} disabled={disabled}>
      {label}
    </Button>
  );
}
