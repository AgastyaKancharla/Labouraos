import { Module } from '@nestjs/common';
import { WebAppController } from './web-app.controller';

@Module({
  controllers: [WebAppController],
})
export class WebAppModule {}
