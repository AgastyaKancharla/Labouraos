import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Button, Card, ListRow, Text, TextField } from '@/components';
import { useI18n, type MessageKey } from '@/i18n';
import { AadhaarScanner } from './AadhaarScanner';
import { LiveCapture } from './LiveCapture';
import type { AadhaarQrResult, OtherIdType, PhotoFile } from './types';

/**
 * The ID step shared by the job seeker's and the referral partner's steps
 * (guide, "Aadhaar verification", 14 Nov), as on the link page
 * (web/src/screens/public/shared/IdCheckPanel.tsx):
 *
 * - Aadhaar: scan the Secure QR with the phone's camera. Only the QR's text
 *   is sent — never a picture of the card.
 * - Aadhaar: e-Aadhaar PDF — read on the same Laboura page in the browser
 *   sheet (the PDF needs its password and a PDF reader); the PDF stays on
 *   the phone.
 * - Another ID (PAN, driving licence, voter ID), always offered: the number
 *   and a live camera photo of the card with a one-time capture token. A
 *   Team Lead checks it by eye, so it waits ("pending").
 */
type Mode = 'choose' | 'scan' | 'other' | 'card';

export const OTHER_IDS: { id: OtherIdType; label: MessageKey; numberLabel: MessageKey; pattern: RegExp }[] = [
  { id: 'pan', label: 'id.pan', numberLabel: 'id.panNumber', pattern: /^[A-Z]{5}\d{4}[A-Z]$/ },
  { id: 'driving_licence', label: 'id.dl', numberLabel: 'id.dlNumber', pattern: /^[A-Z0-9-]{8,20}$/ },
  { id: 'voter_id', label: 'id.voter', numberLabel: 'id.voterNumber', pattern: /^[A-Z]{3}\d{7}$/ },
];

const QR_PROBLEM: Partial<Record<AadhaarQrResult['result'], MessageKey>> = {
  name_mismatch: 'qr.nameMismatch',
  old_qr: 'qr.oldCard',
  bad_signature: 'qr.badSignature',
  cert_missing: 'qr.certMissing',
  unreadable: 'qr.unreadable',
};

const GENDER: Record<string, MessageKey> = { M: 'qr.genderM', F: 'qr.genderF', T: 'qr.genderT' };

/** 1998-08-15 → 15-08-1998 (as printed on the card); a year alone stays a year. */
export function formatDob(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : value || '—';
}

interface Props {
  busy: boolean;
  qrResult: AadhaarQrResult | null;
  otherIdFailed: MessageKey | null;
  onQr: (qrText: string) => void;
  onOtherId: (method: OtherIdType, idNumber: string, photo: PhotoFile, captureNonce: string) => Promise<'done' | 'retry'>;
  getCaptureNonce: () => Promise<string>;
  /** The one-time capture token could not be had: show why (the photo is not sent without it). */
  onNonceFailed: (error: unknown) => void;
  onContinue: () => void;
  /** The e-Aadhaar PDF: opens this step on the Laboura page in the browser sheet. */
  onOpenPdf: () => void;
  pdfBusy?: boolean;
  pending: boolean;
}

