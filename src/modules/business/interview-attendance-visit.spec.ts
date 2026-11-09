import { BusinessService } from './business.service';

describe('Interview attendance visit completion', () => {
  it('stores the completed visit id on its related interview', async () => {
    const visit = { id: 'visit-id', photoLive: false, ownerOtpRequestId: null };
    const tx = {
      businessVisit: { create: jest.fn().mockResolvedValue(visit) },
      visitAssignment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      interview: { update: jest.fn().mockResolvedValue({}) },
      business: { update: jest.fn() },
    };
    const prisma = {
      business: { findUnique: jest.fn().mockResolvedValue({ id: 'business-id', city: 'Bengaluru', accountAgentId: 'field-id', leadCreatedByStaffId: null, latitude: null, longitude: null, geofenceFlag: false }) },
      staff: { findUnique: jest.fn().mockResolvedValue({ id: 'field-id', role: 'field_agent' }) },
      visitAssignment: { findUnique: jest.fn().mockResolvedValue({
        id: 'assignment-id', businessId: 'business-id', assignedStaffId: 'field-id', status: 'assigned',
        purpose: 'interview_attendance', relatedType: 'interview', relatedId: 'interview-id',
      }) },
      $transaction: jest.fn().mockImplementation((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new BusinessService(
      prisma as never, {} as never, { log: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never, {} as never, {} as never, { now: () => new Date('2026-11-06T09:00:00.000Z') } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );

    await service.recordVisit('business-id', {
      assignmentId: 'assignment-id', latitude: 12.9716, longitude: 77.5946,
    }, 'field-id');

    expect(tx.visitAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'done', visitId: 'visit-id' } }));
    expect(tx.interview.update).toHaveBeenCalledWith({
      where: { id: 'interview-id' }, data: { attendanceVisitId: 'visit-id' },
    });
  });
});
