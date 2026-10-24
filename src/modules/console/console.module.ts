import { Module } from '@nestjs/common';
import { ConsoleController } from './console.controller';

@Module({
  controllers: [ConsoleController],
})
export class ConsoleModule {}
