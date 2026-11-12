import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, type ButtonVariant } from '../../../components/Button';
import { Modal } from '../../../components/Modal';
import { DateField, MoneyField, SelectField, TextField, type SelectOption } from '../../../components/fields';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../lib/api/errors';
import './fin.css';

/** One input in a FormAction's confirm step. */
export type FormFieldDef =
  | { name: string; kind: 'text'; label: string; required?: boolean; hint?: string; placeholder?: string; initial?: string; inputMode?: 'numeric' | 'text' }
  | { name: string; kind: 'money'; label: string; required?: boolean; hint?: string; initial?: number | null }
  | { name: string; kind: 'select'; label: string; options: SelectOption[]; required?: boolean; initial?: string }
  | { name: string; kind: 'date'; label: string; required?: boolean; hint?: string; initial?: string; max?: string };

export type FormValues = Record<string, string | number | null>;

/**
 * A button that opens a confirm step with a few inputs, calls the API, shows
 * the result as a toast and refreshes every screen's data. Every Finance
 * action goes through one of these, so each one gives a result.
 */
export function FormAction({
  label,
  title,
  description,
  variant = 'secondary',
  size,
  confirmLabel,
  fields = [],
  run,
  success,
  disabled,
}: {
  label: ReactNode;
  title: string;
  description?: ReactNode;
  variant?: ButtonVariant;
  size?: 'compact' | 'regular';
  confirmLabel?: string;
  fields?: FormFieldDef[];
  run: (values: FormValues) => Promise<unknown>;
  success: string | ((result: unknown) => string);
  disabled?: boolean;
}) {
  const initial = (): FormValues => Object.fromEntries(fields.map((f) => [f.name, f.kind === 'money' ? (f.initial ?? null) : f.kind === 'select' ? (f.initial ?? f.options[0]?.value ?? '') : (f.initial ?? '')]));
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormValues>(initial);
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => run(values),
    onSuccess: (result) => {
      toast.success(typeof success === 'function' ? success(result) : success);
      setOpen(false);
      setValues(initial());
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'),
  });
  const missing = fields.some((f) => f.required && (values[f.name] === null || values[f.name] === ''));
  const set = (name: string, v: string | number | null) => setValues((old) => ({ ...old, [name]: v }));
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={disabled}>
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
            <Button variant={variant === 'secondary' ? 'primary' : variant} onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={missing}>
              {confirmLabel ?? title}
            </Button>
          </>
        }
      >
        {description && <div style={{ marginTop: 0, marginBottom: 12, fontSize: 13.5 }}>{description}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fields.map((f) =>
            f.kind === 'money' ? (
              <MoneyField key={f.name} label={f.label} value={(values[f.name] as number | null) ?? null} onChange={(v) => set(f.name, v)} required={f.required} hint={f.hint} />
            ) : f.kind === 'date' ? (
              <DateField key={f.name} label={f.label} value={String(values[f.name] ?? '')} onChange={(v) => set(f.name, v)} required={f.required} hint={f.hint} max={f.max} />
            ) : f.kind === 'select' ? (
              <SelectField key={f.name} label={f.label} value={String(values[f.name] ?? '')} onChange={(v) => set(f.name, v)} options={f.options} required={f.required} />
            ) : (
              <TextField
                key={f.name}
                label={f.label}
                value={String(values[f.name] ?? '')}
                onChange={(v) => set(f.name, v)}
                required={f.required}
                hint={f.hint}
                placeholder={f.placeholder}
                inputMode={f.inputMode}
              />
            ),
          )}
        </div>
      </Modal>
    </>
  );
}

/** The design's footnote line under a list. */
export function Note({ children }: { children: ReactNode }) {
  return <div className="fin-note">{children}</div>;
}

/** "Waiting · 5 days", "1 day". */
export function days(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}
