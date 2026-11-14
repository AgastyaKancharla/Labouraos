import { useId, useState } from 'react';
import { useT } from '../../../../i18n/I18nProvider';
import type { MessageKey } from '../../../../i18n/en';
import { Muted, Warn } from '../ui';
import { readQrFromPdf, type PdfQrResult } from './pdfQr';

const PROBLEM: Record<Exclude<PdfQrResult, { ok: true }>['reason'], MessageKey> = {
  password_needed: 'pub.pdf.passwordNeeded',
  password_wrong: 'pub.pdf.passwordWrong',
  no_qr: 'pub.pdf.noQr',
  not_pdf: 'pub.pdf.notPdf',
};

/**
 * "Aadhaar: open e-Aadhaar PDF": he picks his e-Aadhaar PDF, types its
 * password (the hint is shown), and the QR on it is read in this browser tab.
 * Only the QR's text is handed to `onText`; the PDF never leaves the phone.
 */
export function EAadhaarPdf({ onText, onCancel, read = readQrFromPdf }: { onText: (text: string) => void; onCancel: () => void; read?: typeof readQrFromPdf }) {
  const t = useT();
  const fileId = useId();
  const passwordId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);

  const open = async () => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await read(await fileBytes(file), password.trim());
      if (outcome.ok) onText(outcome.text);
      else setProblem(PROBLEM[outcome.reason]);
    } catch {
      setProblem('pub.pdf.noQr');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="lb-aq"
      data-testid="eaadhaar-pdf"
      onSubmit={(e) => {
        e.preventDefault();
        void open();
      }}
    >
      <div className="fld">
        <label htmlFor={fileId}>{t('pub.pdf.file')}</label>
        <input
          id={fileId}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setProblem(null);
          }}
        />
      </div>
      <div className="fld">
        <label htmlFor={passwordId}>{t('pub.pdf.password')}</label>
        <input
          id={passwordId}
          type="password"
          value={password}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={16}
          onChange={(e) => setPassword(e.target.value.toUpperCase())}
          aria-describedby={`${passwordId}-hint`}
        />
        <span id={`${passwordId}-hint`} className="sub">
          {t('pub.pdf.passwordHint')}
        </span>
      </div>
      {problem && <Warn>{t(problem)}</Warn>}
      <button type="submit" className="btn bp full" disabled={!file || busy} aria-busy={busy || undefined}>
        {busy ? t('pub.pdf.reading') : t('pub.pdf.open')}
      </button>
      <button type="button" className="btn bs full" onClick={onCancel}>
        {t('pub.qr.back')}
      </button>
      <Muted>{t('pub.pdf.stays')}</Muted>
    </form>
  );
}

/** The file's bytes, in memory only (older browsers have no File.arrayBuffer). */
function fileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
