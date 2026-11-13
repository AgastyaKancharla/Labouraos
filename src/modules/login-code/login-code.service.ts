import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { noteRequestDevice } from '../../common/observability/request-context';
import { PricingService } from '../pricing/pricing.service';
import { getLoginCodeSecret } from './login-code.secret';
import {
  LOGIN_CODE_ROLES,
  isOddHourIst,
  loginCodeFor,
  loginCodesMatch,
} from './login-code.crypto';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { StaffPhotoService } from '../staff/staff-photo.service';

export interface LoginCodeActor {
  id: string;
  role: string;
}

@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

const staffBrief = {
  id: true,
  name: true,
  code: true,
  role: true,
  teamLeadId: true,
  reportsToId: true,
} as const;

@Injectable()
export class LoginCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly pricingService: PricingService,
    private readonly clock: Clock,
    @Optional() @Inject(ReportingScopeService)
    private readonly reportingScope?: ReportingScopeService,
    @Optional() @Inject(StaffPhotoService)
    private readonly photos?: StaffPhotoService,
  ) {
    getLoginCodeSecret();
  }

  async create(
    staffId: string,
    staffDeviceId: string,
    ip: string,
    onOfficeNetwork: boolean,
  ) {
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) {
      throw new NotFoundException(`Staff '${staffId}' not found`);
    }
    if (!(LOGIN_CODE_ROLES as readonly string[]).includes(staff.role)) {
      throw new BadRequestException(
        'Login codes are only for a Team Lead, call agent or field agent',
      );
    }
    const device = await this.prisma.staffDevice.findUnique({ where: { id: staffDeviceId } });
    if (!device || device.staffId !== staffId) {
      throw new NotFoundException(`Staff device '${staffDeviceId}' not found`);
    }
    const policy = await this.pricingService.current();
    const createdAt = this.clock.now();
    const expiresAt = new Date(createdAt.getTime() + policy.loginCodeValidMinutes * 60 * 1000);
    const row = await this.prisma.loginCodeRequest.create({
      data: {
        staffId,
        staffDeviceId,
        ipAddress: ip,
        onOfficeNetwork,
        status: 'pending',
        createdAt,
        expiresAt,
      },
    });
    await this.auditService.log({
      actorId: staffId,
      action: 'login_code.created',
      entityType: 'login_code_request',
      entityCode: row.id,
      after: { status: 'pending', staffId },
    });
    return row;
  }

  async listPending(approver: LoginCodeActor) {
    this.assertApproverRole(approver);
    await this.expireDue(approver);
    const rows = await this.prisma.loginCodeRequest.findMany({
      where: { status: 'pending', ...(await this.scopeWhere(approver)) },
      orderBy: { createdAt: 'asc' },
      include: { staff: { select: staffBrief }, staffDevice: { select: { id: true, label: true, platform: true } } },
    });
    await this.auditService.log({
      actorId: approver.id,
      action: 'login_code.pending_listed',
      entityType: 'login_code_request',
      entityCode: 'pending',
      after: { count: rows.length },
    });
    // Guide (14 Nov): each request card shows the person's photo, so the senior sees who is asking.
    if (!this.photos) return rows;
    const photos = await this.photos.photosFor(rows.map((r) => r.staff.id));
    return rows.map((r) => ({ ...r, staff: { ...r.staff, photoUrl: photos.get(r.staff.id)?.photoUrl ?? null } }));
  }

  async reveal(requestId: string, approver: LoginCodeActor) {
    this.assertApproverRole(approver);
    const request = await this.requireRequest(requestId);
    await this.assertCanHandle(approver, request.staff);
    await this.refuseIfExpired(request);
    if (request.status === 'used' || request.status === 'refused' || request.status === 'expired') {
      throw new BadRequestException(`Login code request is ${request.status}`);
    }
    const now = this.clock.now();
    const updated =
      request.revealedAt == null
        ? await this.prisma.loginCodeRequest.update({
            where: { id: request.id },
            data: {
              status: 'revealed',
              revealedAt: now,
              revealedByStaffId: approver.id,
            },
          })
        : request;
    await this.auditService.log({
      actorId: approver.id,
      action: 'login_code.revealed',
      entityType: 'login_code_request',
      entityCode: request.id,
      after: { status: 'revealed', revealedByStaffId: updated.revealedByStaffId },
    });
    return { ...updated, code: loginCodeFor(request.id) };
  }

  async verify(requestId: string, code: string) {
    const request = await this.prisma.loginCodeRequest.findUnique({
      where: { id: requestId },
      include: { staffDevice: { select: { deviceId: true } } },
    });
    if (!request) {
      throw new NotFoundException(`Login code request '${requestId}' not found`);
    }
    // Nobody is signed in yet: the device is the one the login named, so the
    // login_code.used / wrong_code rows carry the device and network like the
    // other audit rows of the request.
    noteRequestDevice({ staffId: request.staffId, deviceId: request.staffDevice?.deviceId ?? null });
    const expected = loginCodeFor(request.id);
    const matches = loginCodesMatch(code ?? '', expected);
    if (request.expiresAt.getTime() <= this.clock.now().getTime() && request.status !== 'used' && request.status !== 'refused') {
      await this.prisma.loginCodeRequest.update({
        where: { id: request.id },
        data: { status: 'expired' },
      });
      throw new UnauthorizedException('Login code has expired');
    }
    if (request.status === 'expired') {
      throw new UnauthorizedException('Login code has expired');
    }
    if (request.status === 'refused') {
      throw new UnauthorizedException('Login code was refused');
    }
    if (request.status === 'used') {
      throw new UnauthorizedException('Login code has already been used');
    }
    if (!matches) {
      const policy = await this.pricingService.current();
      const prior = await this.prisma.auditLog.count({
        where: {
          entityType: 'login_code_request',
          entityCode: request.id,
          action: 'login_code.wrong_code',
        },
      });
      await this.auditService.log({
        actorId: request.staffId,
        action: 'login_code.wrong_code',
        entityType: 'login_code_request',
        entityCode: request.id,
        after: { attempt: prior + 1 },
      });
      if (prior + 1 >= policy.failedLoginLimit) {
        await this.prisma.loginCodeRequest.update({
          where: { id: request.id },
          data: { status: 'refused', refusedReason: 'too_many_wrong_codes' },
        });
      }
      throw new UnauthorizedException('Login code is not valid');
    }
    // L9: claimed with a conditional update, so two verify calls in the same
    // instant cannot both turn one code into a session.
    const claimed = await this.prisma.loginCodeRequest.updateMany({
      where: { id: request.id, status: { notIn: ['used', 'refused', 'expired'] } },
      data: { status: 'used', usedAt: this.clock.now() },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Login code has already been used');
    }
    const used = await this.prisma.loginCodeRequest.findUniqueOrThrow({ where: { id: request.id } });
    await this.auditService.log({
      actorId: request.staffId,
      action: 'login_code.used',
      entityType: 'login_code_request',
      entityCode: request.id,
      after: { status: 'used' },
    });
    return used;
  }

  async refuse(requestId: string, approver: LoginCodeActor, reason: string) {
    this.assertApproverRole(approver);
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new BadRequestException('A reason is required to refuse a login code');
    }
    const request = await this.requireRequest(requestId);
    await this.assertCanHandle(approver, request.staff);
    if (request.status === 'used' || request.status === 'expired') {
      throw new BadRequestException(`Login code request is ${request.status}`);
    }
    if (request.status === 'refused') {
      return request;
    }
    const updated = await this.prisma.loginCodeRequest.update({
      where: { id: request.id },
      data: {
        status: 'refused',
        refusedByStaffId: approver.id,
        refusedReason: trimmed,
      },
    });
    await this.auditService.log({
      actorId: approver.id,
      action: 'login_code.refused',
      entityType: 'login_code_request',
      entityCode: request.id,
      after: { status: 'refused' },
      reason: trimmed,
    });
    return updated;
  }

  async report(approver: LoginCodeActor, from?: string, to?: string) {
    this.assertApproverRole(approver);
    const createdAt = this.range(from, to);
    const where: Prisma.LoginCodeRequestWhereInput = {
      ...(await this.reportScope(approver)),
      ...(createdAt ? { createdAt } : {}),
    };
    const rows = await this.prisma.loginCodeRequest.findMany({
      where,
      include: {
        staff: { select: { id: true, code: true } },
        revealedByStaff: { select: { id: true, code: true } },
      },
    });
    const perStaff = new Map<string, { staffId: string; staffCode: string; count: number }>();
    const perApprover = new Map<string, { staffId: string; staffCode: string; count: number }>();
    let waitTotal = 0;
    let waitCount = 0;
    let expiredCount = 0;
    let refusedCount = 0;
    let oddHourCount = 0;
    for (const row of rows) {
      const staffBucket = perStaff.get(row.staffId) ?? {
        staffId: row.staffId,
        staffCode: row.staff.code,
        count: 0,
      };
      staffBucket.count += 1;
      perStaff.set(row.staffId, staffBucket);
      if (row.revealedAt && row.revealedByStaff) {
        const approverBucket = perApprover.get(row.revealedByStaffId!) ?? {
          staffId: row.revealedByStaff.id,
          staffCode: row.revealedByStaff.code,
          count: 0,
        };
        approverBucket.count += 1;
        perApprover.set(row.revealedByStaff.id, approverBucket);
        waitTotal += row.revealedAt.getTime() - row.createdAt.getTime();
        waitCount += 1;
      }
      if (row.status === 'expired') {
        expiredCount += 1;
      }
      if (row.status === 'refused') {
        refusedCount += 1;
      }
      if (isOddHourIst(row.createdAt)) {
        oddHourCount += 1;
      }
    }
    const body = {
      requestsPerStaff: [...perStaff.values()],
      revealedPerApprover: [...perApprover.values()],
      averageWaitMs: waitCount === 0 ? null : Math.round(waitTotal / waitCount),
      expiredCount,
      refusedCount,
      oddHourCount,
    };
    await this.auditService.log({
      actorId: approver.id,
      action: 'login_code.reported',
      entityType: 'login_code_request',
      entityCode: 'report',
      after: { requests: rows.length, expiredCount, refusedCount, oddHourCount },
    });
    return body;
  }

  private async expireDue(approver: LoginCodeActor) {
    await this.prisma.loginCodeRequest.updateMany({
      where: {
        status: { in: ['pending', 'revealed'] },
        expiresAt: { lte: this.clock.now() },
        ...(await this.scopeWhere(approver)),
      },
      data: { status: 'expired' },
    });
  }

  private async refuseIfExpired(request: { id: string; status: string; expiresAt: Date }) {
    if (
      request.expiresAt.getTime() <= this.clock.now().getTime() &&
      (request.status === 'pending' || request.status === 'revealed')
    ) {
      await this.prisma.loginCodeRequest.update({
        where: { id: request.id },
        data: { status: 'expired' },
      });
      request.status = 'expired';
    }
  }

  private async scopeWhere(approver: LoginCodeActor): Promise<Prisma.LoginCodeRequestWhereInput> {
    if (approver.role === 'ceo') {
      return {
        staffId: { not: approver.id },
        staff: { role: { in: [...LOGIN_CODE_ROLES] } },
      };
    }
    if (approver.role === 'manager') {
      const under = this.reportingScope
        ? await this.reportingScope.peopleUnder(approver.id)
        : [];
      return {
        staffId: { in: under },
        staff: { role: { in: [...LOGIN_CODE_ROLES] } },
      };
    }
    return {
      staff: {
        role: { in: ['call_agent', 'field_agent'] },
        OR: [{ teamLeadId: approver.id }, { reportsToId: approver.id }],
      },
    };
  }

  private async reportScope(approver: LoginCodeActor): Promise<Prisma.LoginCodeRequestWhereInput> {
    if (approver.role === 'team_lead') {
      return {
        staff: {
          OR: [{ teamLeadId: approver.id }, { reportsToId: approver.id }],
        },
      };
    }
    if (approver.role === 'manager') {
      const under = this.reportingScope
        ? await this.reportingScope.peopleUnder(approver.id)
        : [];
      return { staffId: { in: under } };
    }
    return {};
  }

  private async assertCanHandle(
    approver: LoginCodeActor,
    target: { id: string; role: string; teamLeadId: string | null; reportsToId?: string | null },
  ) {
    if (approver.id === target.id) {
      throw new ForbiddenException('An approver cannot reveal or refuse their own login code');
    }
    if (!(LOGIN_CODE_ROLES as readonly string[]).includes(target.role)) {
      throw new ForbiddenException('This account does not use a login code');
    }
    if (approver.role === 'ceo') {
      return;
    }
    if (approver.role === 'manager') {
      const allowed = this.reportingScope
        ? await this.reportingScope.personIsUnder(approver.id, target.id)
        : false;
      if (!allowed) {
        throw new ForbiddenException(
          'A Manager can approve a login code only for someone in their reporting line',
        );
      }
      return;
    }
    if (approver.role === 'team_lead') {
      if (target.role === 'team_lead') {
        throw new ForbiddenException("A Team Lead's code is revealed by a Manager or the CEO");
      }
      const onTeam = target.teamLeadId === approver.id || target.reportsToId === approver.id;
      if (!onTeam) {
        throw new ForbiddenException('A Team Lead can reveal codes only for their own team');
      }
      return;
    }
    throw new ForbiddenException('You cannot reveal or refuse login codes');
  }

  private assertApproverRole(approver: LoginCodeActor) {
    if (!['ceo', 'manager', 'team_lead'].includes(approver.role)) {
      throw new ForbiddenException('Only a Team Lead, Manager or the CEO can handle login codes');
    }
  }

  private async requireRequest(id: string) {
    const request = await this.prisma.loginCodeRequest.findUnique({
      where: { id },
      include: { staff: { select: staffBrief } },
    });
    if (!request) {
      throw new NotFoundException(`Login code request '${id}' not found`);
    }
    return request;
  }

  private range(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    if (!from && !to) {
      return undefined;
    }
    if (!from || !to) {
      throw new BadRequestException('from and to are both required');
    }
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('from and to must be dates');
    }
    return { gte: start, lte: end };
  }
}
