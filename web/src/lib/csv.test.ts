import { describe, expect, it } from 'vitest';
import { canExportLists, escapeCell, toCsv } from './csv';

describe('list downloads', () => {
  it('only lets the CEO, Managers and Finance export lists', () => {
    expect(canExportLists('ceo')).toBe(true);
    expect(canExportLists('manager')).toBe(true);
    expect(canExportLists('finance')).toBe(true);
    expect(canExportLists('team_lead')).toBe(false);
    expect(canExportLists('call_agent')).toBe(false);
    expect(canExportLists('field_agent')).toBe(false);
    expect(canExportLists(undefined)).toBe(false);
  });

  it('escapes quotes, commas and new lines', () => {
    const csv = toCsv([{ name: 'Sri "Sai", Hotel', note: 'a\nb' }], [
      { header: 'Name', value: (r) => r.name },
      { header: 'Note', value: (r) => r.note },
    ]);
    expect(csv).toBe('Name,Note\r\n"Sri ""Sai"", Hotel","a\nb"');
  });

  it('neutralises spreadsheet formulas', () => {
    const csv = toCsv([{ v: '=HYPERLINK("x")' }, { v: '-5' }, { v: null }], [{ header: 'V', value: (r) => r.v }]);
    expect(csv.split('\r\n')).toEqual(['V', `"'=HYPERLINK(""x"")"`, "'-5", '']);
  });

  it('L1: neutralises a formula hidden behind spaces, zero-width characters, a BOM or full-width signs', () => {
    for (const hidden of [' =1+1', '\u200b=1+1', '\ufeff=1+1', '\uff1d1+1', '\uff0bcmd', '\uff20SUM(A1)', '\u00a0-2+3', '\t=1']) {
      const cell = escapeCell(hidden);
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(escapeCell('A+ Tailors')).toBe('A+ Tailors');
    expect(escapeCell('Ravi')).toBe('Ravi');
  });
});
