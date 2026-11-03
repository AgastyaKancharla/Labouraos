import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StaffDevice } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  BELOW_MANAGER_ROLES,
  SELF_APPROVED_DEVICE_ROLES,
} from './staff-device.constants';

export interface DeviceActor {
  id: string;
  role: string;
}

const deviceStaffSelect = {
  id: true,
  code: true,
  name: true,
  role: true,
  teamLeadId: true,
} as const;

@Injectable()
export class StaffDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findApproved(staffId: string, deviceId: string): Promise<StaffDevice | null> {
    return this.prisma.staffDevice.findFirst({
      where: { staffId, deviceId, status: 'approved' },
    });
  }

  /**
   * One row per staff member and device. A second request while pending or
   * approved returns that row. A revoked device is asked for again as pending.
   */
  async requestApproval(
    staffId: string,
    deviceId: string,
    label: string,
    platform: string,
  ): Promise<StaffDevice> {
    const trimmedDeviceId = deviceId?.trim();
    const trimmedLabel = label?.trim();
    const trimmedPlatform = platform?.trim();
    if (!trimmedDeviceId || !trimmedLabel || !trimmedPlatform) {
      throw new BadRequestException('deviceId, label and platform are required');
    }

    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) {
      throw new NotFoundException(`Staff '${staffId}' not found`);
    }

    const existing = await this.prisma.staffDevice.findUnique({
      where: { staffId_deviceId: { staffId, deviceId: trimmedDeviceId } },
    });

    if (existing && (existing.status === 'pending' || existing.status === 'approved')) {
      return existing;
    }

    if (existing && existing.status === 'revoked') {
      const reopened = await this.prisma.staffDevice.update({
        where: { id: existing.id },
        data: {
          status: 'pending',
          label: trimmedLabel,
          platform: trimmedPlatform,
          requestedAt: new Date(),
          approvedAt: null,
          approvedByStaffId: null,
          revokedAt: null,
          revokedByStaffId: null,
        },
      });
      await this.auditDevice(staff.id, reopened, 'staff_device.requested', {
        status: existing.status,
      }, {
        status: reopened.status,
        deviceId: reopened.deviceId,
      });
      return reopened;
    }

    try {
      const created = await this.prisma.staffDevice.create({
        data: {
          staffId,
          deviceId: trimmedDeviceId,
          label: trimmedLabel,
          platform: trimmedPlatform,
          status: 'pending',
          requestedAt: new Date(),
        },
      });
      await this.auditDevice(staff.id, created, 'staff_device.requested', null, {
        status: created.status,
        deviceId: created.deviceId,
      });
      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.staffDevice.findUnique({
          where: { staffId_deviceId: { staffId, deviceId: trimmedDeviceId } },
        });
        if (raced) {
          return raced;
        }
      }
      throw error;
    }
  }

  async listPending(approver: DeviceActor) {
    this.assertApproverRole(approver);
    const where = this.pendingWhere(approver);
    const devices = await this.prisma.staffDevice.findMany({
      where,
      orderBy: { requestedAt: 'asc' },
      include: { staff: { select: deviceStaffSelect } },
    });
    await this.auditService.log({
      actorId: approver.id,
      action: 'staff_device.pending_listed',
      entityType: 'staff_device',
      entityCode: 'pending',
      after: { count: devices.length },
    });
    return devices;
  }

  async approve(deviceRowId: string, approver: DeviceActor) {
    this.assertApproverRole(approver);
    const device = await this.requireDevice(deviceRowId);
    this.assertCanDecide(approver, device.staff);

    if (device.status === 'approved') {
      return device;
    }
    if (device.status !== 'pending') {
      throw new BadRequestException('Only a pending device can be approved');
    }

    const updated = await this.prisma.staffDevice.update({
      where: { id: device.id },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        approvedByStaffId: approver.id,
      },
      include: { staff: { select: deviceStaffSelect } },
    });

    await this.auditDevice(approver.id, updated, 'staff_device.approved', {
      status: device.status,
    }, {
      status: updated.status,
      deviceId: updated.deviceId,
      approvedByStaffId: approver.id,
    });
    return updated;
  }

  async revoke(deviceRowId: string, approver: DeviceActor) {
    this.assertApproverRole(approver);
    const device = await this.requireDevice(deviceRowId);
    this.assertCanDecide(approver, device.staff);

    const now = new Date();
    const { updated, sessionsEnded } = await this.prisma.$transaction(async (tx) => {
      const next =
        device.status === 'revoked'
          ? device
          : await tx.staffDevice.update({
              where: { id: device.id },
              data: {
                status: 'revoked',
                revokedAt: now,
                revokedByStaffId: approver.id,
              },
              include: { staff: { select: deviceStaffSelect } },
            });
      const ended = await tx.staffSession.updateMany({
        where: {
          staffId: device.staffId,
          deviceId: device.deviceId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      return { updated: next, sessionsEnded: ended.count };
    });

    if (device.status !== 'revoked' || sessionsEnded > 0) {
      await this.auditDevice(approver.id, updated, 'staff_device.revoked', {
        status: device.status,
      }, {
        status: 'revoked',
        deviceId: device.deviceId,
        revokedByStaffId: approver.id,
        sessionsEnded,
      });
    }
    return updated;
  }

  async listForStaff(staffId: string, actor: DeviceActor) {
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) {
      throw new NotFoundException(`Staff '${staffId}' not found`);
    }
    if (!this.canList(actor, staff)) {
      throw new ForbiddenException('You cannot view devices for this staff member');
    }
    const devices = await this.prisma.staffDevice.findMany({
      where: { staffId },
      orderBy: { requestedAt: 'desc' },
    });
    await this.auditService.log({
      actorId: actor.id,
      action: 'staff_device.listed',
      entityType: 'staff_device',
      entityCode: staff.code,
      after: { staffId, count: devices.length },
    });
    return devices;
  }

  private pendingWhere(approver: DeviceActor): Prisma.StaffDeviceWhereInput {
    const notSelf = { staffId: { not: approver.id } };
    if (approver.role === 'ceo' || approver.role === 'manager') {
      return {
        status: 'pending',
        ...notSelf,
        staff: { role: { in: [...BELOW_MANAGER_ROLES] } },
      };
    }
    return {
      status: 'pending',
      ...notSelf,
      staff: { teamLeadId: approver.id },
    };
  }

  private assertCanDecide(
    approver: DeviceActor,
    target: { id: string; role: string; teamLeadId: string | null },
  ): void {
    if (approver.id === target.id) {
      throw new ForbiddenException('Nobody can approve or revoke their own device');
    }
    if ((SELF_APPROVED_DEVICE_ROLES as readonly string[]).includes(target.role)) {
      throw new ForbiddenException(
        'CEO, Manager and Finance devices are not approved by someone else',
      );
    }
    if (approver.role === 'ceo') {
      return;
    }
    if (approver.role === 'manager') {
      if (!(BELOW_MANAGER_ROLES as readonly string[]).includes(target.role)) {
        throw new ForbiddenException(
          'A Manager can approve devices only for staff below Manager',
        );
      }
      return;
    }
    if (approver.role === 'team_lead') {
      if (target.teamLeadId !== approver.id) {
        throw new ForbiddenException(
          'A Team Lead can approve devices only for their own team',
        );
      }
      return;
    }
    throw new ForbiddenException('You cannot approve or revoke devices');
  }

  private canList(actor: DeviceActor, staff: { id: string; role: string; teamLeadId: string | null }): boolean {
    if (actor.id === staff.id) {
      return true;
    }
    if (actor.role === 'ceo' || actor.role === 'manager') {
      return true;
    }
    if (actor.role === 'team_lead' && staff.teamLeadId === actor.id) {
      return true;
    }
    return false;
  }

  private assertApproverRole(approver: DeviceActor): void {
    if (!['ceo', 'manager', 'team_lead'].includes(approver.role)) {
      throw new ForbiddenException(
        'Only a Team Lead, Manager or the CEO can approve devices',
      );
    }
  }

  private async requireDevice(id: string) {
    const device = await this.prisma.staffDevice.findUnique({
      where: { id },
      include: { staff: { select: deviceStaffSelect } },
    });
    if (!device) {
      throw new NotFoundException(`Staff device '${id}' not found`);
    }
    return device;
  }

  private async auditDevice(
    actorId: string,
    device: { id: string },
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ) {
    await this.auditService.log({
      actorId,
      action,
      entityType: 'staff_device',
      entityCode: device.id,
      before,
      after,
    });
  }
}
