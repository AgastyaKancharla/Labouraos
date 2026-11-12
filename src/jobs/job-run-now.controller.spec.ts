import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JobRunNowController } from './job-run-now.controller';
import { JobScheduleKeeper } from './job-schedule-keeper.service';
import { AuditService } from '../common/audit/audit.service';
import { ROLES_METADATA_KEY } from '../common/rbac/roles.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { RbacGuard } from '../common/rbac/rbac.guard';
import { findJob } from './job-catalog';
import { JwtPayload } from '../common/auth/jwt-payload.interface';

describe('H3: POST /jobs/:job/run-now (CEO only) really runs the job', () => {
  function build() {
    const keeper = {
      keys: jest.fn().mockReturnValue(['joiningReward', 'winBack']),
      run: jest.fn().mockResolvedValue({ job: findJob('joiningReward'), result: { queued: 4, ids: ['a', 'b'] } }),
      status: jest.fn().mockResolvedValue([{ key: 'winBack', label: 'Win-back call list', queue: 'win-back', present: false }]),
      ensureAll: jest.fn().mockResolvedValue({ registered: ['winBack'], failed: [] }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new JobRunNowController(keeper as unknown as JobScheduleKeeper, audit as unknown as AuditService);
    const req = { user: { sub: 'ceo-1', role: 'ceo' } as JwtPayload } as never;
    return { keeper, audit, controller, req };
  }

  it('is guarded by login + role guard and allows the CEO only', () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_METADATA_KEY, JobRunNowController)).toEqual(['ceo']);
    const guards = Reflect.getMetadata(GUARDS_METADATA, JobRunNowController) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RbacGuard]));
  });

  it('runs the job in this process and answers with its counts (no personal data), audited', async () => {
    const { keeper, audit, controller, req } = build();
    const res = await controller.runNow('joiningReward', req);
    expect(keeper.run).toHaveBeenCalledWith('joiningReward');
    expect(res).toMatchObject({ job: 'joiningReward', label: 'Joining rewards due', result: { queued: 4, idsCount: 2 } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'ceo-1',
      action: 'job.manual_trigger',
      entityCode: 'joining-reward',
      after: { ranNow: true, queued: 4, idsCount: 2 },
    }));
  });

  it('answers 404 for an unknown job and runs nothing', async () => {
    const { keeper, controller, req } = build();
    await expect(controller.runNow('drop-tables', req)).rejects.toBeInstanceOf(NotFoundException);
    expect(keeper.run).not.toHaveBeenCalled();
  });

  it('lists the schedules and repairs them on request', async () => {
    const { keeper, audit, controller, req } = build();
    await expect(controller.schedules()).resolves.toEqual({
      allPresent: false,
      jobs: [{ key: 'winBack', label: 'Win-back call list', queue: 'win-back', present: false }],
    });
    await expect(controller.repair(req)).resolves.toEqual({ registered: ['winBack'], failed: [] });
    expect(keeper.ensureAll).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'job.schedules_repaired' }));
  });
});
