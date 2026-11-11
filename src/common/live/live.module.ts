import { Global, Module } from '@nestjs/common';
import { LiveController } from './live.controller';
import { LiveEventsService } from './live-events.service';

/** The live server-to-browser channel. Global so any module can publish. */
@Global()
@Module({
  controllers: [LiveController],
  providers: [LiveEventsService],
  exports: [LiveEventsService],
})
export class LiveModule {}
