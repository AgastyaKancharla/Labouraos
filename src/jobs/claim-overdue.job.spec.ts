import { ClaimOverdueJob, CLAIM_OVERDUE_QUEUE } from './claim-overdue.job';
import { PlacementService } from '../modules/placement/placement.service';

describe('ClaimOverdueJob', () => {
  let job: ClaimOverdueJob;
  let placementService: Partial<PlacementService>;

  beforeEach(() => {
    placementService = {
      checkOverdueClaims: jest.fn().mockResolvedValue(2),
    };
    job = new ClaimOverdueJob(placementService as PlacementService);
  });

  afterEach(async () => {
    await job.onModuleDestroy();
  });

  it('delegates process to placementService.checkOverdueClaims', async () => {
    const fixedNow = new Date('2026-11-10T12:00:00.000Z');
    const result = await job.process(fixedNow);

    expect(placementService.checkOverdueClaims).toHaveBeenCalledWith(fixedNow);
    expect(result).toEqual({ raised: 2 });
  });

  it('initializes bullmq queue with correct queue name', () => {
    const queue = job.getQueue();
    expect(queue.name).toBe(CLAIM_OVERDUE_QUEUE);
  });
});
