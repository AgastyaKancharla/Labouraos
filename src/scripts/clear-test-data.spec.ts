import { parseClearArgs } from './clear-test-data';

describe('clear-test-data arguments (one-off clean-up, 26 Nov)', () => {
  it('checks only unless --delete, and reads the kept businesses by code or by name', () => {
    expect(parseClearArgs(['node', 'x', '--keep-names', 'Reddy, Stylish'])).toEqual({ keepCodes: null, keepNames: ['Reddy', 'Stylish'], delete: false });
    expect(parseClearArgs(['node', 'x', '--keep', 'BZ-00009,BZ-00012', '--delete'])).toEqual({ keepCodes: ['BZ-00009', 'BZ-00012'], keepNames: null, delete: true });
    // A flag with no value keeps nothing (the script then stops and changes nothing).
    expect(parseClearArgs(['node', 'x', '--keep', '--delete'])).toEqual({ keepCodes: null, keepNames: null, delete: true });
  });
});
