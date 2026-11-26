import { BadRequestException } from '@nestjs/common';
import { evaluateProofs, validProofCount } from './business-proofs';
import { isValidOtherLicenceNumber, parseOtherLicences, readOtherLicences } from './other-licences';

describe('other licences (26 Nov: documents that fit the business type)', () => {
  it('reads each kind once, in the right shape, upper-cased', () => {
    expect(parseOtherLicences([{ kind: 'drug_licence', number: ' ka-b51-20/123456 ' }, { kind: 'kpme', number: '' }])).toEqual([
      { kind: 'drug_licence', number: 'KA-B51-20/123456' },
    ]);
    expect(parseOtherLicences(undefined)).toEqual([]);
    expect(() => parseOtherLicences([{ kind: 'aadhaar', number: '1234 5678' }])).toThrow(BadRequestException);
    expect(() => parseOtherLicences([{ kind: 'peso', number: 'ABC' }])).toThrow(BadRequestException);
    expect(() => parseOtherLicences([{ kind: 'psara', number: 'PSA/12' }, { kind: 'psara', number: 'PSA/13' }])).toThrow(BadRequestException);
    expect(() => parseOtherLicences('PSA/12')).toThrow(BadRequestException);
    expect(isValidOtherLicenceNumber('CL-9/2021')).toBe(true);
    expect(isValidOtherLicenceNumber('NONE')).toBe(false);
    expect(readOtherLicences([{ kind: 'excise', number: 'CL9 123' }, { kind: 'x', number: '1' }, 'junk'])).toEqual([{ kind: 'excise', number: 'CL9 123' }]);
  });

  it('a valid one counts as proof 2, like FSSAI (owner, 26 Nov)', () => {
    const gst = '29ABCDE1234F1Z5';
    const pharmacy = { gstNumber: gst, otherLicences: [{ kind: 'drug_licence', number: 'KA-B51-20/123456' }] };
    const licence = evaluateProofs(pharmacy).find((p) => p.key === 'licence')!;
    expect(licence).toMatchObject({ given: true, valid: true, detail: 'drug_licence' });
    expect(validProofCount({ otherLicences: [{ kind: 'kpme', number: 'BLR/KPME/2024/0007' }] })).toBe(1);
    expect(evaluateProofs({ otherLicences: [{ kind: 'kpme', number: 'XX' }] }).find((p) => p.key === 'licence')).toMatchObject({ given: true, valid: false });
    expect(evaluateProofs({}).find((p) => p.key === 'licence')).toMatchObject({ given: false, valid: false });
  });
});
