import type { Trade } from '@/api/endpoints';
import { isOtherLicence, isValidOtherLicenceNumber, OTHER_LICENCE_KINDS, type DocKey } from '@/lib/businessDocuments';

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
  billingEmail: string;
  heardFrom: string;
  boardName: string;
  legalName: string;
  /** 22 Nov (rev 207): "Same as the shop name" — the legal name follows the board name, read-only. Older drafts have none. */
  legalSameAsShop?: boolean;
  familyName: string;
  businessType: string;
  /** 22 Nov (rev 208): "Other (type it)" — required when the type is other. Older drafts have none. */
  businessTypeOther?: string;
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
  /** From the Maps link lookup or typed (17 Nov); decides the legal minimum wage zone with the PIN code. Older drafts have none. */
  city?: string;
  pin: { latitude: number; longitude: number } | null;
  branches: BranchRow[];
  gstin: string;
  fssai: string;
  /** Older drafts picked one of three kinds for `licenceNumber`; new forms always use it for the trade licence. */
  licenceKind: 'shopEstablishmentNumber' | 'udyamNumber' | 'licenceNumber';
  /** The trade licence (BBMP / municipal). */
  licenceNumber: string;
  pan: string;
  /** 26 Nov: Shop & Establishment, Udyam and the other licences (drug licence, KPME, excise…), by key. Older drafts have none. */
  licences?: Partial<Record<DocKey, string>>;
  /** 26 Nov: documents the agent added with "+ Add another document". Older drafts have none. */
  extraDocs?: DocKey[];
  noDocuments: boolean;
  /** 25 Nov (rev 211, B2): a Google Maps link to the shop, one of the proofs. Older drafts have none. */
  mapsLink?: string;
  /** 25 Nov (rev 211, B1): runs from the owner's home (not a household hiring help). Older drafts have none. */
  runsFromHome?: boolean;
  staff: StaffRow[];
}

/** The city when nothing else is known (the business form's old fixed value). */
export const DEFAULT_CITY = 'Bengaluru';
const OTHER_TRADE = '__other__';
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;

/** The value typed for a document (each kind lives where the server reads it). */
export function docValue(form: Pick<FormState, 'gstin' | 'fssai' | 'licenceNumber' | 'pan' | 'licences'>, key: DocKey): string {
  if (key === 'gst') return form.gstin;
  if (key === 'fssai') return form.fssai;
  if (key === 'trade') return form.licenceNumber;
  if (key === 'pan') return form.pan;
  return form.licences?.[key] ?? '';
}

/** The fields to set when a document's box changes. */
export function docPatch(form: Pick<FormState, 'licences'>, key: DocKey, value: string): Partial<FormState> {
  if (key === 'gst') return { gstin: value.toUpperCase() };
  if (key === 'fssai') return { fssai: value.replace(/\D/g, '') };
  if (key === 'trade') return { licenceNumber: value, licenceKind: 'licenceNumber' };
  if (key === 'pan') return { pan: value.toUpperCase() };
  return { licences: { ...(form.licences ?? {}), [key]: key === 'udyam' ? value.toUpperCase() : value } };
}

/** A document whose typed number has the wrong shape (empty is fine: every document is optional). */
export function docError(form: Pick<FormState, 'gstin' | 'fssai' | 'licenceNumber' | 'pan' | 'licences'>, key: DocKey): boolean {
  const v = docValue(form, key).trim();
  if (!v) return false;
  if (key === 'gst') return !GSTIN.test(v.toUpperCase());
  if (key === 'pan') return !PAN.test(v.toUpperCase());
  if (key === 'fssai') return !/^[12]\d{13}$/.test(v);
  if (key === 'udyam') return !/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(v.toUpperCase().replace(/\s+/g, ''));
  if (isOtherLicence(key)) return !isValidOtherLicenceNumber(v);
  return false;
}

