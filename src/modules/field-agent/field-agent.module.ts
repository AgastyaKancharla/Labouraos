import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RbacModule } from '../../common/rbac/rbac.module';
import { FieldAgentController } from './field-agent.controller';
import { FieldAgentService } from './field-agent.service';

@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [FieldAgentController],
  providers: [FieldAgentService],
  exports: [FieldAgentService],
})
export class FieldAgentModule {}
