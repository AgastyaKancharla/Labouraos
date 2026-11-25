/**
 * A mocked `identityVerification` delegate for unit tests that confirm a ₹499 (rev 211): the payment
 * asks whether his ID has passed (guarantee-start.ts idPassedAt). passed: an ID verified before the
 * payment (he becomes active at once); false: no ID yet ("paid, waiting for ID").
 */
export function idPassedMock(passed = true, verifiedAt = new Date('2026-01-01T00:00:00.000Z')) {
  return {
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.isAdult === false) return null; // no standing under-18 stop
      return passed ? { id: 'idv-1', verifiedAt, createdAt: verifiedAt } : null;
    }),
  };
}
