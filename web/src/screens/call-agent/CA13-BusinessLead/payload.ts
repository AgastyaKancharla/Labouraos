import { OTHER_TRADE } from '../_registration/options';
import type { PlaceState } from '../_registration/kit';

/** The business form (CA13) and its mapping onto CreateBusinessDto (business.service.ts). */
export interface StaffRow {
  trade: string;
  other: string;
  headcount: string;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  period: 'monthly' | 'daily';
  shift: string;
  startDate: string;
  ownerTold: boolean;
}

export interface BranchRow {
  name: string;
  shopNumber: string;
  street: string;
  landmark: string;
  place: PlaceState;
  contactName: string;
  contactRole: string;
  mobile: string;
  language: string;
}

export interface BusinessForm {
  contactName: string;
  contactRole: string;
  mobile: string;
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
  workingDays: string[];
  shopNumber: string;
  street: string;
  landmark: string;
  place: PlaceState;
  branches: BranchRow[];
  gstin: string;
  fssai: string;
  licenceKind: 'shopEstablishmentNumber' | 'udyamNumber' | 'licenceNumber';
  licenceNumber: string;
  pan: string;
  noDocuments: boolean;
  staff: StaffRow[];
}

export const EMPTY_PLACE: PlaceState = { area: '', pincode: '', latitude: null, longitude: null };
export const EMPTY_STAFF_ROW: StaffRow = {
  trade: '',
  other: '',
  headcount: '1',
  salaryMinPaise: null,
  salaryMaxPaise: null,
  period: 'monthly',
  shift: '',
  startDate: '',
  ownerTold: false,
};
export const EMPTY_BRANCH: BranchRow = {
  name: '',
  shopNumber: '',
  street: '',
  landmark: '',
  place: EMPTY_PLACE,
  contactName: '',
  contactRole: '',
  mobile: '',
  language: '',
};

export const EMPTY_BUSINESS: BusinessForm = {
  contactName: '',
  contactRole: '',
  mobile: '',
  whatsappSame: true,
  whatsapp: '',
  language: '',
  billingEmail: '',
  heardFrom: '',
  boardName: '',
  legalName: '',
  familyName: '',
  businessType: '',
  employees: '',
  running: '',
  hiring: '',
  opensAt: '',
  closesAt: '',
  workingDays: [],
  shopNumber: '',
  street: '',
  landmark: '',
  place: EMPTY_PLACE,
  branches: [],
  gstin: '',
  fssai: '',
  licenceKind: 'shopEstablishmentNumber',
  licenceNumber: '',
  pan: '',
  noDocuments: false,
  staff: [],
};

export function staffTrade(row: StaffRow): string {
  return (row.trade === OTHER_TRADE ? row.other : row.trade).trim();
}

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;

/**
 * Missing or wrong fields. `belowLegal(row)` says whether a staff row's
 * salary is under the trade's legal minimum (then the owner-told tick is required).
 */
export function businessErrors(
  form: BusinessForm,
  branchVerified: boolean[],
  belowLegal: (row: StaffRow) => boolean,
): string[] {
  const e: string[] = [];
  const household = form.businessType === 'household';
  if (!form.contactName.trim()) e.push('contactName');
  if (!form.contactRole) e.push('contactRole');
  if (!form.language) e.push('language');
  if (!form.heardFrom) e.push('heardFrom');
  if (!form.whatsappSame && !/^[6-9]\d{9}$/.test(form.whatsapp)) e.push('whatsapp');
  if (form.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.billingEmail.trim())) e.push('billingEmail');
  if (!form.boardName.trim()) e.push('boardName');
  if (household && !form.familyName.trim()) e.push('familyName');
  if (!form.businessType) e.push('businessType');
  if (!form.employees) e.push('employees');
  if (!form.shopNumber.trim()) e.push('shopNumber');
  if (!form.street.trim()) e.push('street');
  if (!form.landmark.trim()) e.push('landmark');
  if (!form.place.area) e.push('area');
  if (!/^\d{6}$/.test(form.place.pincode)) e.push('pincode');
  if (form.place.latitude === null) e.push('pin');
  if (!household && !form.noDocuments) {
    if (form.gstin && !GSTIN.test(form.gstin.trim().toUpperCase())) e.push('gstin');
    if (form.pan && !PAN.test(form.pan.trim().toUpperCase())) e.push('pan');
  }
  form.branches.forEach((b, i) => {
    if (!b.name.trim() || !b.contactName.trim() || !b.contactRole || !branchVerified[i]) e.push(`branch${i}`);
  });
  form.staff.forEach((row, i) => {
    if (!staffTrade(row) || !row.salaryMinPaise || !row.shift || !row.startDate) e.push(`staff${i}`);
    if (row.salaryMinPaise && row.salaryMaxPaise && row.salaryMaxPaise < row.salaryMinPaise) e.push(`staff${i}`);
    if (belowLegal(row) && !row.ownerTold) e.push(`staffLegal${i}`);
  });
  return e;
}

