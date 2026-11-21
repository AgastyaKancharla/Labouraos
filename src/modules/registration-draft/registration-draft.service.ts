import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OtpService } from '../../common/otp/otp.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  cleanDraftData,
  DraftKind,
  draftCheckHolds,
  draftExpiryCutoff,
  draftMobile,
  DRAFT_OTP_PREFIX,
  isDraftKind,
  MAX_DRAFT_BYTES,
  sameMobile,
} from './registration-draft.rules';

/** The banner and Resume: one row per unfinished form of this agent. */
export interface DraftView {
  id: string;
  kind: DraftKind;
  name: string | null;
  phone: string | null;
  /** The mobile was checked by OTP on this draft (and has not changed since). */
  phoneVerified: boolean;
  data: Prisma.JsonValue;
  updatedAt: Date;
}

type DraftRow = { id: string; kind: string; name: string | null; phone: string | null; verifiedPhone: string | null; verifiedAt: Date | null; data: Prisma.JsonValue; updatedAt: Date };

/**
 * Unfinished registrations (Master Guide rev 204, 21 Nov): the call agent's
 * job seeker, business and referral partner forms, saved on the server as
 * they type. Every read and write is of the caller's own drafts only (by
 * staff id from the sign-in); nobody else — no other agent, Team Lead,
 * Manager or the CEO — has a way to read them.
 */
@Injectable()
export class RegistrationDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
  ) {}

  /** The clock (tests move it). */
  protected now(): Date {
    return new Date();
  }

  private view(row: DraftRow): DraftView {
    return {
      id: row.id,
      kind: row.kind as DraftKind,
      name: row.name,
      phone: row.phone,
      phoneVerified: draftCheckHolds(row, row.phone ?? '', this.now()),
      data: row.data,
      updatedAt: row.updatedAt,
    };
  }

  async mine(staffId: string): Promise<DraftView[]> {
    const rows = await this.prisma.registrationDraft.findMany({
      where: { staffId, updatedAt: { gte: draftExpiryCutoff(this.now()) } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.view(row));
  }

  /**
   * Saves the form as it stands. `otpRequestId` (kept in the console's memory
   * only) marks the number checked when that code was verified for it; a draft
   * keeps that check while the number stays the same, and loses it when the
   * number changes.
   */
  async save(staffId: string, body: { kind?: unknown; data?: unknown; name?: unknown; mobile?: unknown; otpRequestId?: unknown }): Promise<DraftView> {
    if (!isDraftKind(body?.kind)) throw new BadRequestException('kind must be job_seeker, business or referral');
    const kind = body.kind;
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new BadRequestException('data must be the form');
    const data = cleanDraftData(body.data) ?? {};
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_DRAFT_BYTES) throw new BadRequestException('The form is too large to save');
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null;
    const phone = draftMobile(body.mobile);
    const now = this.now();
    const existing = await this.prisma.registrationDraft.findUnique({ where: { staffId_kind: { staffId, kind } } });
    let verifiedPhone: string | null = null;
    let verifiedAt: Date | null = null;
    const requestId = typeof body.otpRequestId === 'string' ? body.otpRequestId : '';
    if (phone && requestId && !requestId.startsWith(DRAFT_OTP_PREFIX) && (await this.otp.isVerified(requestId, phone))) {
      verifiedPhone = phone;
      verifiedAt = now;
    } else if (phone && existing && draftCheckHolds(existing, phone, now)) {
      verifiedPhone = existing.verifiedPhone;
      verifiedAt = existing.verifiedAt;
    }
    const row = await this.prisma.registrationDraft.upsert({
      where: { staffId_kind: { staffId, kind } },
      create: { staffId, kind, name, phone, verifiedPhone, verifiedAt, data },
      update: { name, phone, verifiedPhone, verifiedAt, data },
    });
    return this.view(row);
  }

  async discard(staffId: string, kind: unknown): Promise<{ deleted: number }> {
    if (!isDraftKind(kind)) throw new BadRequestException('kind must be job_seeker, business or referral');
    const { count } = await this.prisma.registrationDraft.deleteMany({ where: { staffId, kind } });
    return { deleted: count };
  }
}

/**
 * For the create routes: is `otpRequestId` "draft:<kind>" and does the caller's
 * own draft of that kind keep an OTP check for this very number?
 */
export async function draftPhoneCheckHolds(
  prisma: Pick<PrismaService, 'registrationDraft'>,
  actorId: string,
  otpRequestId: unknown,
  kind: DraftKind,
  phone: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (typeof otpRequestId !== 'string' || otpRequestId !== `${DRAFT_OTP_PREFIX}${kind}`) return false;
  const draft = await prisma.registrationDraft.findUnique({ where: { staffId_kind: { staffId: actorId, kind } } });
  return draftCheckHolds(draft, phone, now);
}

/**
 * Uses the draft's OTP check up, once: the draft is deleted (the registration
 * is being submitted). False when it was already used or no longer matches.
 */
export async function consumeDraftPhoneCheck(
  prisma: Pick<PrismaService, 'registrationDraft'>,
  actorId: string,
  kind: DraftKind,
  phone: string,
  now: Date = new Date(),
): Promise<boolean> {
  const draft = await prisma.registrationDraft.findUnique({ where: { staffId_kind: { staffId: actorId, kind } } });
  if (!draftCheckHolds(draft, phone, now)) return false;
  const { count } = await prisma.registrationDraft.deleteMany({
    where: { id: draft!.id, staffId: actorId, kind, verifiedPhone: draft!.verifiedPhone },
  });
  return count === 1;
}

/** After a registration is saved, the agent's draft of that kind goes (best effort). */
export async function clearDraftAfterSubmit(prisma: Pick<PrismaService, 'registrationDraft'>, actorId: string | null | undefined, kind: DraftKind): Promise<void> {
  if (!actorId) return;
  await prisma.registrationDraft.deleteMany({ where: { staffId: actorId, kind } }).catch(() => undefined);
}

export { sameMobile };
