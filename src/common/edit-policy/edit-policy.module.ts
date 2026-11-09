import { Global, Module } from '@nestjs/common';
import { EditPolicyService } from './edit-policy.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [EditPolicyService],
  exports: [EditPolicyService],
})
export class EditPolicyModule {}
