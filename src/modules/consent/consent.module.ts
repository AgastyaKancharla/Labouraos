import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { MessageModule } from '../message/message.module';
import { OtpModule } from '../../common/otp/otp.module';
import { ConsentService } from './consent.service';
import { ConsentClock } from './consent-clock';
import { ConsentLinkService } from './consent-link.service';
import { ConsentController } from './consent.controller';

@Module({
  imports: [PrismaModule, MessageModule, OtpModule],
  controllers: [ConsentController],
  providers: [ConsentService, ConsentClock, ConsentLinkService],
  exports: [ConsentService, ConsentClock, ConsentLinkService],
})
export class ConsentModule {}
