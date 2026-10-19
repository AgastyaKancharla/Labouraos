import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RbacModule } from '../../common/rbac/rbac.module';
import { FieldAgentController } from './field-agent.controller';
import { FieldAgentService } from './field-agent.service';
import { PriorityController } from './priority.controller';
import { PriorityService } from './priority.service';

@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [FieldAgentController, PriorityController],
  providers: [FieldAgentService, PriorityService],
  exports: [FieldAgentService, PriorityService],
})
export class FieldAgentModule {}
