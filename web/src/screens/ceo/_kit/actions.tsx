import './ceo.css';
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, type ButtonVariant } from '../../../components/Button';
import { Modal } from '../../../components/Modal';
import { TextField, SelectField, type SelectOption } from '../../../components/fields';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../lib/api/errors';

/**
 * A button that opens a confirm step (optionally asking for a reason and a
 * choice), calls the API, shows the result as a toast and refreshes every
 * CEO screen's data.
 */
export function ActionButton({
  label,
  title,
  description,
  variant = 'secondary',
  confirmLabel,
  reason,
  choice,
  run,
  success,
  disabled,
}: {
  label: ReactNode;
  title: string;
  description?: ReactNode;
  variant?: ButtonVariant;
  confirmLabel?: string;
  /** Ask for a written reason (required when true). */
  reason?: boolean | { label: string; required?: boolean };
  choice?: { label: string; options: SelectOption[]; initial?: string };
  run: (input: { reason: string; choice: string }) => Promise<unknown>;
  success: string | ((result: unknown) => string);
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState(choice?.initial ?? choice?.options[0]?.value ?? '');
  const toast = useToast();
  const queryClient = useQueryClient();
  // Options can arrive after the button first renders; fall back to the first one then.
  const chosen = choice && choice.options.some((o) => o.value === picked) ? picked : (choice?.initial ?? choice?.options[0]?.value ?? '');
  const reasonCfg = reason === true ? { label: 'Reason', required: true } : reason || null;
  const mutation = useMutation({
    mutationFn: () => run({ reason: text.trim(), choice: chosen }),
    onSuccess: (result) => {
      toast.success(typeof success === 'function' ? success(result) : success);
      setOpen(false);
      setText('');
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'),
  });
  const missingReason = Boolean(reasonCfg?.required && !text.trim());
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} disabled={disabled}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        dismissible={!mutation.isPending}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button variant={variant === 'secondary' ? 'primary' : variant} onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={missingReason || (choice ? !chosen : false)}>
              {confirmLabel ?? title}
            </Button>
          </>
        }
      >
        {description && <p style={{ marginTop: 0 }}>{description}</p>}
        {choice && <SelectField label={choice.label} value={chosen} onChange={setPicked} options={choice.options} />}
        {reasonCfg && <TextField label={reasonCfg.label} value={text} onChange={setText} required={reasonCfg.required} />}
      </Modal>
    </>
  );
}
