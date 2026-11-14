import { useState } from 'react';
import type { OtpSent } from '@/api/types';
import { Checkbox, MobileField } from '@/components/form';
import { useI18n } from '@/i18n';
import { isMobile } from '@/lib/validate';
import { OtpCodeCard } from './OtpCodeCard';

interface Props {
  /** Send the code. `contactConsent` is the "Laboura may call me" tick. */
  send: (phone: string, contactConsent: boolean, resendOf?: string) => Promise<OtpSent>;
  /** Check the code; throw to show the error. */
  verify: (input: { phone: string; requestId: string; code: string; contactConsent: boolean }) => Promise<void>;
  testID?: string;
}

/**
 * Mobile number + OTP: +91 fixed, exactly 10 digits, then OtpCodeCard.
 * Used for "Continue with mobile number" and for the number every Google /
 * Apple account must verify before a profile.
 *
 * The tick (proposal 4.5, C7): "Laboura may call, SMS or WhatsApp me to help
 * me finish registering." Optional; without it only in-app and push
 * reminders are used. It is saved on the account (PATCH /me contactMe).
 */
export function PhoneOtpForm({ send, verify, testID = 'phone-otp' }: Props) {
  const { t } = useI18n();
  const [phone, setPhone] = useState('');
  const [locked, setLocked] = useState(false);
  const [contactConsent, setContactConsent] = useState(false);
  return (
    <>
      <MobileField label={t('otp.mobile')} value={phone} onChange={setPhone} editable={!locked} required testID={`${testID}-mobile`} />
      <OtpCodeCard
        testID={testID}
        sendLabel={t('otp.send')}
        submitLabel={t('otp.verify')}
        sentText={t('otp.sentTo', { last4: phone.slice(-4) })}
        beforeSend={() => (isMobile(phone) ? null : t('otp.invalidMobile'))}
        send={async (resendOf) => {
          const result = await send(phone, contactConsent, resendOf);
          setLocked(true);
          return result;
        }}
        submit={({ requestId, code }) => verify({ phone, requestId, code, contactConsent })}
        onChangeNumber={() => setLocked(false)}
      >
        <Checkbox label={t('otp.contactConsent')} checked={contactConsent} onChange={setContactConsent} testID={`${testID}-consent`} />
      </OtpCodeCard>
    </>
  );
}
