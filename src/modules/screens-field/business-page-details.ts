import { phoneLast4 } from '../../common/phone/indian-mobile';
import { OTHER_LICENCE_LABELS, readOtherLicences } from '../business/other-licences';

/**
 * The "Details" tab of the business profile in Laboura Field (owner, 27 Nov:
 * "I should see all the details, and it should be same in both tabs").
 *
 * Phone numbers leave as their last 4 digits only (AGENTS.md §7). The owner's
 * and legal names and every document number go only to an agent who sees the
 * full record (account agent, lead creator, open verification visit:
 * business-agent-view.ts); any other agent gets them as null with
 * `documentsHidden: true`. The PAN leaves as its last 4 characters.
 */
export interface BusinessPageDetails {
  address: {
    shopNumber: string | null;
    street: string | null;
    landmark: string | null;
    locality: string | null;
    city: string;
    pincode: string | null;
    full: string | null;
    runsFromHome: boolean;
  };
  map: { latitude: number | null; longitude: number | null; mapsLink: string | null; placeName: string | null };
  businessTypeOther: string | null;
  people: {
    ownerName: string | null;
    legalName: string | null;
    contactName: string | null;
    contactRole: string | null;
    phoneLast4: string | null;
    phoneVerified: boolean;
    whatsappLast4: string | null;
    otherContactLast4: string | null;
  };
  staff: { employeeCount: number | null; employeeCountBand: string | null; staffNeeded: string[] };
  documentsHidden: boolean;
  documents: {
    gst: { number: string; verified: boolean | null; status: string | null; legalName: string | null } | null;
    fssai: string | null;
    tradeLicence: string | null;
    shopEstablishment: string | null;
    udyam: string | null;
    panLast4: string | null;
    others: { kind: string; label: string; number: string }[];
    noDocuments: boolean;
  };
  onboarding: {
    registeredAt: string;
    registeredBy: string | null;
    channel: string | null;
    heardFrom: string | null;
    inPersonAt: string | null;
    verifiedAt: string | null;
  };
  branches: { id: string; name: string; locality: string | null; contactName: string; contactLast4: string | null }[];
}

export interface DetailsSource {
  shopNumber: string | null;
  street: string | null;
  landmark: string | null;
  locality: string | null;
  city: string;
  pincode: string | null;
  address: string | null;
  runsFromHome: boolean;
  latitude: number | null;
  longitude: number | null;
  mapsLink: string | null;
  mapsPlaceName: string | null;
  businessTypeOther: string | null;
  ownerName: string | null;
  legalName: string | null;
  additionalContactName: string | null;
  additionalContactPhone: string | null;
  contactRole: string | null;
  phone: string;
  phoneVerified: boolean;
  contactWhatsAppPhone: string | null;
  employeeCount: number | null;
  employeeCountBand: string | null;
  staffNeeded: string[];
  gstNumber: string | null;
  gstVerified: boolean | null;
  gstStatus: string | null;
  gstLegalName: string | null;
  fssaiNumber: string | null;
  licenceNumber: string | null;
  shopEstablishmentNumber: string | null;
  udyamNumber: string | null;
  pan: string | null;
  otherLicences: unknown;
  documentsStatus: string | null;
  createdAt: Date;
  leadChannel: string | null;
  heardFrom: string | null;
  inPersonOnboardedAt: Date | null;
  verifiedAt: Date | null;
}

const text = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

export function businessPageDetails(
  b: DetailsSource,
  opts: {
    /** The agent may act on it (own business): phone digits are shown. */
    canAct: boolean;
    /** The agent sees the full record: names and document numbers are shown. */
    full: boolean;
    registeredBy: string | null;
    branches: { id: string; name: string; locality: string | null; contactPersonName: string; contactPersonPhone: string }[];
  },
): BusinessPageDetails {
  const { canAct, full } = opts;
  const others = full ? readOtherLicences(b.otherLicences) : [];
  const contactName = text(b.additionalContactName) ?? (full ? text(b.ownerName) : null);
  return {
    address: {
      shopNumber: text(b.shopNumber),
      street: text(b.street),
      landmark: text(b.landmark),
      locality: text(b.locality),
      city: b.city,
      pincode: text(b.pincode),
      full: text(b.address),
      runsFromHome: b.runsFromHome,
    },
    map: {
      latitude: b.latitude,
      longitude: b.longitude,
      mapsLink: text(b.mapsLink),
      placeName: text(b.mapsPlaceName),
    },
    businessTypeOther: text(b.businessTypeOther),
    people: {
      ownerName: full ? text(b.ownerName) : null,
      legalName: full ? text(b.legalName) : null,
      contactName,
      contactRole: text(b.contactRole),
      phoneLast4: canAct ? phoneLast4(b.phone) : null,
      phoneVerified: b.phoneVerified,
      whatsappLast4: canAct && b.contactWhatsAppPhone ? phoneLast4(b.contactWhatsAppPhone) : null,
      // A second number, only when it differs from the main one.
      otherContactLast4: canAct && b.additionalContactPhone && b.additionalContactPhone !== b.phone ? phoneLast4(b.additionalContactPhone) : null,
    },
    staff: {
      employeeCount: b.employeeCount,
      employeeCountBand: text(b.employeeCountBand),
      staffNeeded: b.staffNeeded ?? [],
    },
    documentsHidden: !full,
    documents: {
      gst: full && text(b.gstNumber)
        ? { number: text(b.gstNumber)!, verified: b.gstVerified, status: text(b.gstStatus), legalName: text(b.gstLegalName) }
        : null,
      fssai: full ? text(b.fssaiNumber) : null,
      tradeLicence: full ? text(b.licenceNumber) : null,
      shopEstablishment: full ? text(b.shopEstablishmentNumber) : null,
      udyam: full ? text(b.udyamNumber) : null,
      panLast4: full && text(b.pan) ? text(b.pan)!.slice(-4) : null,
      others: others.map((o) => ({ kind: o.kind, label: OTHER_LICENCE_LABELS[o.kind], number: o.number })),
      noDocuments: b.documentsStatus === 'none',
    },
    onboarding: {
      registeredAt: b.createdAt.toISOString(),
      registeredBy: opts.registeredBy,
      channel: text(b.leadChannel),
      heardFrom: text(b.heardFrom),
      inPersonAt: b.inPersonOnboardedAt?.toISOString() ?? null,
      verifiedAt: b.verifiedAt?.toISOString() ?? null,
    },
    branches: opts.branches.map((br) => ({
      id: br.id,
      name: br.name,
      locality: text(br.locality),
      contactName: br.contactPersonName,
      contactLast4: canAct ? phoneLast4(br.contactPersonPhone) : null,
    })),
  };
}
