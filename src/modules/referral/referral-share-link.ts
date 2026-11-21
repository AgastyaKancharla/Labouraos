import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import * as qrcode from 'qrcode-generator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { publicLink } from '../../common/public-link';

/**
 * A referral partner's personal share link and QR (Master Guide rev 202, 21 Nov):
 * `https://app.laboura.com/p/ref/<slug>`. The slug is random (not the RF code,
 * so nobody can walk through partners by counting) and made on first use. A
 * person who opens it leaves their name and number; the lead is assigned to a
 * call agent and registering them fills "referred by" with this partner.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const SHARE_SLUG_LENGTH = 10;
export const SHARE_SLUG_PATTERN = /^[a-hj-km-np-z2-9]{10}$/;

export function newShareSlug(): string {
  const bytes = randomBytes(SHARE_SLUG_LENGTH);
  let out = '';
  for (let i = 0; i < SHARE_SLUG_LENGTH; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function shareLinkPath(slug: string): string {
  return `/p/ref/${slug}`;
}

export function shareLinkUrl(slug: string): string {
  return publicLink(shareLinkPath(slug));
}

/** The partner's slug, made (once) when it is first asked for. */
export async function ensureShareSlug(prisma: PrismaService, referralId: string): Promise<string> {
  const row = await prisma.referral.findUnique({ where: { id: referralId }, select: { shareSlug: true } });
  if (!row) throw new Error('referral not found');
  if (row.shareSlug) return row.shareSlug;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = newShareSlug();
    try {
      const done = await prisma.referral.updateMany({ where: { id: referralId, shareSlug: null }, data: { shareSlug: slug } });
      if (done.count > 0) return slug;
      const again = await prisma.referral.findUnique({ where: { id: referralId }, select: { shareSlug: true } });
      if (again?.shareSlug) return again.shareSlug;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }
  throw new Error('could not make a share link');
}

/** The QR code for the link, as an SVG the partner can print or share. */
export function shareQrSvg(url: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}
