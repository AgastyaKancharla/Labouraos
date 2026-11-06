import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { ROLES_METADATA_KEY } from '../../common/rbac/roles.decorator';
import { MapController } from './map.controller';

describe('MapController access', () => {
  const reflector = new Reflector();
  const guard = new RbacGuard(reflector, {} as PrismaService);
  const handler = MapController.prototype.getPoints;
  const contextFor = (role: string) => ({
    getHandler: () => handler,
    getClass: () => MapController,
    switchToHttp: () => ({ getRequest: () => ({ method: 'GET', user: { role } }) }),
  }) as unknown as ExecutionContext;

  it('allows CEO, Manager, Team Lead, Call Agent, and Field Agent', async () => {
    for (const role of ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent']) {
      await expect(guard.canActivate(contextFor(role))).resolves.toBe(true);
    }
  });

  it('denies Finance from the map endpoint', async () => {
    expect(reflector.getAllAndOverride<string[]>(ROLES_METADATA_KEY, [handler, MapController])).toEqual([
      'ceo', 'manager', 'team_lead', 'call_agent', 'field_agent',
    ]);
    await expect(guard.canActivate(contextFor('finance'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
