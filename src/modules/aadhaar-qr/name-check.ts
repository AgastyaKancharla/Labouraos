import { matchReceiverName } from '../payout-account/name-matcher';

/**
 * The name on the Aadhaar QR against the registered name, with the same rule
 * as every other name check in Laboura (payout-account/name-matcher.ts: case
 * and spacing ignored, his first and last name must both appear).
 *
 * A mismatch that looks like a spelling difference ("Sureesh" / "Suresh",
 * "Mohd" / "Mohammed") is marked so the Team Lead sees why it was sent to
 * them (guide: a name mismatch that looks like a spelling difference goes to
 * a Team Lead). Every mismatch also offers another ID.
 */
export interface NameCheck {
  matches: boolean;
  likelySpelling: boolean;
}

function clean(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
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

function closeWord(word: string, candidates: string[]): boolean {
  return candidates.some((c) => {
    if (c === word || c.startsWith(word) || word.startsWith(c)) return true;
    const allowed = Math.max(1, Math.floor(Math.max(word.length, c.length) / 4));
    return editDistance(word, c) <= allowed;
  });
}

export function checkName(registeredName: string, nameOnId: string): NameCheck {
  if (matchReceiverName(registeredName, nameOnId)) return { matches: true, likelySpelling: false };
  const registered = clean(registeredName);
  const onId = clean(nameOnId);
  if (!registered.length || !onId.length) return { matches: false, likelySpelling: false };
  const first = registered[0]!;
  const last = registered[registered.length - 1]!;
  return { matches: false, likelySpelling: closeWord(first, onId) && closeWord(last, onId) };
}
