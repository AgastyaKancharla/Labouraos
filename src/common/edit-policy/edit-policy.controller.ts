import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequireRoles } from '../rbac/roles.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { RBAC_MATRIX, Resource, Role } from '../rbac/rbac.types';
import { EditPolicyService, EditableEntityType } from './edit-policy.service';

/** The record types this check answers for, and the resource each one is. */
const ENTITY_RESOURCE: Record<EditableEntityType, Resource | null> = {
  job_seeker: 'job_seeker',
  business: 'business',
  vacancy: 'vacancy',
  placement: 'placement',
  referral: 'referral',
  // Call notes are edited by whoever may update calls (see call.controller).
  call_record: null,
};

/** Roles that edit records at all. Finance never edits (Master Guide role table). */
const EDITING_ROLES: Role[] = ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent'];

@Controller('edit-policy')
@UseGuards(JwtAuthGuard, RbacGuard)
export class EditPolicyController {
  constructor(private readonly editPolicyService: EditPolicyService) {}

  /**
   * Tells a screen whether the logged-in person may edit one record. Only
   * roles that edit records may ask, and only about record types their role
   * may write.
   */
  @Get('check')
  @RequireRoles(...EDITING_ROLES)
  async checkEditPermission(
    @Query('entityType') entityType: EditableEntityType,
    @Query('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!Object.prototype.hasOwnProperty.call(ENTITY_RESOURCE, entityType ?? '')) {
      throw new BadRequestException(
        `entityType must be one of: ${Object.keys(ENTITY_RESOURCE).join(', ')}`,
      );
    }
    if (typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('id is required');
    }
    const resource = ENTITY_RESOURCE[entityType];
    if (resource) {
      const rule = RBAC_MATRIX[req.user.role as Role]?.[resource]?.write;
      if (!rule?.allowed) {
        throw new ForbiddenException(
          `Role '${req.user.role}' is not permitted to edit '${entityType}' records`,
        );
      }
    }
    const actor = {
      id: req.user.sub,
      role: req.user.role,
      code: req.user.code,
    };
    const record = await this.editPolicyService.loadEntity(entityType, id);
    return this.editPolicyService.checkEditPermission(actor, entityType, record);
  }
}
