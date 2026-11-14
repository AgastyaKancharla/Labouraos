/**
 * How an ID check was made (guide, "Aadhaar verification", 14 Nov):
 *   - aadhaar_qr: UIDAI's Secure QR, checked in-house (AadhaarQrService) —
 *     the only way an Aadhaar is verified; no staff member can type it in;
 *   - pan, driving_licence, voter_id: another government ID, always offered
 *     (UIDAI's rules: nobody may be refused for not using Aadhaar), checked
 *     by the Team Lead by eye (rev 154: no outside company, ₹0) from a live
 *     camera photo of the card and the typed number (OtherIdService).
 */
export const OTHER_ID_METHODS = ['pan', 'driving_licence', 'voter_id'] as const;
export type OtherIdMethod = (typeof OTHER_ID_METHODS)[number];
export const AADHAAR_QR_METHOD = 'aadhaar_qr';

export function isOtherIdMethod(value: unknown): value is OtherIdMethod {
  return typeof value === 'string' && (OTHER_ID_METHODS as readonly string[]).includes(value);
}

export const AADHAAR_ONLY_BY_QR = 'Aadhaar is checked only by reading its Secure QR code (on the link or in Laboura Field). Here use PAN, driving licence or voter ID.';
