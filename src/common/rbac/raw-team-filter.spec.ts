import * as fs from 'fs';
import * as path from 'path';

/**
 * Fable re-review M-4: every Team Lead "own team" check goes through OwnTeam
 * (own-team.ts), which counts both `teamLeadId` links and the reporting line.
 * A raw `teamLeadId:` filter or a `teamLeadId === actor` comparison misses
 * agents linked only by the reporting line, so a new one fails this test
 * unless it is listed below with the reason it is not a team scope.
 */
const SRC = path.join(__dirname, '..', '..');

const ALLOWED: Record<string, string> = {
  // Team plans are their own table, keyed by the Team Lead; not a staff scope.
  'modules/company-plan/company-plan.service.ts: return this.prisma.teamPlan.findMany({ where: { year, month, ...(leadIds ? { teamLeadId: { in: leadIds } } : {}) } });':
    'team plan rows (TeamPlan.teamLeadId), Managers and the CEO',
  'modules/company-plan/company-plan.service.ts: const existing = await this.prisma.teamPlan.findUnique({ where: { teamLeadId_year_month: { teamLeadId: row.teamLeadId, year, month } } });':
    'team plan rows (TeamPlan.teamLeadId), a write by the CEO',
  'modules/company-plan/company-plan.service.ts: where: { teamLeadId_year_month: { teamLeadId: row.teamLeadId, year, month } },':
    'team plan rows (TeamPlan.teamLeadId), a write by the CEO',
  // Fallbacks used only when ReportingScopeService is not provided; they read
  // the whole reporting line (Team Lead or Manager), never a Team Lead scope alone.
  'modules/review-flag/review-flag.service.ts: const rows = await this.prisma.staff.findMany({ where: { OR: [{ teamLeadId: staffId }, { reportsToId: staffId }] }, select: { id: true } });':
    'reporting-line fallback without ReportingScopeService (both links)',
  'modules/follow-up/follow-up.service.ts: const team = await this.prisma.staff.findMany({ where: { OR: [{ teamLeadId: staffId }, { reportsToId: staffId }] }, select: { id: true } });':
    'reporting-line fallback without ReportingScopeService (both links)',
  // A refusal, not a scope: a Team Lead may not ask for another Team Lead's list.
  'modules/staff/staff.service.ts: if (query.teamLeadId && query.teamLeadId !== actor.sub) {':
    'refuses ?teamLeadId= naming another Team Lead; the list itself uses OwnTeam',
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test-support' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Raw team filters and comparisons: `where … teamLeadId: x` or `x.teamLeadId === actor…`. */
function rawTeamChecks(file: string): string[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits: string[] = [];
  lines.forEach((line, at) => {
    const match = /\bteamLeadId\s*:(?!\s*(true|string|null)\b)(?=\s*\S)/.exec(line);
    // The nearest clause before the value: on the line itself, else up to 3 lines above.
    const clause = (text: string) => {
      const all = [...text.matchAll(/\b(where|data|select|create|include|update|OR|AND)\s*:/g)];
      return all.length ? all[all.length - 1][1] : undefined;
    };
    let nearest = match ? clause(line.slice(0, match.index)) : undefined;
    for (let back = at - 1; match && !nearest && back >= Math.max(0, at - 3); back -= 1) nearest = clause(lines[back]);
    const filter = Boolean(match) && ['where', 'OR', 'AND'].includes(nearest ?? '');
    const comparison =
      /\.teamLeadId\s*(===|!==|==|!=)\s*(actor|user|req|me)\b/.test(line) ||
      /\b(actor|user)\.(sub|id)\s*(===|!==|==|!=)\s*[\w?.]*\.teamLeadId\b/.test(line);
    if (filter || comparison) hits.push(line.trim());
  });
  return hits;
}

describe('No raw teamLeadId team scopes outside OwnTeam (M-4)', () => {
  const found = sourceFiles(SRC)
    .filter((file) => !file.endsWith(path.join('common', 'rbac', 'own-team.ts')))
    .flatMap((file) => rawTeamChecks(file).map((line) => `${path.relative(SRC, file).split(path.sep).join('/')}: ${line}`));

  it('every raw teamLeadId filter or comparison is on the allow-list with a reason', () => {
    expect(found.filter((hit) => !ALLOWED[hit])).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    expect(Object.keys(ALLOWED).filter((entry) => !found.includes(entry))).toEqual([]);
  });

  it('catches a raw filter and a raw comparison', () => {
    const probe = path.join(__dirname, '__probe__.tmp');
    expect(rawTeamChecks.length).toBe(1);
    const sample = [
      "const team = await this.prisma.staff.findMany({ where: { teamLeadId: actor.sub } });",
      'where: {',
      '  role: "call_agent",',
      '  teamLeadId: lead,',
      '}',
      'if (owner.teamLeadId === actor.id) return true;',
      'select: { teamLeadId: true },',
      'data: {',
      '  teamLeadId: newLead,',
    ].join('\n');
    fs.writeFileSync(probe, sample);
    try {
      expect(rawTeamChecks(probe)).toEqual([
        sample.split('\n')[0],
        'teamLeadId: lead,',
        'if (owner.teamLeadId === actor.id) return true;',
      ]);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});
