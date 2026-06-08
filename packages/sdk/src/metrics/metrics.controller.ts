import { Controller, Get, Req, Res, Inject } from '@nestjs/common';
import { Registry } from 'prom-client';
import { OBSERVABILITY_METRICS } from '../core/constants';
import type { ObservabilityMetrics } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(@Inject(OBSERVABILITY_METRICS) private metrics: ObservabilityMetrics) {}

  @Get('metrics')
  async getMetrics(@Req() req: any, @Res() res: any): Promise<void> {
    const accept: string = req.headers['accept'] || '';
    const registry = this.metrics.getRegistry() as Registry<any>;

    if (accept.includes('application/openmetrics-text')) {
      registry.setContentType(Registry.OPENMETRICS_CONTENT_TYPE);
    } else {
      registry.setContentType(Registry.PROMETHEUS_CONTENT_TYPE);
    }

    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  }
}
