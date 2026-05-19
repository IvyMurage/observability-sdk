import { Controller, Get, Res, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { OBSERVABILITY_METRICS } from '../core/constants';
import type { ObservabilityMetrics } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(@Inject(OBSERVABILITY_METRICS) private metrics: ObservabilityMetrics) {}

  @Get('metrics')
  async getMetrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metrics.getContentType());
    res.end(await this.metrics.getMetrics());
  }
}
