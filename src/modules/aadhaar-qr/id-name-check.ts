/**
 * The name on an ID against the registered name — a matcher of its own for
 * ID checks (the payout matcher is too loose for this: it matches parts of
 * words and initials).
 *
 *   - Whole words only, case and punctuation ignored.
 *   - At least two different words of 3 or more letters must appear in both
 *     names. Anything less ("R K" for "Ravi Kumar", "Kumar" for "Suresh
 *     Kumar", "a" for "Anything At All") is not a pass: it goes to a Team Lead.
 *   - A miss where at least two words differ only by a letter or two
 *     ("Sureesh" / "Suresh") is marked likelySpelling, so the Team Lead sees
 *     why it was sent to them.
 */
export interface IdNameCheck {
  matches: boolean;
  /** matched: passes; too_few_words: fewer than two 3+ letter words in common; different: names differ. */
  reason: 'matched' | 'too_few_words' | 'different';
  likelySpelling: boolean;
}

const MIN_LETTERS = 3;
const MIN_WORDS = 2;

export function nameWords(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{M}]+/u)
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

export function checkIdName(registeredName: string, nameOnId: string): IdNameCheck {
  const registered = [...new Set(nameWords(registeredName).filter((w) => w.length >= MIN_LETTERS))];
  const onId = new Set(nameWords(nameOnId).filter((w) => w.length >= MIN_LETTERS));
  const common = registered.filter((w) => onId.has(w));
  if (common.length >= MIN_WORDS) return { matches: true, reason: 'matched', likelySpelling: false };
  const close = registered.filter((w) => onId.has(w) || [...onId].some((o) => editDistance(w, o) <= Math.max(1, Math.floor(Math.max(w.length, o.length) / 4))));
  const likelySpelling = close.length >= MIN_WORDS;
  return { matches: false, reason: common.length > 0 || registered.length < MIN_WORDS ? 'too_few_words' : 'different', likelySpelling };
}
