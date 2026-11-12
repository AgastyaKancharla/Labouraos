import { useState, type ReactNode } from 'react';
import { Button, type ButtonVariant } from '../../../components/Button';
import { useToast } from '../../../components/Toast';
import { api, type QueryValue } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { downloadTextFile } from '../../../lib/csv';

/**
 * "Download (Excel)" for a file the API makes (books, GST data, TDS
 * registers, salary sheet…). The request carries the staff token, so the file
 * is fetched here and saved, rather than opened as a plain link.
 */
export function ServerDownload({
  label,
  path,
  query,
  filename,
  variant = 'secondary',
  size,
}: {
  label: ReactNode;
  path: string;
  query?: Record<string, QueryValue>;
  filename: string;
  variant?: ButtonVariant;
  size?: 'compact' | 'regular';
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async () => {
    setBusy(true);
    try {
      const text = await api.get<string>(path, { query });
      downloadTextFile(filename, typeof text === 'string' ? text : JSON.stringify(text));
      toast.success(`${filename} downloaded`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'The download failed. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant={variant} size={size} onClick={() => void run()} loading={busy}>
      {label}
    </Button>
  );
}