/** Body for POST /businesses. */
export function businessBody(form: BusinessForm, otpRequestId: string, branchOtps: string[]) {
  const household = form.businessType === 'household';
  const docs = household || form.noDocuments;
  const address = [form.shopNumber, form.street, form.landmark, form.place.area, form.place.pincode].map((s) => s.trim()).filter(Boolean).join(', ');
  return {
    name: form.boardName.trim(),
    ...(household ? { familyName: form.familyName.trim() } : form.legalName.trim() ? { legalName: form.legalName.trim() } : {}),
    contactPersonName: form.contactName.trim(),
    contactPersonRole: form.contactRole,
    phone: form.mobile,
    otpRequestId,
    contactWhatsAppPhone: form.whatsappSame ? form.mobile : form.whatsapp,
    contactLanguage: form.language,
    ...(form.billingEmail.trim() ? { billingEmail: form.billingEmail.trim() } : {}),
    heardFrom: form.heardFrom,
    businessType: form.businessType,
    employeeCountBand: form.employees,
    ...(form.running ? { yearsInOperationBand: form.running } : {}),
    ...(form.hiring ? { hiringFrequency: form.hiring } : {}),
    ...(form.opensAt ? { openingTime: form.opensAt } : {}),
    ...(form.closesAt ? { closingTime: form.closesAt } : {}),
    ...(form.workingDays.length ? { workingDays: form.workingDays } : {}),
    shopNumber: form.shopNumber.trim(),
    street: form.street.trim(),
    landmark: form.landmark.trim(),
    locality: form.place.area,
    pincode: form.place.pincode,
    address,
    latitude: form.place.latitude,
    longitude: form.place.longitude,
    city: 'Bengaluru',
    ...(docs
      ? { noDocuments: !household }
      : {
          ...(form.gstin.trim() ? { gstNumber: form.gstin.trim().toUpperCase() } : {}),
          ...(form.fssai.trim() ? { fssaiNumber: form.fssai.trim() } : {}),
          ...(form.licenceNumber.trim() ? { [form.licenceKind]: form.licenceNumber.trim() } : {}),
          ...(form.pan.trim() ? { pan: form.pan.trim().toUpperCase() } : {}),
        }),
    ...(form.branches.length
      ? {
          branches: form.branches.map((b, i) => ({
            name: b.name.trim(),
            shopNumber: b.shopNumber.trim() || undefined,
            street: b.street.trim() || undefined,
            landmark: b.landmark.trim() || undefined,
            locality: b.place.area || undefined,
            pincode: b.place.pincode || undefined,
            latitude: b.place.latitude ?? undefined,
            longitude: b.place.longitude ?? undefined,
            contactPersonName: b.contactName.trim(),
            contactPersonRole: b.contactRole,
            contactPersonPhone: b.mobile,
            contactLanguage: b.language || undefined,
            otpRequestId: branchOtps[i],
          })),
        }
      : {}),
    ...(form.staff.length
      ? {
          staffNeededRows: form.staff.map((row) => ({
            trade: staffTrade(row),
            headcount: Number(row.headcount),
            salaryMinPaise: row.salaryMinPaise!,
            salaryMaxPaise: row.salaryMaxPaise ?? row.salaryMinPaise!,
            salaryPeriod: row.period,
            shift: row.shift,
            startDate: row.startDate,
          })),
        }
      : {}),
  };
}
