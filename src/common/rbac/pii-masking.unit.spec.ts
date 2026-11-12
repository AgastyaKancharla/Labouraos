import { isPhoneLikeKey, maskAgentPhones, maskPii } from './pii-masking.interceptor';

/**
 * H1 (security check, 12 Nov): every phone-like field is masked for everyone but
 * the CEO — Finance sees none of the number, agents, Team Leads and Managers see the
 * last 4 digits. Matched by key name, case-insensitive, not by a fixed list.
 */
describe('Phone masking matches every phone-like key (H1)', () => {
  it.each([
    'phone',
    'Phone',
    'PHONE',
    'whatsappPhone',
    'contactPersonPhone',
    'additionalContactPhone',
    'contactWhatsAppPhone',
    'candidatePhone',
    'recipientPhone',
    'callerPhone',
    'signedPhone',
    'maskedPhone',
    'phoneMasked',
    'phoneLast4',
    'confirmedPhoneLast4',
    'contactPhoneLast4',
    'mobile',
    'mobileNumber',
    'alternate_mobile',
    'whatsapp',
    'whatsappNumber',
    'WhatsApp_No',
    'contactNumber',
    'contact_number',
    'alternateNumber',
    'callerNumber',
    'phoneNumber',
    'phones',
    'virtualNumber',
  ])('treats %s as a phone number', (key) => {
    expect(isPhoneLikeKey(key)).toBe(true);
  });

  it.each([
    'phoneVerified',
    'phoneVerifiedAt',
    'phoneHash',
    'phoneOtpRequestId',
    'phoneNumberId',
    'phonesCount',
    'whatsappProvider',
    'whatsappStatus',
    'whatsappOptIn',
    'callRoutingPhoneSet',
    'shopNumber',
    'gstNumber',
    'invoiceNumber',
    'replacementNumber',
    'name',
    'amountPaise',
  ])('leaves %s alone', (key) => {
    expect(isPhoneLikeKey(key)).toBe(false);
  });

  it('never treats callRoutingPhone as a field to mask: it is removed instead', () => {
    expect(isPhoneLikeKey('callRoutingPhone')).toBe(false);
    expect(maskPii({ callRoutingPhone: '+919876500000', name: 'A' })).toEqual({ name: 'A' });
    expect(maskAgentPhones({ callRoutingPhone: '+919876500000', name: 'A' })).toEqual({ name: 'A' });
  });

  /** The shapes the Finance endpoints answer with (payouts, refunds, businesses, job seekers, referrals). */
  const financeShapes = {
    payoutRow: {
      id: 'pay-1',
      code: 'PAY-00012',
      amountPaise: 20000,
      recipient: { kind: 'referral', name: 'Ravi', phone: '+919845012345', whatsappPhone: '+919845099999', phoneVerified: true },
      jobSeeker: { code: 'JS-00042', phone: '+919900011111', whatsappPhone: '+919900022222', hasSmartphone: true },
    },
    business: {
      code: 'BZ-00007',
      phone: '+919886033333',
      contactPersonPhone: '+919886033333',
      additionalContactPhone: '+919886044444',
      contactWhatsAppPhone: '+919886055555',
      agreement: { signedPhone: '******5555', signedAt: '2026-11-01T10:00:00.000Z' },
      contacts: [{ name: 'Manager', mobile: '9886066666' }],
    },
    refund: { ref: 'js-1', phoneLast4: '1111', candidate: { contactNumber: '09900011111', whatsapp: '+919900022222' } },
    referral: { code: 'RF-00003', phone: '+919845012345', phones: ['+919845012345', '+919845077777'] },
    callLog: { callerNumber: '+919900011111', virtualNumber: '+918047100000', phoneVerifiedAt: '2026-11-02T09:00:00.000Z' },
  };

  /** Paths of every phone-like field holding text or a number (flags are left out). */
  const phoneValues = (data: unknown, path = '$', out: Array<[string, unknown]> = []): Array<[string, unknown]> => {
    if (Array.isArray(data)) data.forEach((v, i) => phoneValues(v, `${path}[${i}]`, out));
    else if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        if (isPhoneLikeKey(k) && Array.isArray(v)) v.forEach((item, i) => out.push([`${path}.${k}[${i}]`, item]));
        else if (isPhoneLikeKey(k) && (typeof v === 'string' || typeof v === 'number')) out.push([`${path}.${k}`, v]);
        else phoneValues(v, `${path}.${k}`, out);
      }
    }
    return out;
  };

  it('gives Finance no digit of any phone number in the Finance answer shapes', () => {
    const masked = maskPii(financeShapes);
    const fields = phoneValues(masked);
    expect(fields.length).toBeGreaterThanOrEqual(18);
    expect(fields.filter(([, v]) => v !== '********')).toEqual([]);
    // Nothing else changes: money, codes, flags and dates stay.
    expect(masked.payoutRow.amountPaise).toBe(20000);
    expect(masked.payoutRow.recipient.phoneVerified).toBe(true);
    expect(masked.payoutRow.jobSeeker.hasSmartphone).toBe(true);
    expect(masked.business.agreement.signedAt).toBe('2026-11-01T10:00:00.000Z');
    expect(masked.callLog.phoneVerifiedAt).toBe('2026-11-02T09:00:00.000Z');
    expect(JSON.stringify(masked)).not.toMatch(/\d{7,}/);
  });

  it('gives agents, Team Leads and Managers the last 4 digits of every phone-like field', () => {
    const masked = maskAgentPhones(financeShapes);
    expect(masked.payoutRow.recipient.whatsappPhone).toBe('******9999');
    expect(masked.business.contactPersonPhone).toBe('******3333');
    expect(masked.business.additionalContactPhone).toBe('******4444');
    expect(masked.business.contactWhatsAppPhone).toBe('******5555');
    expect(masked.business.contacts[0].mobile).toBe('******6666');
    expect(masked.refund.candidate.contactNumber).toBe('******1111');
    expect(masked.refund.candidate.whatsapp).toBe('******2222');
    expect(masked.referral.phones).toEqual(['******2345', '******7777']);
    expect(masked.callLog.callerNumber).toBe('******1111');
    // A true/false flag on a phone-sounding key is not a number and stays as it is.
    expect(masked.payoutRow.jobSeeker.hasSmartphone).toBe(true);
    const fields = phoneValues(masked);
    expect(fields.filter(([, v]) => !/^\*{6}\d{0,4}$/.test(String(v)))).toEqual([]);
  });

  it('keeps the audit redaction marker', () => {
    expect(maskPii({ whatsappPhone: '[changed]' })).toEqual({ whatsappPhone: '[changed]' });
    expect(maskAgentPhones({ contactPersonPhone: '[changed]' })).toEqual({ contactPersonPhone: '[changed]' });
  });
});
