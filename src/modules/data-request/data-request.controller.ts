import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import {
  CloseDataRequestDto,
  CreateDataRequestDto,
  DataRequestService,
  UpdateDataRequestDto,
} from './data-request.service';

type AuthedRequest = Request & { user: JwtPayload };

/** C-Privacy's register of data requests (access, correction, erasure). CEO only. */
@Controller('data-requests')
@UseGuards(JwtAuthGuard, RbacGuard)
export class DataRequestController {
  constructor(private readonly service: DataRequestService) {}

  @Get()
  @RequireRoles('ceo')
  list(@Req() req: AuthedRequest, @Query('status') status?: string) {
    return this.service.list({ id: req.user.sub, role: req.user.role }, { status });
  }

  @Post()
  @RequireRoles('ceo')
  create(@Req() req: AuthedRequest, @Body() body: CreateDataRequestDto) {
    return this.service.create({ id: req.user.sub, role: req.user.role }, body ?? {});
  }

  @Patch(':id')
  @RequireRoles('ceo')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: UpdateDataRequestDto) {
    return this.service.update({ id: req.user.sub, role: req.user.role }, id, body ?? {});
  }

  @Post(':id/close')
  @RequireRoles('ceo')
  close(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: CloseDataRequestDto) {
    return this.service.close({ id: req.user.sub, role: req.user.role }, id, body ?? {});
  }
}
