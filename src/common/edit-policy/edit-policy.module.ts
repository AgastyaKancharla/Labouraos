import { Global, Module } from '@nestjs/common';
import { EditPolicyService } from './edit-policy.service';
import { EditPolicyController } from './edit-policy.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [EditPolicyController],
  providers: [EditPolicyService],
  exports: [EditPolicyService],
})
export class EditPolicyModule {}
