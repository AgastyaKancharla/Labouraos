import { Prisma } from '@prisma/client';

export interface RecordStatusChangeParams {
  subjectType: string;
  subjectId: string;
  fromStatus: string | null;
  toStatus: string;
  changedByStaffId?: string | null;
  reason?: string | null;
  changedAt?: Date;
}

/**
 * Shared helper for writing status history rows atomically with status changes.
 * Enforces:
 * 1. Executed on the provided Prisma TransactionClient so that a status change
 *    cannot commit without its history record.
 * 2. Actor ID 'system' or undefined/null resolves to null (system-driven change).
 * 3. Never stores personal data (names, phones, emails, Aadhaar numbers) in reason.
 */
export async function recordStatusChange(
  tx: Prisma.TransactionClient,
  params: RecordStatusChangeParams,
) {
  if (!(tx as any)?.statusHistory?.create) {
    return null;
  }

  const actor =
    params.changedByStaffId && params.changedByStaffId !== 'system'
      ? params.changedByStaffId
      : null;

  // Sanitize reason: ensure no raw phone numbers or email patterns leak into reason
  let sanitizedReason: string | null = params.reason ?? null;
  if (sanitizedReason) {
    // Redact 10-12 digit phone numbers
    sanitizedReason = sanitizedReason.replace(/\b\d{10,12}\b/g, '[phone]');
    // Redact email addresses
    sanitizedReason = sanitizedReason.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[email]',
    );
  }

  return tx.statusHistory.create({
    data: {
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      changedByStaffId: actor,
      reason: sanitizedReason,
      changedAt: params.changedAt ?? new Date(),
    },
  });
}
