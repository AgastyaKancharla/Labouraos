import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RbacGuard } from './rbac.guard';
import { PiiMaskingInterceptor } from './pii-masking.interceptor';

@Global()
@Module({
  providers: [
    RbacGuard,
    PiiMaskingInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: PiiMaskingInterceptor,
    },
  ],
  exports: [RbacGuard, PiiMaskingInterceptor],
})
export class RbacModule {}