export function IdCheckPanel({ busy, qrResult, otherIdFailed, onQr, onOtherId, getCaptureNonce, onNonceFailed, onContinue, onOpenPdf, pdfBusy, pending }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('choose');
  const [other, setOther] = useState<OtherIdType | null>(null);
  const [number, setNumber] = useState('');
  const otherDef = OTHER_IDS.find((o) => o.id === other);
  const cleanNumber = number.toUpperCase().replace(/\s+/g, '');
  const numberOk = Boolean(otherDef?.pattern.test(cleanNumber));

  // One capture token each time the card camera opens, and a new one after a failed try (it works once, for 2 minutes).
  const nonce = useRef<Promise<{ token: string } | { error: unknown }> | null>(null);
  const ask = useRef(getCaptureNonce);
  useEffect(() => {
    ask.current = getCaptureNonce;
  });
  const freshNonce = useCallback(() => {
    nonce.current = ask.current().then(
      (token) => ({ token }),
      (error: unknown) => ({ error }),
    );
  }, []);
  useEffect(() => {
    if (mode === 'card') freshNonce();
  }, [mode, freshNonce]);

  // A QR that can't be used (or a name that doesn't match) opens "Another ID".
  const [seenQr, setSeenQr] = useState(qrResult);
  if (qrResult !== seenQr) {
    setSeenQr(qrResult);
    if (qrResult?.offerOtherId) setMode('other');
    else if (qrResult) setMode('choose');
  }

  // The card photo was sent: back to the choices, with "Sent to a Team Lead" on top.
  const [seenPending, setSeenPending] = useState(pending);
  if (pending !== seenPending) {
    setSeenPending(pending);
    if (pending) {
      setMode('choose');
      setOther(null);
      setNumber('');
    }
  }

  if (qrResult?.result === 'verified') {
    const person = qrResult.person;
    return (
      <View style={styles.gap} testID="id-verified">
        <Banner tone="ok" title={t('qr.verified')} message={qrResult.maskedReference ?? undefined} />
        {person ? (
          <Card>
            <ListRow title={t('qr.name')} subtitle={person.name} />
            <ListRow title={t('qr.dob')} subtitle={formatDob(person.dateOfBirth)} />
            <ListRow title={t('qr.gender')} subtitle={person.gender && GENDER[person.gender] ? t(GENDER[person.gender]!) : '—'} last />
          </Card>
        ) : null}
        <Button label={t('rp.continue')} onPress={onContinue} testID="id-continue" />
      </View>
    );
  }

  if (mode === 'scan') {
    return (
      <AadhaarScanner
        onText={(text) => {
          setMode('choose');
          onQr(text);
        }}
        onCancel={() => setMode('choose')}
      />
    );
  }

  if (mode === 'card' && otherDef) {
    return (
      <View style={styles.gap} testID="id-card">
        <Text variant="h2">{t('id.cardTitle')}</Text>
        <Text variant="muted">
          {t(otherDef.label)} · {cleanNumber}
        </Text>
        <LiveCapture
          kind="card"
          tips={t('id.cardTips')}
          takeLabel={t('id.cardTake')}
          savingLabel={t('id.cardSaving')}
          onCapture={async (photo) => {
            const got = nonce.current ? await nonce.current : { error: new Error('NO_CAPTURE_TOKEN') };
            if ('error' in got) {
              onNonceFailed(got.error);
              freshNonce();
              return 'retry';
            }
            const outcome = await onOtherId(otherDef.id, cleanNumber, photo, got.token);
            if (outcome === 'retry') freshNonce();
            return outcome;
          }}
          testID="id-card-camera"
        />
        <Button label={t('id.changeNumber')} variant="secondary" disabled={busy} onPress={() => setMode('other')} testID="id-change-number" />
      </View>
    );
  }

  const qrProblem = qrResult ? QR_PROBLEM[qrResult.result] : null;
  return (
    <View style={styles.gap} testID="id-panel">
      {pending && !qrResult ? (
        <Card testID="id-pending">
          <View style={styles.gap}>
            <Banner tone="ok" title={t('id.pendingTitle')} message={t('id.pendingBody')} />
            <Text variant="muted">{t('id.pendingOrQr')}</Text>
          </View>
        </Card>
      ) : null}
      {busy && mode !== 'other' ? <Text variant="muted">{t('qr.checking')}</Text> : null}
      {qrProblem ? <Banner tone="warn" message={t(qrProblem)} testID="id-qr-problem" /> : null}
      {!qrProblem && !pending && otherIdFailed ? <Banner tone="warn" message={t(otherIdFailed)} testID="id-other-failed" /> : null}
      <Button label={t('id.scanQr')} variant={mode === 'other' ? 'secondary' : 'primary'} disabled={busy} onPress={() => setMode('scan')} testID="id-scan" />
      <Button label={t('id.openPdf')} variant="secondary" disabled={busy} loading={pdfBusy} onPress={onOpenPdf} testID="id-pdf" />
      <Text variant="muted">{t('id.pdfNote')}</Text>
      <Button
        label={t('id.otherId')}
        variant={mode === 'other' ? 'primary' : 'secondary'}
        onPress={() => setMode(mode === 'other' ? 'choose' : 'other')}
        accessibilityState={{ expanded: mode === 'other' }}
        testID="id-other"
      />
      {mode === 'other' ? (
        <Card testID="id-other-form">
          <View style={styles.gap}>
            <Text variant="muted">{t('id.otherIdText')}</Text>
            {OTHER_IDS.map((o) => (
              <Button
                key={o.id}
                label={t(o.label)}
                variant={other === o.id ? 'primary' : 'secondary'}
                onPress={() => {
                  setOther(o.id);
                  setNumber('');
                }}
                testID={`id-type-${o.id}`}
              />
            ))}
            {otherDef ? (
              <>
                <TextField
                  label={t(otherDef.numberLabel)}
                  value={number}
                  onChangeText={setNumber}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  maxLength={20}
                  error={number.length > 0 && !numberOk && cleanNumber.length >= (otherDef.id === 'driving_licence' ? 8 : 10) ? t('id.numberWrong') : null}
                  testID="id-number"
                />
                <Button label={t('id.next')} disabled={!numberOk || busy} onPress={() => setMode('card')} testID="id-next" />
              </>
            ) : null}
          </View>
        </Card>
      ) : null}
      <Card testID="id-privacy">
        <View style={styles.gap}>
          <Text variant="small">
            <Text variant="small" style={styles.bold}>{t('id.readTitle')}</Text> {t('id.read')}
          </Text>
          <Text variant="small">
            <Text variant="small" style={styles.bold}>{t('id.keptTitle')}</Text> {t('id.kept')}
          </Text>
          <Text variant="small">
            <Text variant="small" style={styles.bold}>{t('id.neverTitle')}</Text> {t('id.never')}
          </Text>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 }, bold: { fontWeight: '700' } });
