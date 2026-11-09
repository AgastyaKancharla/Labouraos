import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { EditPolicyService, EditableEntityType } from './edit-policy.service';

@Controller('edit-policy')
@UseGuards(JwtAuthGuard, RbacGuard)
export class EditPolicyController {
  constructor(private readonly editPolicyService: EditPolicyService) {}

  @Get('check')
  async checkEditPermission(
    @Query('entityType') entityType: EditableEntityType,
    @Query('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    const actor = {
      id: req.user.sub,
      role: req.user.role,
      code: req.user.code,
    };
    const record = await this.editPolicyService.loadEntity(entityType, id);
    return this.editPolicyService.checkEditPermission(actor, entityType, record);
  }
}
