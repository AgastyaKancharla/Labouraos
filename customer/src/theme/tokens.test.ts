import { accents, colors, heroGradient, swoosh, tones } from './tokens';

/** WCAG 2.1 relative luminance and contrast ratio of two #RRGGBB colours. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the Laboura palette (same values as the Command Center tokens.css)', () => {
  it('has every Command Center colour', () => {
    expect(colors.blue).toBe('#0055C0');
    expect(colors.navy).toBe('#032B73');
    expect(colors.cyanRaw).toBe('#02D0F8');
    expect(colors.goldRaw).toBe('#FCCE00');
    expect(colors.orangeRaw).toBe('#FB6800');
    expect(colors.redRaw).toBe('#FE2901');
    expect(colors.green).toBe('#1C9A6C');
    expect(colors.navy100).toBe('#E2E7F3');
    expect([colors.cyan, colors.amber, colors.crit, colors.tomato]).toEqual(['#0B6E82', '#92670A', '#B94E12', '#BB232B']);
  });

  it('the hero goes royal → navy; the swoosh keeps its six stops', () => {
    expect(heroGradient.colors).toEqual([colors.blue, colors.navy]);
    expect(swoosh.colors).toEqual(['#0055C0', '#02D0F8', '#02D0F8', '#FCCE00', '#FB6800', '#FE2901']);
  });

  /*
   * Known gap, kept as the Master Guide palette has it (same as the web):
   * the text-safe green #1C9A6C (on white and on #E1F5EC) and critical
   * orange #B94E12 on #FFE7D6 reach 3:1 (WCAG's large-text level), not
   * 4.5:1. They are used for bold words only (stat numbers, chips, banner
   * titles). The other families reach 4.5:1. Raise this floor if the
   * palette gets darker variants.
   */
  const LARGE_TEXT_ONLY = new Set(['good', 'orange']);
  it.each(Object.entries(accents))('%s: text colour is readable on white and on its light background', (name, a) => {
    const min = LARGE_TEXT_ONLY.has(name) ? 3 : 4.5;
    expect(contrast(a.fg, colors.white)).toBeGreaterThanOrEqual(min);
    expect(contrast(a.fg, a.bg)).toBeGreaterThanOrEqual(min);
  });

  it.each(Object.entries(accents))('%s: the icon on a raw tile stands out (3:1 for graphics)', (_name, a) => {
    expect(contrast(a.on, a.raw)).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(tones))('chip tone %s: bold chip text readable on its background', (name, t) => {
    expect(contrast(t.fg, t.bg)).toBeGreaterThanOrEqual(name === 'green' || name === 'crit' ? 3 : 4.5);
  });

  it('white and navSoft text on the hero gradient are readable at both ends', () => {
    for (const end of heroGradient.colors) {
      expect(contrast(colors.white, end)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.navSoft, end)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('raw bright colours are never used as text colours (too faint on white)', () => {
    for (const raw of [colors.cyanRaw, colors.goldRaw, colors.orangeRaw]) {
      expect(contrast(raw, colors.white)).toBeLessThan(4.5);
      expect(Object.values(accents).map((a) => a.fg)).not.toContain(raw);
    }
  });
});
