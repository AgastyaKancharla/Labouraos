/**
 * Mobile numbers: +91 is fixed and never typed; exactly 10 digits
 * (guide, "Forms: rules for every screen"). Agents never see full numbers —
 * the API masks them, and maskMobile() is the display form.
 */

/** Keeps digits only and drops a pasted +91 / 0 prefix; never more than 10 digits. */
export function cleanMobileInput(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** Exactly 10 digits, starting 6–9 (every Indian mobile number does). */
export function isValidMobile(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits);
}

/** "9876543210" → "+91 98765 43210". */
export function formatMobile(digits: string): string {
  const d = cleanMobileInput(digits);
  if (d.length !== 10) return d;
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

/** Last four digits only: "******3210". Also accepts an already-masked value. */
export function maskMobile(value: string): string {
  const d = value.replace(/\D/g, '');
  return `******${d.slice(-4)}`;
}

/** Bengaluru pincodes are 6 digits starting 5; the field accepts any Indian pincode. */
export function isValidPincode(value: string): boolean {
  return /^[1-9]\d{5}$/.test(value);
}
