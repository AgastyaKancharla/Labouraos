import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { IdModule } from './common/id/id.module';
import { AuthModule } from './common/auth/auth.module';
import { RbacModule } from './common/rbac/rbac.module';
import { AuditModule } from './common/audit/audit.module';

@Module({
  imports: [
    PrismaModule,
    IdModule,
    AuthModule,
    RbacModule,
    AuditModule,
    HealthModule,
  ],
})
export class AppModule {}
