import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): { status: string } {
    // Cheap liveness probe with NO external dependency checks.
    // Pointed to by Render's healthCheckPath so container boot and deploys never gate on dependency reachability.
    return { status: 'ok' };
  }

  @Get('ready')
  async getReadiness(): Promise<{
    status: string;
    postgres: string;
    redis: string;
  }> {
    // Quick readiness probe checking PostgreSQL and Redis with a 2-second timeout.
    // Pointed to by monitoring and alert systems; returns 503 naming which dependency failed.
    const result = await this.healthService.checkReadiness();
    if (!result.ready) {
      throw new HttpException(
        {
          status: 'unavailable',
          failed: result.failed,
          errors: result.errors,
          message: `Readiness check failed for: ${result.failed.join(', ')}`,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ready',
      postgres: 'ok',
      redis: 'ok',
    };
  }
}
