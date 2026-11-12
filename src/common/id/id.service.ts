import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type EntityType =
  | 'job_seeker'
  | 'referral'
  | 'business'
  | 'vacancy'
  | 'placement'
  | 'interview'
  | 'field_agent'
  | 'call_agent'
  | 'staff'
  | 'payment'
  | 'audit_log'
  | 'invoice'
  | 'review_flag'
  | 'call'
  | 'replacement_claim'
  | 'follow_up_task'
  | 'payout_account'
  | 'expense'
  | 'data_request';

export const ENTITY_PREFIXES: Record<EntityType, string> = {
  job_seeker: 'JS',
  referral: 'RF',
  business: 'BZ',
  vacancy: 'VC',
  placement: 'PL',
  interview: 'INT',
  field_agent: 'FA',
  call_agent: 'CA',
  staff: 'ST',
  payment: 'PAY',
  audit_log: 'AUD',
  invoice: 'INV',
  review_flag: 'FL',
  call: 'CALL',
  replacement_claim: 'RCL',
  follow_up_task: 'FUT',
  payout_account: 'PA',
  expense: 'EXP',
  data_request: 'DR',
};

export function formatCode(prefix: string, seq: number): string {
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) {
    throw new TypeError(`Sequence must be a positive integer; got ${seq}`);
  }
  const cleanPrefix = prefix.endsWith('-') ? prefix.slice(0, -1) : prefix;
  return `${cleanPrefix}-${String(seq).padStart(5, '0')}`;
}

@Injectable()
export class IdService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  private getSequenceName(prefix: string): string {
    const clean = prefix.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `seq_id_${clean}`;
  }

  async onModuleInit() {
    const prefixes = Object.values(ENTITY_PREFIXES);
    for (const prefix of prefixes) {
      await this.ensureSequenceExists(prefix);
    }
    await this.syncAllSequences();
  }

  async ensureSequenceExists(prefix: string): Promise<void> {
    const seqName = this.getSequenceName(prefix);
    await this.prisma.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS "${seqName}" START WITH 1;`
    );
  }

  async syncAllSequences(): Promise<void> {
    const mapping: Record<string, string> = {
      BZ: 'Business',
      JS: 'JobSeeker',
      RF: 'Referral',
      VC: 'Vacancy',
      PL: 'Placement',
      INT: 'Interview',
      PAY: 'Payment',
      AUD: 'AuditLog',
      FL: 'ReviewFlag',
      CALL: 'CallRecord',
      RCL: 'ReplacementClaim',
      FUT: 'FollowUpTask',
      EXP: 'Expense',
      DR: 'DataRequest',
      BYP: 'BypassCharge',
      BR: 'DataBreach',
      // Staff codes are role-prefixed (see STAFF_CODE_PREFIX in staff.service)
      CEO: 'Staff',
      MGR: 'Staff',
      TL: 'Staff',
      CA: 'Staff',
      FA: 'Staff',
      FIN: 'Staff',
    };

    for (const [prefix, tableName] of Object.entries(mapping)) {
      try {
        await this.ensureSequenceExists(prefix);
        await this.syncSequenceUp(prefix, [{ table: tableName, column: 'code' }]);
      } catch {
        // Table or column might not exist during initialization
      }
    }

    // Invoice numbers are one series across placement fees and no-bypass charges.
    try {
      await this.ensureSequenceExists('INV');
      await this.syncSequenceUp('INV', [
        { table: 'Placement', column: 'invoiceCode' },
        { table: 'BypassCharge', column: 'invoiceCode' },
      ]);
    } catch {
      // Ignore if table or column does not exist yet
    }
  }

  /**
   * Moves a code sequence up to the highest number already used in the given
   * columns, and never down (B1, 12 Nov): setval(seq, GREATEST(max, current)).
   * After a restart the next code is always above every code in use.
   */
  async syncSequenceUp(prefix: string, sources: Array<{ table: string; column: string }>): Promise<void> {
    const seqName = this.getSequenceName(prefix);
    const start = prefix.length + 2;
    const pattern = `^${prefix}-[0-9]+$`;
    const maxes = sources
      .map(
        ({ table, column }) =>
          `SELECT COALESCE(MAX(SUBSTRING("${column}" FROM ${start})::bigint), 0) AS m FROM "${table}" WHERE "${column}" ~ '${pattern}'`,
      )
      .join(' UNION ALL ');
    await this.prisma.$executeRawUnsafe(`
      DO $$
      DECLARE
        max_val bigint;
        current_val bigint;
      BEGIN
        SELECT COALESCE(MAX(m), 0) INTO max_val FROM (${maxes}) AS used;
        SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END INTO current_val FROM "${seqName}";
        IF GREATEST(max_val, current_val) > 0 THEN
          PERFORM setval('"${seqName}"', GREATEST(max_val, current_val), true);
        END IF;
      END $$;
    `);
  }

  /**
   * Generates next sequential human-readable code for the given entity type or prefix.
   * e.g. generateCode('job_seeker') or generateCode('JS') -> 'JS-00001'
   */
  async generateCode(entityOrPrefix: EntityType | string): Promise<string> {
    const prefix =
      (ENTITY_PREFIXES as Record<string, string>)[entityOrPrefix] ?? entityOrPrefix;
    const seqName = this.getSequenceName(prefix);

    try {
      const result = await this.prisma.$queryRawUnsafe<
        { nextval: string | number | bigint }[]
      >(`SELECT nextval('"${seqName}"') as nextval;`);
      const seq = Number(result[0].nextval);
      return formatCode(prefix, seq);
    } catch {
      await this.ensureSequenceExists(prefix);
      const result = await this.prisma.$queryRawUnsafe<
        { nextval: string | number | bigint }[]
      >(`SELECT nextval('"${seqName}"') as nextval;`);
      const seq = Number(result[0].nextval);
      return formatCode(prefix, seq);
    }
  }
}
