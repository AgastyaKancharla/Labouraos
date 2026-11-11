import type { Trade } from '@/api/endpoints';

/** The business form (FA07 = CA13) and its mapping onto CreateBusinessDto (src/modules/business). */
export interface MobileState {
  number: string;
  requestId: string | null;
  code: string;
  verifiedAt: string | null;
  sentAt: number | null;
}

export interface StaffRow {
  trade: string;
  other: string;
  headcount: string;
  /** Rupees as shown, with commas ("16,000"). */
  salaryMin: string;
  salaryMax: string;
  shift: string;
  startDate: string;
  ownerTold: boolean;
}

export interface BranchRow {
  name: string;
  area: string;
  contactName: string;
  contactRole: string;
  mobile: MobileState;
}

export interface FormState {
  contactName: string;
  contactRole: string;
  mobile: MobileState;
  whatsappSame: boolean;
  whatsapp: string;
  language: string;
  billingEmail: string;
  heardFrom: string;
  boardName: string;
  legalName: string;
  familyName: string;
  businessType: string;
  employees: string;
  running: string;
  hiring: string;
  opensAt: string;
  closesAt: string;
  shopNumber: string;
  street: string;
  landmark: string;
  area: string;
  pincode: string;
  pin: { latitude: number; longitude: number } | null;
  branches: BranchRow[];
  gstin: string;
  fssai: string;
  licenceKind: 'shopEstablishmentNumber' | 'udyamNumber' | 'licenceNumber';
  licenceNumber: string;
  pan: string;
  noDocuments: boolean;
  staff: StaffRow[];
}

const OTHER_TRADE = '__other__';
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;

export function paise(rupeesText: string): number | null {
  const digits = rupeesText.replace(/\D/g, '');
  return digits ? Number(digits) * 100 : null;
}

export function staffTrade(row: StaffRow): string {
  return (row.trade === OTHER_TRADE ? row.other : row.trade).trim();
}

/** Keys of the fields still missing or wrong ("required now" fields only). */
export function formErrors(form: FormState, findTrade: (row: StaffRow) => Trade | undefined): string[] {
  const e: string[] = [];
  const household = form.businessType === 'household';
  if (!form.contactName.trim()) e.push('contactName');
  if (!form.contactRole) e.push('contactRole');
  if (!form.mobile.verifiedAt) e.push('mobile');
  if (!form.whatsappSame && !/^[6-9]\d{9}$/.test(form.whatsapp)) e.push('whatsapp');
  if (!form.language) e.push('language');
  if (!form.heardFrom) e.push('heardFrom');
  if (form.billingEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.billingEmail.trim())) e.push('billingEmail');
  if (!form.boardName.trim()) e.push('boardName');
  if (household && !form.familyName.trim()) e.push('familyName');
  if (!form.businessType) e.push('businessType');
  if (!form.employees) e.push('employees');
  if (!form.shopNumber.trim()) e.push('shopNumber');
  if (!form.street.trim()) e.push('street');
  if (!form.landmark.trim()) e.push('landmark');
  if (!form.area) e.push('area');
  if (!/^\d{6}$/.test(form.pincode)) e.push('pincode');
  if (!form.pin) e.push('pin');
  if (!household && !form.noDocuments) {
    if (form.gstin && !GSTIN.test(form.gstin)) e.push('gstin');
    if (form.pan && !PAN.test(form.pan)) e.push('pan');
  }
  form.branches.forEach((b, i) => {
    if (!b.name.trim() || !b.contactName.trim() || !b.contactRole || !b.mobile.verifiedAt) e.push(`branch${i}`);
  });
  form.staff.forEach((row, i) => {
    const min = paise(row.salaryMin);
    const max = paise(row.salaryMax);
    if (!staffTrade(row) || !min || !row.shift || !row.startDate || (max !== null && max < (min ?? 0))) e.push(`staff${i}`);
    const trade = findTrade(row);
    if (trade && min && min < trade.legalMinimumPaise && !row.ownerTold) e.push(`staffLegal${i}`);
  });
  return e;
}

/** Body for POST /businesses, registered from the shop visit `visitId`. */
export function businessBody(form: FormState, visitId: string | null): Record<string, unknown> {
  const household = form.businessType === 'household';
  const docs = household || form.noDocuments;
  const address = [form.shopNumber, form.street, form.landmark, form.area, form.pincode].map((s) => s.trim()).filter(Boolean).join(', ');
  const rows = form.staff.filter((r) => staffTrade(r));
  return {
    name: form.boardName.trim(),
    ...(household ? { familyName: form.familyName.trim() } : form.legalName.trim() ? { legalName: form.legalName.trim() } : {}),
    contactPersonName: form.contactName.trim(),
    contactPersonRole: form.contactRole,
    phone: form.mobile.number,
    otpRequestId: form.mobile.requestId,
    contactWhatsAppPhone: form.whatsappSame ? form.mobile.number : form.whatsapp,
    contactLanguage: form.language,
    ...(form.billingEmail.trim() ? { billingEmail: form.billingEmail.trim() } : {}),
    heardFrom: form.heardFrom,
    businessType: form.businessType,
    employeeCountBand: form.employees,
    ...(form.running ? { yearsInOperationBand: form.running } : {}),
    ...(form.hiring ? { hiringFrequency: form.hiring } : {}),
    ...(form.opensAt ? { openingTime: form.opensAt } : {}),
    ...(form.closesAt ? { closingTime: form.closesAt } : {}),
    shopNumber: form.shopNumber.trim(),
    street: form.street.trim(),
    landmark: form.landmark.trim(),
    locality: form.area,
    pincode: form.pincode,
    address,
    latitude: form.pin?.latitude,
    longitude: form.pin?.longitude,
    city: 'Bengaluru',
    ...(visitId ? { fieldVisitId: visitId } : {}),
    ...(docs
      ? { noDocuments: !household }
      : {
          ...(form.gstin.trim() ? { gstNumber: form.gstin.trim() } : {}),
          ...(form.fssai.trim() ? { fssaiNumber: form.fssai.trim() } : {}),
          ...(form.licenceNumber.trim() ? { [form.licenceKind]: form.licenceNumber.trim() } : {}),
          ...(form.pan.trim() ? { pan: form.pan.trim() } : {}),
        }),
    ...(form.branches.length
      ? {
          branches: form.branches.map((b) => ({
            name: b.name.trim(),
            locality: b.area || undefined,
            contactPersonName: b.contactName.trim(),
            contactPersonRole: b.contactRole,
            contactPersonPhone: b.mobile.number,
            otpRequestId: b.mobile.requestId,
          })),
        }
      : {}),
    ...(rows.length
      ? {
          staffNeededRows: rows.map((row) => {
            const min = paise(row.salaryMin)!;
            const max = paise(row.salaryMax);
            return {
              trade: staffTrade(row),
              headcount: Number(row.headcount),
              salaryMinPaise: min,
              salaryMaxPaise: max ?? min,
              salaryPeriod: 'monthly',
              shift: row.shift,
              startDate: row.startDate,
            };
          }),
        }
      : {}),
  };
}
