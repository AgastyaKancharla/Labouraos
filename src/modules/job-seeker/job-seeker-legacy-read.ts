export interface JobSeekerLegacyReadSource {
  trades?: Array<{ trade: string; isPrimary: boolean }>;
  identityVerifications?: Array<{
    status: string;
    vendorReference: string;
  }>;
}

/** Resolve legacy response fields from their replacement tables. */
export function withCurrentJobSeekerFields<T extends JobSeekerLegacyReadSource>(
  seeker: T,
): T & { tradeSkill: string | null; kycStatus: string; kycReference: string | null } {
  const tradeSkill = seeker.trades?.find((trade) => trade.isPrimary)?.trade ?? null;
  const latestVerification = seeker.identityVerifications?.[0];

  return {
    ...seeker,
    tradeSkill,
    kycStatus: latestVerification?.status ?? 'pending',
    kycReference: latestVerification?.vendorReference ?? null,
  };
}

export function primaryJobSeekerTrade(seeker: JobSeekerLegacyReadSource): string | null {
  if (seeker.trades?.length) {
    return seeker.trades.find((trade) => trade.isPrimary)?.trade ?? null;
  }
  return null;
}

export function withPrimaryJobSeekerTrade<T extends JobSeekerLegacyReadSource>(
  seeker: T,
): T & { tradeSkill: string | null } {
  return { ...seeker, tradeSkill: primaryJobSeekerTrade(seeker) };
}

export function jobSeekerHasTrade(
  seeker: JobSeekerLegacyReadSource,
  trade: string,
): boolean {
  const normalizedTrade = trade.trim().toLowerCase();
  if (seeker.trades?.length) {
    return seeker.trades.some((row) => row.trade.trim().toLowerCase() === normalizedTrade);
  }
  return false;
}
