import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { BusinessService } from './business.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

@Controller('businesses')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Post()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  async create(
    @Body() body: CreateBusinessDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.create(body, req.user.sub);
  }

  @Get()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance')
  @RequirePermission('business', 'read')
  async findAll(
    @Req() req: Request & { user: JwtPayload },
    @Query('area') filterArea?: string,
  ) {
    return this.businessService.findAll(req.user.sub, filterArea);
  }

  @Get(':id')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance')
  @RequirePermission('business', 'read')
  async findById(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.findById(id, req.user.sub);
  }
}
