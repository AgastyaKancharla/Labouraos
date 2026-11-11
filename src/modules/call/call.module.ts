import { Module } from '@nestjs/common';
import { LiveModule } from '../../common/live/live.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TelephonyModule } from '../telephony/telephony.module';
import { ConsentModule } from '../consent/consent.module';
import { CallController } from './call.controller';
import { CallService } from './call.service';
import { CallClock } from './call-clock';
import { AttendanceModule } from '../attendance/attendance.module';
import { RecordingCopyJob } from './recording-copy.job';
import { CallFollowThroughService } from './call-follow-through.service';
import { MessageModule } from '../message/message.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import {
  HttpRecordingDownloader,
  RECORDING_DOWNLOADER,
  RECORDING_STORAGE,
  SupabaseRecordingStorage,
  sharedMemoryRecordingStorage,
} from './recording-storage';

@Module({
  imports: [PrismaModule, TelephonyModule, ConsentModule, AttendanceModule, MessageModule, ReviewFlagModule, LiveModule],
  controllers: [CallController],
  providers: [
    CallService,
    CallClock,
    CallFollowThroughService,
    RecordingCopyJob,
    {
      provide: RECORDING_STORAGE,
      useFactory: () =>
        process.env.RECORDING_STORAGE_MODE === 'supabase'
          ? new SupabaseRecordingStorage()
          : sharedMemoryRecordingStorage,
    },
    {
      provide: RECORDING_DOWNLOADER,
      useClass: HttpRecordingDownloader,
    },
  ],
  exports: [CallService, RecordingCopyJob, RECORDING_STORAGE],
})
export class CallModule {}
