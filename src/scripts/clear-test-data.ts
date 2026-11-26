/**
 * One-off clean-up before going live (owner, 26 Nov 2026): removes the test data that field
 * agents and the office made while testing, keeping only the businesses named on the command line.
 *
 * Removed: every business except the kept ones (with their vacancies, shifts, visits, agreements,
 * branches, owner photos and visit assignments), every job seeker, every referral partner, every
 * shop visit with no business (unregistered shops and their revisits), every interview, placement,
 * candidate shown, replacement claim and the payments, refunds and payouts of all of these, and
 * the rows that point at them by id (review flags, status history, consents, messages, calls,
 * call tasks, links, notifications, legal acceptances, ID check details, sign-up trackers…).
 * Kept: the kept businesses and their own records, every staff account, attendance, payroll,
 * expenses, settings and the audit log (it holds no personal data). Photos in storage are not
 * touched.
 *
 * Run from the Render shell of the web service (needs the built app, dist/):
 *
 *   1. Check only — finds the businesses to keep by name and shows what would go. Nothing changes:
 *      the whole delete runs inside a transaction that is then rolled back, so the counts are exact.
 *
 *        npm run clear:test-data -- --keep-names "Reddy,Stylish"
 *
 *   2. Delete — with the BZ- codes step 1 printed, and --delete:
 *
 *        npm run clear:test-data -- --keep BZ-00009,BZ-00012 --delete
 *
 * Deleting cannot be undone.
 */
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../common/prisma/prisma.module';
import { PrismaService } from '../common/prisma/prisma.service';

type Tx = Prisma.TransactionClient;
type Kept = { id: string; code: string; name: string; createdAt: Date };

class RolledBack extends Error {
  constructor(readonly counts: Record<string, number>) {
    super('check only: rolled back');
  }
}

export interface ClearArgs {
  keepCodes: string[] | null;
  keepNames: string[] | null;
  delete: boolean;
}

export function parseClearArgs(argv: string[]): ClearArgs {
  const value = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const list = (text: string | null) => (text === null ? null : text.split(',').map((x) => x.trim()).filter(Boolean));
  return { keepCodes: list(value('--keep')), keepNames: list(value('--keep-names')), delete: argv.includes('--delete') };
}

