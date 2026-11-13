import { BlockList, isIP } from 'node:net';

/** Express reports IPv4 peers as IPv4-mapped IPv6. Compare them as IPv4. */
export function normalizeIp(raw: string): string {
  const trimmed = raw.trim();
  const mapped = trimmed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) {
    return mapped[1];
  }
  return trimmed;
}

export function parseCidr(cidr: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const trimmed = cidr.trim();
  const slash = trimmed.lastIndexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null;
  }
  const address = normalizeIp(trimmed.slice(0, slash));
  const prefix = Number(trimmed.slice(slash + 1));
  const version = isIP(address);
  if (version === 0 || !Number.isInteger(prefix)) {
    return null;
  }
  const max = version === 4 ? 32 : 128;
  if (prefix < 0 || prefix > max) {
    return null;
  }
  return { address, prefix, family: version === 4 ? 'ipv4' : 'ipv6' };
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  const address = normalizeIp(ip);
  const version = isIP(address);
  if (!parsed || version === 0) {
    return false;
  }
  const family = version === 4 ? 'ipv4' : 'ipv6';
  if (family !== parsed.family) {
    return false;
  }
  try {
    const list = new BlockList();
    list.addSubnet(parsed.address, parsed.prefix, parsed.family);
    return list.check(address, family);
  } catch {
    return false;
  }
}
