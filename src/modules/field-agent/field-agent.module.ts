import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RbacModule } from '../../common/rbac/rbac.module';
import { FieldAgentController } from './field-agent.controller';
import { BusinessVerificationModule } from '../business/business-verification.module';

@Module({
  imports: [PrismaModule, RbacModule, BusinessVerificationModule],
  controllers: [FieldAgentController],
})
export class FieldAgentModule {}
