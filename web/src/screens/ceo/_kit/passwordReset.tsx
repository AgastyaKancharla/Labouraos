import { useState } from 'react';
import { Button } from '../../../components/Button';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { ActionButton } from './actions';

interface ResetResult {
  staff: { code: string };
  resetUrl: string;
  expiresAt: string;
}

/**
 * Reset a password (Master Guide, Passwords and email): POST
 * /staff/:id/reset-password gives a one-time link to send the person. They
 * choose a new password on it; the old password and their authenticator keep
 * working until the link is used, and only then does the old password stop.
 * (The old re-issued invite killed the password at once and cleared the
 * authenticator; it is now only for people who never set a password.)
 */
export function PasswordResetButton({ id, name, label = 'Reset password' }: { id: string; name: string; label?: string }) {
  const [shown, setShown] = useState<ResetResult | null>(null);
  const toast = useToast();
  return (
    <>
      <ActionButton
        label={label}
        title={`Reset ${name}'s password`}
        description="You get a one-time link to send them. They choose a new password on it; their old password and authenticator keep working until they use the link, then the old password stops."
        confirmLabel="Make the link"
        run={async () => {
          const res = await api.post<ResetResult>(`/staff/${id}/reset-password`);
          setShown(res);
          return res;
        }}
        success="Reset link ready"
      />
      <Modal
        open={Boolean(shown)}
        onClose={() => setShown(null)}
        title="Password reset link"
        footer={
          <>
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(shown?.resetUrl ?? '');
                toast.success('Copied');
              }}
            >
              Copy link
            </Button>
            <Button variant="primary" onClick={() => setShown(null)}>
              Done
            </Button>
          </>
        }
      >
        {shown && (
          <div>
            <p style={{ marginTop: 0 }}>
              <b>{name}</b> · staff code <span className="code">{shown.staff.code}</span>
            </p>
            <p className="code" style={{ wordBreak: 'break-all', background: 'var(--bg, #eef3fb)', padding: 10, borderRadius: 8 }}>
              {shown.resetUrl}
            </p>
            <p className="ceo-sub">
              Send this link to them (in person or on WhatsApp). It works once; it expires {formatDateTimeIST(shown.expiresAt)}. Their old password stops working once they set the new one. This link is shown only once.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
