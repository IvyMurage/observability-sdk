import { Injectable, Inject } from '@nestjs/common';
import { OBSERVABILITY_CONFIG } from '../core/constants';
import type { ResolvedConfig } from '../core/types';

export interface DiagnosticsReport {
  sdk_version: string;
  service: string;
  environment: string;
  uptime_seconds: number;
  tracing: { enabled: boolean; exporter: string };
  metrics: { enabled: boolean };
  instrumentations: string[];
  node_version: string;
}

@Injectable()
export class DiagnosticsService {
  constructor(@Inject(OBSERVABILITY_CONFIG) private config: ResolvedConfig) {}

  getReport(): DiagnosticsReport {
    return {
      sdk_version: '0.1.0',
      service: this.config.serviceName,
      environment: this.config.environment,
      uptime_seconds: Math.floor(process.uptime()),
      tracing: {
        enabled: this.config.tracing.enabled,
        exporter: this.config.tracing.exporter.type,
      },
      metrics: {
        enabled: this.config.metrics.enabled,
      },
      instrumentations: this.config.instrumentations.map((i) => i.name),
      node_version: process.version,
    };
  }
}