/** The businesses to keep: by BZ- code (needed to delete), or by part of the name (check only). */
export async function findKept(prisma: PrismaService, args: ClearArgs): Promise<{ kept: Kept[]; problems: string[] }> {
  const select = { id: true, code: true, name: true, createdAt: true } as const;
  const problems: string[] = [];
  const kept: Kept[] = [];
  if (args.keepCodes?.length) {
    const rows = await prisma.business.findMany({ where: { code: { in: args.keepCodes } }, select });
    for (const code of args.keepCodes) if (!rows.some((r) => r.code === code)) problems.push(`No business has the code ${code}.`);
    kept.push(...rows);
  } else if (args.keepNames?.length) {
    for (const part of args.keepNames) {
      const rows = await prisma.business.findMany({ where: { name: { contains: part, mode: 'insensitive' } }, select, orderBy: { createdAt: 'asc' } });
      if (rows.length !== 1) {
        problems.push(`"${part}" matches ${rows.length} businesses${rows.length ? `: ${rows.map((r) => `${r.code} ${r.name} (${r.createdAt.toISOString().slice(0, 10)})`).join('; ')}` : ''}. Use --keep with the exact BZ- codes.`);
      }
      kept.push(...rows);
    }
  } else {
    problems.push('Say which businesses to keep: --keep-names "Reddy,Stylish" (check only) or --keep BZ-…,BZ-… .');
  }
  return { kept, problems };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/** Deletes the test data, keeping `keepIds`. Returns how many rows went from each table. */
export async function clearTestData(tx: Tx, keepIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const note = (table: string, result: { count: number }) => {
    counts[table] = (counts[table] ?? 0) + result.count;
  };

  // ---- 1. What goes
  const businesses = ids(await tx.business.findMany({ where: { id: { notIn: keepIds } }, select: { id: true } }));
  const jobSeekers = ids(await tx.jobSeeker.findMany({ select: { id: true } }));
  const referrals = ids(await tx.referral.findMany({ select: { id: true } }));
  const vacancies = ids(await tx.vacancy.findMany({ where: { businessId: { in: businesses } }, select: { id: true } }));
  const visits = ids(await tx.businessVisit.findMany({ where: { OR: [{ businessId: null }, { businessId: { in: businesses } }] }, select: { id: true } }));
  const assignments = ids(await tx.visitAssignment.findMany({ where: { businessId: { in: businesses } }, select: { id: true } }));
  const branches = ids(await tx.businessBranch.findMany({ where: { businessId: { in: businesses } }, select: { id: true } }));
  const interviews = ids(await tx.interview.findMany({ where: { OR: [{ jobSeekerId: { in: jobSeekers } }, { businessId: { in: businesses } }] }, select: { id: true } }));
  const placements = ids(await tx.placement.findMany({ where: { OR: [{ jobSeekerId: { in: jobSeekers } }, { businessId: { in: businesses } }] }, select: { id: true } }));
  const claims = ids(await tx.replacementClaim.findMany({ where: { placementId: { in: placements } }, select: { id: true } }));
  const intros = ids(await tx.candidateIntroduction.findMany({ where: { OR: [{ jobSeekerId: { in: jobSeekers } }, { businessId: { in: businesses } }] }, select: { id: true } }));
  const people = [...businesses, ...jobSeekers, ...referrals, ...placements];
  const payments = new Set(ids(await tx.payment.findMany({
    where: { OR: [
      { businessId: { in: businesses } }, { jobSeekerId: { in: jobSeekers } }, { referralId: { in: referrals } },
      { placementId: { in: placements } }, { subjectId: { in: people } },
    ] },
    select: { id: true },
  })));
  // Refunds of those payments (pointed at by id only), until nothing new is found.
  for (let added = true; added;) {
    added = false;
    for (const r of await tx.payment.findMany({ where: { refundsPaymentId: { in: [...payments] } }, select: { id: true } })) {
      if (!payments.has(r.id)) {
        payments.add(r.id);
        added = true;
      }
    }
  }
  const paymentIds = [...payments];
  const all = [...people, ...vacancies, ...visits, ...assignments, ...branches, ...interviews, ...claims, ...intros, ...paymentIds];
  // A kept business's rows that point at a deleted job seeker, interview or placement go too.
  const keptAssignments = ids(await tx.visitAssignment.findMany({ where: { businessId: { in: keepIds }, relatedId: { in: all } }, select: { id: true } }));
  const gone = [...all, ...keptAssignments];

  // ---- 2. Rows that point at them by id only (no database link)
  note('ReviewFlag', await tx.reviewFlag.deleteMany({ where: { subjectId: { in: gone } } }));
  note('StatusHistory', await tx.statusHistory.deleteMany({ where: { subjectId: { in: gone } } }));
  note('Consent', await tx.consent.deleteMany({ where: { subjectId: { in: gone } } }));
  note('LegalAcceptance', await tx.legalAcceptance.deleteMany({ where: { subjectId: { in: gone } } }));
  note('PublicLink', await tx.publicLink.deleteMany({ where: { subjectId: { in: gone } } }));
  note('Notification', await tx.notification.deleteMany({ where: { subjectId: { in: gone } } }));
  note('CallTask', await tx.callTask.deleteMany({ where: { subjectId: { in: gone } } }));
  note('CallbackTask', await tx.callbackTask.deleteMany({ where: { jobSeekerId: { in: jobSeekers } } }));
  note('FollowUpTask', await tx.followUpTask.deleteMany({ where: { OR: [{ subjectId: { in: gone } }, { relatedId: { in: gone } }] } }));
  note('IdCheckDetail', await tx.idCheckDetail.deleteMany({ where: { subjectId: { in: gone } } }));
  note('IdCaptureNonce', await tx.idCaptureNonce.deleteMany({ where: { subjectId: { in: gone } } }));
  note('AadhaarQrAttempt', await tx.aadhaarQrAttempt.deleteMany({ where: { subjectId: { in: gone } } }));
  note('ContactBlock', await tx.contactBlock.deleteMany({ where: { subjectId: { in: gone } } }));
  note('DataRequest', await tx.dataRequest.deleteMany({ where: { subjectId: { in: gone } } }));
  note('PermanentBan', await tx.permanentBan.deleteMany({ where: { subjectId: { in: gone } } }));
  note('SignupTracker', await tx.signupTracker.deleteMany({ where: { subjectId: { in: gone } } }));
  note('StaffRequest', await tx.staffRequest.deleteMany({ where: { subjectId: { in: gone } } }));
  note('TeamLeadCheck', await tx.teamLeadCheck.deleteMany({ where: { subjectId: { in: gone } } }));
  note('TradeSuggestionSubject', await tx.tradeSuggestionSubject.deleteMany({ where: { subjectId: { in: gone } } }));
  note('MonthReviewMark', await tx.monthReviewMark.deleteMany({ where: { subjectId: { in: gone } } }));
  note('WhatsAppConversation', await tx.whatsAppConversation.deleteMany({ where: { subjectId: { in: gone } } }));
  note('PayoutAccount', await tx.payoutAccount.deleteMany({ where: { ownerId: { in: gone } } }));
  note('ReferralLead', await tx.referralLead.deleteMany({ where: { OR: [{ referralId: { in: referrals } }, { subjectId: { in: gone } }] } }));
  note('CustomerReferralLead', await tx.customerReferralLead.deleteMany({ where: { OR: [{ referralId: { in: referrals } }, { subjectId: { in: gone } }] } }));
  note('OwnerFavourite', await tx.ownerFavourite.deleteMany({ where: { OR: [{ jobSeekerId: { in: jobSeekers } }, { vacancyId: { in: vacancies } }] } }));
  note('WinBackEntry', await tx.winBackEntry.deleteMany({ where: { OR: [{ jobSeekerId: { in: jobSeekers } }, { vacancyId: { in: vacancies } }] } }));
  note('RefundRejection', await tx.refundRejection.deleteMany({ where: { OR: [{ jobSeekerId: { in: jobSeekers } }, { placementId: { in: placements } }, { paymentId: { in: paymentIds } }] } }));
  note('BypassCharge', await tx.bypassCharge.deleteMany({ where: { OR: [{ businessId: { in: businesses } }, { jobSeekerId: { in: jobSeekers } }] } }));
  note('FieldHandover', await tx.fieldHandover.deleteMany({ where: { businessId: { in: businesses } } }));
  note('CustomerVacancyDraft', await tx.customerVacancyDraft.deleteMany({ where: { OR: [{ businessId: { in: businesses } }, { vacancyId: { in: vacancies } }] } }));
  note('CustomerWorkerLeftReport', await tx.customerWorkerLeftReport.deleteMany({ where: { OR: [{ businessId: { in: businesses } }, { placementId: { in: placements } }] } }));
  note('PayoutWebhookEvent', await tx.payoutWebhookEvent.deleteMany({ where: { paymentId: { in: paymentIds } } }));
  note('VisitAssignment (kept businesses)', await tx.visitAssignment.deleteMany({ where: { id: { in: keptAssignments } } }));

  // ---- 3. Linked rows, children before parents (claims → introductions → placements → payments → interviews → calls and messages)
  note('ReplacementClaim', await tx.replacementClaim.deleteMany({ where: { id: { in: claims } } }));
  note('CandidateIntroduction', await tx.candidateIntroduction.deleteMany({ where: { id: { in: intros } } }));
  // Every share link lists job seekers, and every job seeker goes: all links go (the kept businesses' too).
  note('CandidateIntroductionLink', await tx.candidateIntroductionLink.deleteMany({ where: { id: { not: '' } } }));
  note('ReplacementCandidate', await tx.replacementCandidate.deleteMany({ where: { OR: [{ jobSeekerId: { in: jobSeekers } }, { placementId: { in: placements } }] } }));
  note('BankCredit (matched to a test payment)', await tx.bankCredit.deleteMany({ where: { matchedPaymentId: { in: paymentIds } } }));
  note('Payment', await tx.payment.deleteMany({ where: { id: { in: paymentIds } } }));
  note('Placement', await tx.placement.deleteMany({ where: { id: { in: placements } } }));
  note('Interview', await tx.interview.deleteMany({ where: { id: { in: interviews } } }));
  note('CallRecord', await tx.callRecord.deleteMany({ where: { OR: [{ subjectId: { in: gone } }, { relatedId: { in: gone } }] } }));
  note('MessageLog', await tx.messageLog.deleteMany({ where: { OR: [{ subjectId: { in: gone } }, { relatedId: { in: gone } }] } }));

  // ---- 4. The people and businesses (their own rows go with them: trades, hits, ID checks, vacancies, shifts, visits…)
  note('JobSeeker', await tx.jobSeeker.deleteMany({ where: { id: { in: jobSeekers } } }));
  note('Referral', await tx.referral.deleteMany({ where: { id: { in: referrals } } }));
  note('BusinessVisit (no business)', await tx.businessVisit.deleteMany({ where: { businessId: null } }));
  note('Business', await tx.business.deleteMany({ where: { id: { in: businesses } } }));
  // A kept business's visit that was a revisit of a deleted shop visit forgets that link.
  note('BusinessVisit revisit links cleared', await tx.businessVisit.updateMany({ where: { revisitOfVisitId: { in: visits } }, data: { revisitOfVisitId: null } }));

  counts['(vacancies of deleted businesses)'] = vacancies.length;
  counts['(visits of deleted businesses and unregistered shops)'] = visits.length;
  return counts;
}

@Module({ imports: [PrismaModule] })
class ClearModule {}

async function main(): Promise<void> {
  const args = parseClearArgs(process.argv);
  const app = await NestFactory.createApplicationContext(ClearModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  try {
    const { kept, problems } = await findKept(prisma, args);
    process.stdout.write(`Keeping ${kept.length} business(es):\n${kept.map((k) => `  ${k.code}  ${k.name}  (added ${k.createdAt.toISOString().slice(0, 10)})`).join('\n')}\n`);
    if (problems.length) {
      process.stdout.write(`\nStopped, nothing changed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
      process.exitCode = 1;
      return;
    }
    const keepIds = kept.map((k) => k.id);
    const really = args.delete && Boolean(args.keepCodes?.length);
    if (args.delete && !really) {
      process.stdout.write('\n--delete needs --keep with the exact BZ- codes (not --keep-names). Nothing changed.\n');
      process.exitCode = 1;
      return;
    }
    let counts: Record<string, number>;
    try {
      counts = await prisma.$transaction(async (tx) => {
        const done = await clearTestData(tx, keepIds);
        if (!really) throw new RolledBack(done);
        return done;
      }, { timeout: 10 * 60_000, maxWait: 30_000 });
    } catch (error: unknown) {
      if (!(error instanceof RolledBack)) throw error;
      counts = error.counts;
    }
    const lines = Object.entries(counts).filter(([, n]) => n > 0).map(([table, n]) => `  ${String(n).padStart(6)}  ${table}`);
    process.stdout.write(`\n${really ? 'DELETED' : 'Would delete (check only, nothing changed)'}:\n${lines.join('\n') || '  nothing'}\n`);
    if (!really) {
      process.stdout.write(`\nTo delete for real (cannot be undone):\n  npm run clear:test-data -- --keep ${kept.map((k) => k.code).join(',')} --delete\n`);
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Failed, nothing changed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
