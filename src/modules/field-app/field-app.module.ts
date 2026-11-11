import { Module } from '@nestjs/common';
import { FieldAppController } from './field-app.controller';

@Module({
  controllers: [FieldAppController],
})
export class FieldAppModule {}
