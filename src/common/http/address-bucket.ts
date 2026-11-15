import { isIP } from 'node:net';

/**
 * The 8 hextets of an IPv6 address, lower case, zero-padded ("::1" →
 * 0000:…:0001; an embedded IPv4 tail is turned into two hextets). Null when
 * the text is not an IPv6 address.
 */
export function expandIpv6(raw: string): string[] | null {
  const ip = raw.trim().replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
  if (isIP(ip) !== 6) return null;
  let text = ip;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === null ? [] : new Array(8 - left.length - right.length).fill('0');
  const parts = [...left, ...fill, ...right];
  if (parts.length !== 8) return null;
  return parts.map((p) => p.padStart(4, '0'));
}

/**
 * M1: the key used to count requests "from one address". An IPv4 address is
 * itself (an IPv4-mapped IPv6 address counts as its IPv4 address). An IPv6
 * address counts as its /64: one home or mobile connection gets a whole /64
 * and can pick any address in it, so counting single IPv6 addresses would let
 * one phone rotate past every per-address limit.
 */
export function addressBucket(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const ip = String(raw).trim();
  if (isIP(ip) === 4) return ip;
  const parts = expandIpv6(ip);
  if (!parts) return ip;
  // ::ffff:a.b.c.d (IPv4-mapped): the IPv4 address.
  if (parts.slice(0, 5).every((p) => p === '0000') && parts[5] === 'ffff') {
    const hi = parseInt(parts[6]!, 16);
    const lo = parseInt(parts[7]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${parts.slice(0, 4).join(':')}::/64`;
}
