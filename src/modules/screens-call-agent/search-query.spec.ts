import { parseSearchQuery } from './search.service';

describe('reading the search bar', () => {
  it('reads IDs with or without the zero padding, in any case', () => {
    expect(parseSearchQuery('JS-00198')).toEqual({ kind: 'id', idType: 'job_seeker', code: 'JS-00198' });
    expect(parseSearchQuery('bz-207')).toEqual({ kind: 'id', idType: 'business', code: 'BZ-00207' });
    expect(parseSearchQuery('RF 19')).toEqual({ kind: 'id', idType: 'referral', code: 'RF-00019' });
    expect(parseSearchQuery('VC-')).toEqual({ kind: 'id', idType: 'vacancy', code: 'VC-' });
    expect(parseSearchQuery('PL-00012')).toEqual({ kind: 'id', idType: 'placement', code: 'PL-00012' });
  });

  it('reads a mobile number, full or the last 4 digits', () => {
    expect(parseSearchQuery('4412')).toEqual({ kind: 'phone', digits: '4412' });
    expect(parseSearchQuery('98765 43210')).toEqual({ kind: 'phone', digits: '9876543210' });
    expect(parseSearchQuery('+91 98765 43210')).toEqual({ kind: 'phone', digits: '9876543210' });
    expect(parseSearchQuery('123')).toBeNull();
  });

  it.each(['9876543210', '+919876543210', '+91 98765 43210', '919876543210', '09876543210', '98765-43210'])(
    'reads the mobile typed as %j as the 10 digits of the saved +919876543210',
    (typed) => {
      expect(parseSearchQuery(typed)).toEqual({ kind: 'phone', digits: '9876543210' });
    },
  );

  it('reads anything else as a name, from 2 letters', () => {
    expect(parseSearchQuery('  Ramesh   Gowda ')).toEqual({ kind: 'name', name: 'Ramesh Gowda' });
    expect(parseSearchQuery('R')).toBeNull();
    expect(parseSearchQuery('')).toBeNull();
  });
});
