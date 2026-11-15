import { addressBucket, expandIpv6 } from './address-bucket';

describe('Address buckets for per-address limits (M1)', () => {
  it('expands every IPv6 spelling to 8 hextets', () => {
    expect(expandIpv6('::1')).toEqual(['0000', '0000', '0000', '0000', '0000', '0000', '0000', '0001']);
    expect(expandIpv6('2401:4900::5d3e:1')).toEqual(['2401', '4900', '0000', '0000', '0000', '0000', '5d3e', '0001']);
    expect(expandIpv6('::ffff:203.0.113.9')).toEqual(['0000', '0000', '0000', '0000', '0000', 'ffff', 'cb00', '7109']);
    expect(expandIpv6('1.2.3.4')).toBeNull();
  });

  it('an IPv6 address counts as its /64, whatever the spelling', () => {
    const b = addressBucket('2401:4900:1c2a:5d3e::1');
    expect(b).toBe('2401:4900:1c2a:5d3e::/64');
    for (const other of ['2401:4900:1c2a:5d3e:ffff:ffff:ffff:ffff', '2401:4900:1C2A:5D3E:1:2:3:4', '[2401:4900:1c2a:5d3e::abcd]', '2401:4900:1c2a:5d3e:0:0:0:9%eth0']) {
      expect(addressBucket(other)).toBe(b);
    }
    expect(addressBucket('2401:4900:1c2a:5d3f::1')).not.toBe(b);
  });

  it('IPv4 stays itself; IPv4-mapped IPv6 counts as the IPv4 address', () => {
    expect(addressBucket('203.0.113.9')).toBe('203.0.113.9');
    expect(addressBucket('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(addressBucket('::ffff:cb00:7109')).toBe('203.0.113.9');
    expect(addressBucket(null)).toBeNull();
    expect(addressBucket('  ')).toBeNull();
  });
});
