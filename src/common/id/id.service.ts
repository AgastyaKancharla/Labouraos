import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type EntityType =
  | 'job_seeker'
  | 'referral'
  | 'business'
  | 'vacancy'
  | 'placement'
  | 'field_agent'
  | 'call_agent'
  | 'staff'
  | 'payment'
  | 'audit_log';

export const ENTITY_PREFIXES: Record<EntityType, string> = {
  job_seeker: 'JS',
  referral: 'RF',
  business: 'BZ',
  vacancy: 'VC',
  placement: 'PL',
  field_agent: 'FA',
  call_agent: 'CA',
  staff: 'ST',
  payment: 'PAY',
  audit_log: 'AUD',
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
      PAY: 'Payment',
      AUD: 'AuditLog',
    };

    for (const [prefix, tableName] of Object.entries(mapping)) {
      try {
        const seqName = this.getSequenceName(prefix);
        await this.ensureSequenceExists(prefix);
        await this.prisma.$executeRawUnsafe(`
          DO $$
          DECLARE
            max_val integer;
          BEGIN
            SELECT COALESCE(MAX(SUBSTRING(code FROM ${prefix.length + 2})::int), 0)
            INTO max_val
            FROM "${tableName}"
            WHERE code ~ '^${prefix}-[0-9]+$';

            IF max_val > 0 THEN
              PERFORM setval('"${seqName}"', max_val, true);
            END IF;
          END $$;
        `);
      } catch {
        // Table or column might not exist during initialization
      }
    }
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
