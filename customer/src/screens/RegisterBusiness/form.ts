import type { BusinessContactRole, BusinessForm, BusinessType, HeardFrom, Pin, Shift } from '@/api/types';
import type { MessageKey } from '@/i18n';
import { isEmail, isGstin, isPincode } from '@/lib/validate';

export interface StaffRow {
  trade: string;
  count: number | null;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  shift: Shift;
  startDate: string;
}

export interface BusinessDraft {
  contactName: string;
  contactRole: '' | BusinessContactRole;
  boardName: string;
  legalName: string;
  businessType: '' | BusinessType;
  employeesNow: number | null;
  yearsRunning: number | null;
  shopNumber: string;
  street: string;
  landmark: string;
  area: string;
  pincode: string;
  pin: Pin | null;
  gstin: string;
  fssai: string;
  shopEstablishment: string;
  udyamOrTradeLicence: string;
  pan: string;
  noDocuments: boolean;
  staffNeeded: StaffRow[];
  billingEmail: string;
  heardFrom: HeardFrom;
}

export const emptyStaffRow = (): StaffRow => ({ trade: '', count: 1, salaryMinPaise: null, salaryMaxPaise: null, shift: 'day', startDate: '' });

export const emptyBusiness = (): BusinessDraft => ({
  contactName: '',
  contactRole: '',
  boardName: '',
  legalName: '',
  businessType: '',
  employeesNow: null,
  yearsRunning: null,
  shopNumber: '',
  street: '',
  landmark: '',
  area: '',
  pincode: '',
  pin: null,
  gstin: '',
  fssai: '',
  shopEstablishment: '',
  udyamOrTradeLicence: '',
  pan: '',
  noDocuments: false,
  staffNeeded: [emptyStaffRow()],
  billingEmail: '',
  heardFrom: 'laboura_app',
});

export type BusinessErrors = Partial<Record<string, MessageKey>>;

/** The guide's business registration form (decided 9 Nov). Documents are optional. */
export function validateBusiness(d: BusinessDraft): BusinessErrors {
  const e: BusinessErrors = {};
  if (d.contactName.trim().length < 2) e.contactName = 'form.required';
  if (!d.contactRole) e.contactRole = 'form.required';
  if (d.boardName.trim().length < 2) e.boardName = 'form.required';
  if (!d.businessType) e.businessType = 'form.required';
  if (d.employeesNow === null) e.employeesNow = 'form.required';
  if (d.street.trim().length < 2) e.street = 'form.required';
  if (!d.area) e.area = 'form.required';
  if (!isPincode(d.pincode)) e.pincode = 'form.pincodeInvalid';
  if (d.gstin.trim() && !isGstin(d.gstin)) e.gstin = 'business.gstinInvalid';
  if (d.billingEmail.trim() && !isEmail(d.billingEmail)) e.billingEmail = 'business.emailInvalid';
  if (d.staffNeeded.length === 0) e.staff = 'business.staffNeeded';
  d.staffNeeded.forEach((row, i) => {
    if (!row.trade) e[`staffTrade${i}`] = 'form.required';
    if (!row.count || row.count < 1) e[`staffCount${i}`] = 'form.required';
    if (row.salaryMinPaise && row.salaryMaxPaise && row.salaryMaxPaise < row.salaryMinPaise) e[`staffSalary${i}`] = 'jobSeeker.maxBelowMin';
  });
  return e;
}

export function toBusinessForm(d: BusinessDraft): BusinessForm {
  const docs = d.noDocuments
    ? {}
    : Object.fromEntries(
        (
          [
            ['gstin', d.gstin.trim().toUpperCase()],
            ['fssai', d.fssai.trim()],
            ['shopEstablishment', d.shopEstablishment.trim()],
            ['udyamOrTradeLicence', d.udyamOrTradeLicence.trim()],
            ['pan', d.pan.trim().toUpperCase()],
          ] as const
        ).filter(([, v]) => v),
      );
  return {
    contactName: d.contactName.trim(),
    contactRole: d.contactRole as BusinessContactRole,
    boardName: d.boardName.trim(),
    legalName: d.legalName.trim() || d.boardName.trim(),
    businessType: d.businessType as BusinessType,
    employeesNow: d.employeesNow ?? 0,
    yearsRunning: d.yearsRunning ?? 0,
    shopNumber: d.shopNumber.trim(),
    street: d.street.trim(),
    landmark: d.landmark.trim(),
    area: d.area,
    pincode: d.pincode.trim(),
    pin: d.pin,
    documents: docs,
    noDocuments: d.noDocuments,
    staffNeeded: d.staffNeeded.map((row) => ({
      trade: row.trade,
      count: row.count ?? 1,
      salaryMinPaise: row.salaryMinPaise,
      salaryMaxPaise: row.salaryMaxPaise,
      shift: row.shift,
      startDate: row.startDate || null,
    })),
    billingEmail: d.billingEmail.trim(),
    heardFrom: d.heardFrom,
  };
}
