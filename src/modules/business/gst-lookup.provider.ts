export const GST_LOOKUP_PROVIDER = 'GST_LOOKUP_PROVIDER';

export interface GstLookupResult {
  verified: boolean;
  legalName: string | null;
  status: string;
}

export interface GstLookupProvider {
  lookup(gstNumber: string): Promise<GstLookupResult>;
}

export class MockGstLookupProvider implements GstLookupProvider {
  async lookup(_gstNumber: string): Promise<GstLookupResult> {
    void _gstNumber;
    return { verified: false, legalName: null, status: 'not_verified_by_mock' };
  }
}
