import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TelephonyModule } from '../telephony/telephony.module';
import { ConsentModule } from '../consent/consent.module';
import { CallController } from './call.controller';
import { CallService } from './call.service';
import { CallClock } from './call-clock';
import { RecordingCopyJob } from './recording-copy.job';
import {
  HttpRecordingDownloader,
  MemoryRecordingStorage,
  RECORDING_DOWNLOADER,
  RECORDING_STORAGE,
  SupabaseRecordingStorage,
} from './recording-storage';

@Module({
  imports: [PrismaModule, TelephonyModule, ConsentModule],
  controllers: [CallController],
  providers: [
    CallService,
    CallClock,
    RecordingCopyJob,
    {
      provide: RECORDING_STORAGE,
      useFactory: () =>
        process.env.RECORDING_STORAGE_MODE === 'supabase'
          ? new SupabaseRecordingStorage()
          : new MemoryRecordingStorage(),
    },
    {
      provide: RECORDING_DOWNLOADER,
      useClass: HttpRecordingDownloader,
    },
  ],
  exports: [CallService, RecordingCopyJob, RECORDING_STORAGE],
})
export class CallModule {}
