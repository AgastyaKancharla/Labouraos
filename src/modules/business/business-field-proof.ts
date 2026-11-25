/**
 * Field onboarding needs no extra owner photos (Master Guide rev 213, 25 Nov). When a field
 * agent onboarded the business in person, the visit itself is the proof: the live photo of the
 * shop's name board with GPS, the agent's selfie in front of the board, and the owner's OTP.
 * That visit counts as the shop photo (and its GPS for the 200 m Maps check) and in place of the
 * owner's selfie; a small business onboarded this way needs no Team Lead video call.
 *
 * A visit counts only when it was made by a staff member, has both the board photo and the
 * proof selfie, and none of the faked-GPS or geofence checks flagged it.
 */
export interface FieldVisitProof {
  visitId: string;
  latitude: number;
  longitude: number;
}

type VisitReader = {
  businessVisit: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, 'asc' | 'desc'>;
      select: { id: true; latitude: true; longitude: true };
    }): Promise<{ id: string; latitude: number; longitude: number } | null>;
  };
};

export const FIELD_VISIT_PROOF_WHERE = {
  staffId: { not: null },
  boardPhotoPath: { not: null },
  selfieUrl: { not: null },
  geofenceFlag: false,
  gpsSuspect: false,
} as const;

export async function findFieldVisitProof(prisma: VisitReader, businessId: string): Promise<FieldVisitProof | null> {
  const visit = await prisma.businessVisit.findFirst({
    where: { businessId, ...FIELD_VISIT_PROOF_WHERE },
    orderBy: { visitedAt: 'desc' },
    select: { id: true, latitude: true, longitude: true },
  });
  return visit ? { visitId: visit.id, latitude: visit.latitude, longitude: visit.longitude } : null;
}
