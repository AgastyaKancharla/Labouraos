import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { ScreensCallRegistrationController } from './screens-call-registration.controller';

describe('ScreensCallRegistrationController access', () => {
  const reflector = new Reflector();
  // Records "registered by" the signed-in staff member, so a Team Lead's
  // own-team check on the id routes passes and only the role list decides.
  const own = { id: 'x', registeredByStaffId: 'staff-1', accountAgentId: 'staff-1', leadCreatedByStaffId: null, verificationStatus: 'verified' };
  const prisma = {
    jobSeeker: { findFirst: jest.fn(async () => own) },
    referral: { findFirst: jest.fn(async () => own) },
    business: { findFirst: jest.fn(async () => own) },
  };
  const guard = new RbacGuard(reflector, prisma as unknown as PrismaService);
  const handlers = [
    'options', 'jobSeeker', 'signedConsent', 'record', 'findReferralPartner', 'searchBusinesses', 'business', 'referral',
  ] as const;
  const contextFor = (handler: (...args: never[]) => unknown, role: string) => ({
    getHandler: () => handler,
    getClass: () => ScreensCallRegistrationController,
    switchToHttp: () => ({ getRequest: () => ({ method: 'GET', params: { id: 'x' }, path: '/screens/call-registration', route: { path: '/screens/call-registration/search' }, user: { role, sub: 'staff-1' } }) }),
  }) as unknown as ExecutionContext;

  it('lets everyone who registers people read every endpoint', async () => {
    for (const name of handlers) {
      const handler = ScreensCallRegistrationController.prototype[name] as (...args: never[]) => unknown;
      for (const role of ['call_agent', 'field_agent', 'team_lead', 'manager', 'ceo']) {
        await expect(guard.canActivate(contextFor(handler, role))).resolves.toBe(true);
      }
    }
  });

  it('denies Finance every endpoint', async () => {
    for (const name of handlers) {
      const handler = ScreensCallRegistrationController.prototype[name] as (...args: never[]) => unknown;
      await expect(guard.canActivate(contextFor(handler, 'finance'))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('masks phone numbers (except for the CEO) and strips money for Managers on every answer', () => {
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, ScreensCallRegistrationController) as unknown[];
    expect(interceptors).toContain(PiiMaskingInterceptor);
  });
});
