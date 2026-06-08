import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
  register as globalRegister,
} from 'prom-client';
import type { RegistryContentType } from 'prom-client';
import type { ResolvedConfig } from '../core/types';

export class ObservabilityMetrics {
  private registry: Registry<RegistryContentType>;
  private prefix: string;

  constructor(config: ResolvedConfig) {
    this.registry = new Registry<RegistryContentType>();
    this.registry.setContentType(Registry.OPENMETRICS_CONTENT_TYPE);
    this.prefix = config.metrics.prefix ? `${config.metrics.prefix}_` : '';

    this.registry.setDefaultLabels(config.metrics.labels);

    if (config.metrics.defaultMetrics) {
      collectDefaultMetrics({ register: this.registry, prefix: this.prefix });
    }
  }

  createCounter(name: string, help: string, labelNames: string[] = []): Counter {
    return new Counter({
      name: `${this.prefix}${name}`,
      help,
      labelNames,
      registers: [this.registry],
    });
  }

  createHistogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets?: number[],
    enableExemplars = false,
  ): Histogram {
    return new Histogram({
      name: `${this.prefix}${name}`,
      help,
      labelNames,
      buckets: buckets || [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
      enableExemplars,
    });
  }

  createGauge(name: string, help: string, labelNames: string[] = []): Gauge {
    return new Gauge({
      name: `${this.prefix}${name}`,
      help,
      labelNames,
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  getRegistry(): Registry<RegistryContentType> {
    return this.registry;
  }
}