/** 25 Nov (rev 211, B2): how many of the 3 proofs the form has; fewer than 2 → the small-business checks. */
export function proofCount(form: Pick<FormState, 'gstin' | 'fssai' | 'licenceNumber' | 'mapsLink' | 'licences'>): number {
  const gst = GSTIN.test(form.gstin.trim().toUpperCase()) ? 1 : 0;
  // 26 Nov: Shop & Establishment, Udyam and the other licences count here too (as on the server).
  const others = form.licences ?? {};
  const licence =
    /^[12]\d{13}$/.test(form.fssai.trim()) ||
    form.licenceNumber.trim().length >= 5 ||
    (others.shopEst ?? '').trim().length >= 5 ||
    /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test((others.udyam ?? '').trim().toUpperCase()) ||
    OTHER_LICENCE_KINDS.some((k) => isValidOtherLicenceNumber(others[k] ?? ''))
      ? 1
      : 0;
  const maps = /^https?:\/\/(www\.)?(google\.(com|co\.in)\/maps|maps\.google\.(com|co\.in)|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test((form.mapsLink ?? '').trim()) ? 1 : 0;
  return gst + licence + maps;
}

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
  if (!form.heardFrom) e.push('heardFrom');
  if (form.billingEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.billingEmail.trim())) e.push('billingEmail');
  if (!form.boardName.trim()) e.push('boardName');
  if (household && !form.familyName.trim()) e.push('familyName');
  if (!form.businessType) e.push('businessType');
  if (form.businessType === 'other' && !(form.businessTypeOther ?? '').trim()) e.push('businessTypeOther');
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
    // 26 Nov: every document is optional, but a number typed must have its shape.
    for (const key of ['fssai', 'udyam', ...OTHER_LICENCE_KINDS] as const) if (docError(form, key)) e.push(`doc-${key}`);
  }
  form.branches.forEach((b, i) => {
    if (!b.name.trim() || !b.contactName.trim() || !b.contactRole || !b.mobile.verifiedAt) e.push(`branch${i}`);
  });
  form.staff.forEach((row, i) => {
    const min = paise(row.salaryMin);
    const max = paise(row.salaryMax);
    if (!staffTrade(row) || !min || !row.shift || !row.startDate || (max !== null && max < (min ?? 0))) e.push(`staff${i}`);
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
    ...(household
      ? { familyName: form.familyName.trim() }
      : form.legalSameAsShop && form.boardName.trim()
        ? { legalName: form.boardName.trim() }
        : form.legalName.trim()
          ? { legalName: form.legalName.trim() }
          : {}),
    contactPersonName: form.contactName.trim(),
    contactPersonRole: form.contactRole,
    phone: form.mobile.number,
    otpRequestId: form.mobile.requestId,
    contactWhatsAppPhone: form.whatsappSame ? form.mobile.number : form.whatsapp,
    ...(form.billingEmail.trim() ? { billingEmail: form.billingEmail.trim() } : {}),
    heardFrom: form.heardFrom,
    businessType: form.businessType,
    ...(form.businessType === 'other' ? { businessTypeOther: (form.businessTypeOther ?? '').trim() } : {}),
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
    city: form.city?.trim() || DEFAULT_CITY,
    ...(visitId ? { fieldVisitId: visitId } : {}),
    ...(docs
      ? { noDocuments: !household }
      : {
          ...(form.gstin.trim() ? { gstNumber: form.gstin.trim() } : {}),
          ...(form.fssai.trim() ? { fssaiNumber: form.fssai.trim() } : {}),
          ...(form.licenceNumber.trim() ? { [form.licenceKind ?? 'licenceNumber']: form.licenceNumber.trim() } : {}),
          ...(form.pan.trim() ? { pan: form.pan.trim() } : {}),
          ...((form.licences?.shopEst ?? '').trim() ? { shopEstablishmentNumber: (form.licences?.shopEst ?? '').trim() } : {}),
          ...((form.licences?.udyam ?? '').trim() ? { udyamNumber: (form.licences?.udyam ?? '').trim().toUpperCase().replace(/\s+/g, '') } : {}),
          ...(otherLicencesOf(form).length ? { otherLicences: otherLicencesOf(form) } : {}),
        }),
    ...(!household && (form.mapsLink ?? '').trim() ? { mapsLink: (form.mapsLink ?? '').trim() } : {}),
    ...(!household && form.runsFromHome ? { runsFromHome: true } : {}),
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

/** The drug licence, KPME, excise… numbers typed, as POST /businesses takes them. */
export function otherLicencesOf(form: Pick<FormState, 'licences'>): { kind: string; number: string }[] {
  return OTHER_LICENCE_KINDS.flatMap((kind) => {
    const number = (form.licences?.[kind] ?? '').trim();
    return number ? [{ kind, number }] : [];
  });
}
