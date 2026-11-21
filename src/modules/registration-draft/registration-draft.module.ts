import { Module } from '@nestjs/common';
import { RegistrationDraftController } from './registration-draft.controller';
import { RegistrationDraftService } from './registration-draft.service';

/** Unfinished registrations in the call agent console (21 Nov, rev 204). */
@Module({
  controllers: [RegistrationDraftController],
  providers: [RegistrationDraftService],
  exports: [RegistrationDraftService],
})
export class RegistrationDraftModule {}
