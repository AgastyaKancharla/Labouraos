import { latestAcceptances } from './acceptance-list';

const row = (id: string, context: string, at: string, textHash = 'h1', version = '1.1') => ({ id, documentKey: 'job_seeker_terms', version, context, textHash, acceptedAt: new Date(at) });

describe('Terms accepted, each once (17 Nov)', () => {
  it('the same document, version, step and text accepted again is one line: the latest, how many times and since when', () => {
    const list = latestAcceptances([
      row('p2', 'payment_terms', '2026-11-12T06:00:00Z'),
      row('r1', 'registration', '2026-11-10T05:12:00Z'),
      row('p1', 'payment_terms', '2026-11-10T06:00:00Z'),
    ]);
    expect(list.map((a) => [a.id, a.times])).toEqual([['p2', 2], ['r1', 1]]);
    expect(list[0]!.firstAcceptedAt).toEqual(new Date('2026-11-10T06:00:00Z'));
  });

  it('a new version or a changed text is its own line (re-consent stays visible)', () => {
    const list = latestAcceptances([
      row('a', 'registration', '2026-11-01T05:00:00Z', 'old', '1.0'),
      row('b', 'reconsent', '2026-11-15T05:00:00Z', 'new', '1.1'),
      row('c', 'payment_terms', '2026-11-16T05:00:00Z', 'new2', '1.1'),
      row('d', 'payment_terms', '2026-11-16T06:00:00Z', 'new3', '1.1'),
    ]);
    expect(list.map((a) => a.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(list.every((a) => a.times === 1)).toBe(true);
  });
});
