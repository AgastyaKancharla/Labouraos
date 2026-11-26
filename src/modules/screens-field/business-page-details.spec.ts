import { businessPageDetails, type DetailsSource } from './business-page-details';

const row: DetailsSource = {
  shopNumber: '12', street: '9th Main', landmark: 'Near Ganesha temple', locality: 'Jayanagar', city: 'Bengaluru', pincode: '560041',
  address: '12, 9th Main, Near Ganesha temple, Jayanagar, 560041', runsFromHome: false,
  latitude: 12.93, longitude: 77.58, mapsLink: 'https://maps.app.goo.gl/x', mapsPlaceName: 'V Stylish',
  businessTypeOther: null, ownerName: 'Jagdish Kumar', legalName: 'V Stylish Unisex Salon',
  additionalContactName: 'Jagdish', additionalContactPhone: '+919845002298', contactRole: 'owner',
  phone: '+919845002298', phoneVerified: true, contactWhatsAppPhone: '+919845002298',
  employeeCount: null, employeeCountBand: '6-20', staffNeeded: ['Hair stylist'],
  gstNumber: '29ABCDE1234F1Z5', gstVerified: true, gstStatus: 'Active', gstLegalName: 'V STYLISH',
  fssaiNumber: null, licenceNumber: 'BBMP/TL/1234', shopEstablishmentNumber: null, udyamNumber: null, pan: 'FGHIJ5678K',
  otherLicences: [{ kind: 'psara', number: 'PSARA/22/09' }], documentsStatus: 'provided',
  createdAt: new Date('2026-11-26T05:56:00Z'), leadChannel: 'field_visit', heardFrom: 'field_visit',
  inPersonOnboardedAt: new Date('2026-11-26T05:56:00Z'), verifiedAt: null,
};
const branches = [{ id: 'br-1', name: 'V Stylish 2', locality: 'BTM', contactPersonName: 'Ravi', contactPersonPhone: '+919900112233' }];

describe('business profile details (27 Nov)', () => {
  it('his own business: address, people, staff and documents, phones as last 4 only, PAN last 4', () => {
    const d = businessPageDetails(row, { canAct: true, full: true, registeredBy: 'fa test', branches });
    expect(d.address).toMatchObject({ shopNumber: '12', street: '9th Main', landmark: 'Near Ganesha temple', pincode: '560041' });
    expect(d.people).toMatchObject({ ownerName: 'Jagdish Kumar', contactName: 'Jagdish', phoneLast4: '2298', whatsappLast4: '2298', otherContactLast4: null });
    expect(d.documents).toMatchObject({ gst: { number: '29ABCDE1234F1Z5', verified: true }, tradeLicence: 'BBMP/TL/1234', panLast4: '678K' });
    expect(d.documents.others).toEqual([{ kind: 'psara', label: 'PSARA licence', number: 'PSARA/22/09' }]);
    expect(d.onboarding.registeredBy).toBe('fa test');
    expect(d.branches).toEqual([{ id: 'br-1', name: 'V Stylish 2', locality: 'BTM', contactName: 'Ravi', contactLast4: '2233' }]);
    expect(JSON.stringify(d)).not.toContain('9845002298');
    expect(JSON.stringify(d)).not.toContain('FGHIJ5678K');
  });

  it("someone else's business: no names, no document numbers, no phone digits", () => {
    const d = businessPageDetails(row, { canAct: false, full: false, registeredBy: 'fa test', branches });
    expect(d.documentsHidden).toBe(true);
    expect(d.people).toMatchObject({ ownerName: null, legalName: null, phoneLast4: null, whatsappLast4: null });
    expect(d.documents).toMatchObject({ gst: null, tradeLicence: null, panLast4: null, others: [] });
    expect(d.branches[0].contactLast4).toBeNull();
    expect(d.address.street).toBe('9th Main');
  });
});
