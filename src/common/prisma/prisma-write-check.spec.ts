import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { findPrismaWriteIssues } from '../../test-support/prisma-write-check';
import { PRISMA_WRITE_ALLOWLIST } from '../../test-support/prisma-write-allowlist';

const SRC = join(__dirname, '..', '..');

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'node_modules') walk(path);
      } else if (path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.endsWith('.d.ts')) {
        files.push(path);
      }
    }
  };
  walk(SRC);
  return files;
}

describe('Security M4: every Prisma write writes its data out in place, or is on the reviewed allow-list', () => {
  const findings = sourceFiles().flatMap((file) =>
    findPrismaWriteIssues(readFileSync(file, 'utf8'), relative(SRC, file).split('\\').join('/')),
  );

  it('finds no unlisted write whose data is not an object literal, or that spreads', () => {
    const unlisted = findings.filter((f) => !(f.key in PRISMA_WRITE_ALLOWLIST)).map((f) => `${f.file}:${f.line}  ${f.key}`);
    expect(unlisted).toEqual([]);
  });

  it('every allow-list entry still matches a site and gives a reason', () => {
    const keys = new Set(findings.map((f) => f.key));
    expect(Object.keys(PRISMA_WRITE_ALLOWLIST).filter((key) => !keys.has(key))).toEqual([]);
    for (const [key, reason] of Object.entries(PRISMA_WRITE_ALLOWLIST)) {
      expect([key, reason.trim().length >= 15]).toEqual([key, true]);
    }
  });

  it('would have caught the original AC-1 bug: the e251250 update() of all four services is flagged', () => {
    const fixtures = join(SRC, 'test-support', 'fixtures', 'e251250');
    for (const [name, model] of [['referral', 'referral'], ['business', 'business'], ['vacancy', 'vacancy'], ['placement', 'placement']] as const) {
      const file = `fixtures/e251250/${name}.service.txt`;
      const issues = findPrismaWriteIssues(readFileSync(join(fixtures, `${name}.service.txt`), 'utf8'), file);
      expect([name, issues.map((i) => i.key)]).toEqual([name, [`${file} :: update :: ${model}.update :: data-not-literal`]]);
      // Not on the reviewed list: the build would have failed.
      expect(issues.filter((i) => i.key in PRISMA_WRITE_ALLOWLIST)).toEqual([]);
    }
  });

  it('flags the shapes it is meant to, and passes data written out in place', () => {
    const check = (code: string) => findPrismaWriteIssues(`async function f(this: any, dto: any, body: any, tx: any) { ${code} }`, 'x.ts').map((i) => i.problem);
    expect(check('await this.prisma.referral.update({ where: { id: 1 }, data: dto });')).toEqual(['data-not-literal']);
    expect(check('await tx.payment.create({ data: { ...body, status: "x" } });')).toEqual(['data-spread']);
    expect(check('const data = {}; await tx.staff.updateMany({ where: {}, data });')).toEqual(['data-not-literal']);
    expect(check('await tx.vacancy.update(args);')).toEqual(['args-not-literal']);
    expect(check('await tx.trade.upsert({ where: {}, create: { name: "a" }, update: body });')).toEqual(['update-not-literal']);
    expect(check('await tx.trade.createMany({ data: [{ name: "a" }, { name: "b" }] });')).toEqual([]);
    expect(check('await tx.trade.update({ where: { id: 1 }, data: { name: dto.name, active: true } });')).toEqual([]);
    // Not a Prisma model: ignored (e.g. a hash, a public link store).
    expect(check('hash.update(dto); this.publicLinks.create({ data: dto });')).toEqual([]);
  });

  it('M4-R1: flags computed keys, relation writes from variables, indirect delegates, *AndReturn, raw unsafe SQL and a non-literal deleteMany where', () => {
    const check = (code: string) => findPrismaWriteIssues(`async function f(this: any, dto: any, body: any, tx: any, model: any, rows: any) { ${code} }`, 'x.ts').map((i) => i.problem);
    expect(check('await tx.staff.update({ where: { id: 1 }, data: { [dto.field]: dto.value } });')).toEqual(['data-computed-key']);
    expect(check('await tx.business.update({ where: { id: 1 }, data: { branches: { create: dto.branches } } });')).toEqual(['data-relation-not-literal']);
    expect(check('await tx.business.update({ where: { id: 1 }, data: { branches: { createMany: { data: rows } } } });')).toEqual(['data-relation-not-literal']);
    expect(check('await tx.business.update({ where: { id: 1 }, data: { owner: { connect: dto.owner } } });')).toEqual(['data-relation-not-literal']);
    expect(check('await tx.business.update({ where: { id: 1 }, data: { owner: { connect: { id: dto.ownerId } }, branches: { create: [{ name: "a" }] } } });')).toEqual([]);
    expect(check("await tx['payment'].create({ data: { amount: 1 } });")).toEqual(['delegate-element-access']);
    expect(check('await (tx as any)[model].update({ where: { id: 1 }, data: { x: 1 } });')).toEqual(['delegate-element-access']);
    expect(check('const d = tx.payment; await d.create({ data: { amount: 1 } });')).toEqual(['delegate-in-variable']);
    expect(check('const { payment } = tx; await payment.update({ where: { id: 1 }, data: { amount: 1 } });')).toEqual(['delegate-in-variable']);
    expect(check('await tx.payment.create.call(tx.payment, { data: { amount: 1 } });')).toEqual(['write-via-call']);
    expect(check('await tx.payment.createManyAndReturn({ data: rows });')).toEqual(['data-not-literal']);
    expect(check('await tx.payment.updateManyAndReturn({ where: {}, data: dto });')).toEqual(['data-not-literal']);
    expect(check('await tx.$executeRawUnsafe(`DELETE FROM x WHERE id = ${dto.id}`);')).toEqual(['raw-unsafe']);
    expect(check('await tx.$queryRawUnsafe(dto.sql);')).toEqual(['raw-unsafe']);
    expect(check('await tx.jobRun.deleteMany({ where: dto });')).toEqual(['where-not-literal']);
    expect(check('await tx.jobRun.deleteMany(body);')).toEqual(['args-not-literal']);
    expect(check('await tx.jobRun.deleteMany({ where: { id: dto.id } });')).toEqual([]);
    // A loaded row's relation is not a delegate unless a write is called on it.
    expect(check('const business = dto.business; return business.name;')).toEqual([]);
  });
});

