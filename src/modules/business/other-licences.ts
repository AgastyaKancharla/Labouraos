import { BadRequestException } from '@nestjs/common';

/**
 * 26 Nov (owner): licences a business may have besides GST, FSSAI, trade licence, Shop and
 * Establishment, Udyam and PAN (which keep their own columns). The field agent's form suggests the
 * ones that fit the business type and offers the rest under "+ Add another document"; all are
 * optional. A valid one counts as proof 2 for the automatic check (owner, 26 Nov), like FSSAI.
 *
 *  - drug_licence: retail / wholesale drug licence (Form 20, 21, 20B, 21B) from the Karnataka
 *    Drugs Control Department — pharmacies, hospital pharmacies.
 *  - kpme: Karnataka Private Medical Establishments registration — clinics, hospitals, dental
 *    clinics, labs, nursing homes.
 *  - excise: excise licence (CL-2 liquor shop, CL-7 hotel, CL-9 bar and restaurant).
 *  - psara: Private Security Agencies (Regulation) Act licence — security agencies.
 *  - contract_labour: contractor licence under the Contract Labour Act — manpower, housekeeping,
 *    security and construction contractors.
 *  - factory_licence: licence under the Factories Act — factories, packaging units.
 *  - peso: PESO licence (Form XIV) — petrol pumps.
 */
export const OTHER_LICENCE_KINDS = ['drug_licence', 'kpme', 'excise', 'psara', 'contract_labour', 'factory_licence', 'peso'] as const;
export type OtherLicenceKind = (typeof OTHER_LICENCE_KINDS)[number];

export const OTHER_LICENCE_LABELS: Record<OtherLicenceKind, string> = {
  drug_licence: 'Drug licence',
  kpme: 'KPME registration',
  excise: 'Excise licence',
  psara: 'PSARA licence',
  contract_labour: 'Contract labour licence',
  factory_licence: 'Factory licence',
  peso: 'PESO licence',
};

export interface OtherLicence {
  kind: OtherLicenceKind;
  number: string;
}

/** Licence numbers differ by authority: 4 to 40 letters, digits, "/", "-", "." or spaces, with at least 2 digits. */
export function isValidOtherLicenceNumber(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().toUpperCase();
  return /^[A-Z0-9/.\- ]{4,40}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 2;
}

/** The licences sent with a registration: each kind at most once, each number in the right shape. */
export function parseOtherLicences(value: unknown): OtherLicence[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > OTHER_LICENCE_KINDS.length) {
    throw new BadRequestException('otherLicences must be a list of { kind, number }');
  }
  const seen = new Set<string>();
  const out: OtherLicence[] = [];
  for (const row of value) {
    const kind = (row as { kind?: unknown } | null)?.kind;
    const number = (row as { number?: unknown } | null)?.number;
    if (typeof kind !== 'string' || !(OTHER_LICENCE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`otherLicences: kind must be one of ${OTHER_LICENCE_KINDS.join(', ')}`);
    }
    if (typeof number !== 'string') throw new BadRequestException(`otherLicences: ${kind} needs its number`);
    const trimmed = number.trim().replace(/\s+/g, ' ');
    if (!trimmed) continue;
    if (!isValidOtherLicenceNumber(trimmed)) {
      throw new BadRequestException(`${OTHER_LICENCE_LABELS[kind as OtherLicenceKind]}: 4 to 40 letters and digits`);
    }
    if (seen.has(kind)) throw new BadRequestException(`otherLicences: ${kind} is given twice`);
    seen.add(kind);
    out.push({ kind: kind as OtherLicenceKind, number: trimmed.toUpperCase() });
  }
  return out;
}

/** Reads the stored column (tolerant: anything that is not a known kind with a number is skipped). */
export function readOtherLicences(stored: unknown): OtherLicence[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((row) => {
    const kind = (row as { kind?: unknown } | null)?.kind;
    const number = (row as { number?: unknown } | null)?.number;
    return typeof kind === 'string' && (OTHER_LICENCE_KINDS as readonly string[]).includes(kind) && typeof number === 'string' && number.trim()
      ? [{ kind: kind as OtherLicenceKind, number: number.trim() }]
      : [];
  });
}
