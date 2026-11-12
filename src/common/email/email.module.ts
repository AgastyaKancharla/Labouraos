import { Global, Module } from '@nestjs/common';
import { EMAIL_PROVIDER, MockEmailProvider, RealEmailProvider } from './email.provider';

/**
 * The email sender, picked by EMAIL_PROVIDER_MODE like every other vendor
 * (AGENTS.md: provider switching): `mock` (the default) or `real`.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useFactory: () => {
        const raw = process.env.EMAIL_PROVIDER_MODE;
        const mode = raw && raw !== 'undefined' ? raw.trim().toLowerCase() : 'mock';
        if (mode === 'mock') return new MockEmailProvider();
        if (mode === 'real') return new RealEmailProvider();
        throw new Error(`Unsupported email provider: ${mode}`);
      },
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
