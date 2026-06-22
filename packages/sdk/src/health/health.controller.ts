import { Controller, Get, Inject } from '@nestjs/common';
import { OBSERVABILITY_CONFIG } from '../core/constants';
import type { ResolvedConfig } from '../core/types';

@Controller()
export class HealthController {
  constructor(@Inject(OBSERVABILITY_CONFIG) private config: ResolvedConfig) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: this.config.serviceName,
      environment: this.config.environment,
      version: this.config.version,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('health/ready')
  ready() {
    return { status: 'ok' };
  }

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }
}
