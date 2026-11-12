import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { MonthLockService } from './month-lock.service';

/** The month-end lock, shared by Finance and the payment routes (Phase 22 Part B). */
@Module({
  imports: [PrismaModule],
  providers: [MonthLockService],
  exports: [MonthLockService],
})
export class MonthLockModule {}
