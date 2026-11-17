import { Module } from '@nestjs/common';
import { MapsLinkController } from './maps-link.controller';
import { defaultMapsDns, defaultMapsFetch, MAPS_DNS, MAPS_HTTP, MapsLinkService } from './maps-link.service';

@Module({
  controllers: [MapsLinkController],
  providers: [MapsLinkService, { provide: MAPS_HTTP, useValue: defaultMapsFetch }, { provide: MAPS_DNS, useValue: defaultMapsDns }],
  exports: [MapsLinkService],
})
export class MapsLinkModule {}
