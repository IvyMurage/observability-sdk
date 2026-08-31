import {
  Module,
  DynamicModule,
  OnModuleDestroy,
  Inject,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { ObservabilityConfig, ResolvedConfig } from '../core/types';
import {
  OBSERVABILITY_CONFIG,
  OBSERVABILITY_LOGGER,
  OBSERVABILITY_TRACER,
  OBSERVABILITY_METRICS,
} from '../core/constants';
import { resolveConfig } from '../core/config';
import { ObservabilityLogger } from '../logger/logger.service';
import { NestPinoLogger } from '../logger/nest-logger';
import { ObservabilityTracer } from '../tracing/tracer.service';
import { initTracing, shutdownTracing, bindOperationalMetrics } from '../tracing/tracing.init';
import { ObservabilityMetrics } from '../metrics/metrics.service';
import { MetricsController } from '../metrics/metrics.controller';
import { CacheMetricsService } from '../metrics/cache-metrics.service';
import { ContextMiddleware } from './context.middleware';
import { LoggingInterceptor } from './logging.interceptor';
import { TracingInterceptor } from './tracing.interceptor';
import { MetricsInterceptor } from './metrics.interceptor';
import { ObservabilityExceptionFilter } from './exception.filter';

let initialized = false;

@Module({})
export class ObservabilityModule implements NestModule, OnModuleDestroy {
  constructor(@Inject(OBSERVABILITY_CONFIG) private config: ResolvedConfig) {}

  static forRoot(config: ObservabilityConfig): DynamicModule {
    const resolved = resolveConfig(config);

    if (!initialized) {
      initTracing(resolved);

      for (const plugin of resolved.instrumentations) {
        if (plugin.init) {
          try {
            plugin.init();
          } catch (err) {
            console.warn(`[observability] Failed to init plugin "${plugin.name}":`, err);
          }
        }
      }
      initialized = true;
    }

    const controllers = [];
    if (resolved.metrics.enabled) {
      controllers.push(MetricsController);
    }

    return {
      module: ObservabilityModule,
      global: true,
      controllers,
      providers: [
        { provide: OBSERVABILITY_CONFIG, useValue: resolved },
        {
          provide: OBSERVABILITY_LOGGER,
          useFactory: () => new ObservabilityLogger(resolved),
        },
        {
          provide: ObservabilityLogger,
          useFactory: (logger: ObservabilityLogger) => logger,
          inject: [OBSERVABILITY_LOGGER],
        },
        {
          provide: OBSERVABILITY_TRACER,
          useFactory: () => new ObservabilityTracer(resolved),
        },
        {
          provide: ObservabilityTracer,
          useFactory: (tracer: ObservabilityTracer) => tracer,
          inject: [OBSERVABILITY_TRACER],
        },
        {
          provide: OBSERVABILITY_METRICS,
          useFactory: () => {
            const metrics = new ObservabilityMetrics(resolved);

            // Bind Prometheus metrics to operational span processors
            // (processors were created during initTracing, now they get their metrics)
            bindOperationalMetrics(metrics);

            return metrics;
          },
        },
        {
          provide: ObservabilityMetrics,
          useFactory: (metrics: ObservabilityMetrics) => metrics,
          inject: [OBSERVABILITY_METRICS],
        },
        {
          provide: NestPinoLogger,
          useFactory: (logger: ObservabilityLogger) => new NestPinoLogger(logger),
          inject: [OBSERVABILITY_LOGGER],
        },
        CacheMetricsService,
        ContextMiddleware,
        ...(resolved.tracing.enabled
          ? [{ provide: APP_INTERCEPTOR, useClass: TracingInterceptor }]
          : []),
        {
          provide: APP_INTERCEPTOR,
          useClass: LoggingInterceptor,
        },
        ...(resolved.metrics.enabled
          ? [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }]
          : []),
        {
          provide: APP_FILTER,
          useClass: ObservabilityExceptionFilter,
        },
      ],
      exports: [
        OBSERVABILITY_CONFIG,
        OBSERVABILITY_LOGGER,
        OBSERVABILITY_TRACER,
        OBSERVABILITY_METRICS,
        ObservabilityLogger,
        ObservabilityTracer,
        ObservabilityMetrics,
        CacheMetricsService,
        NestPinoLogger,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContextMiddleware).forRoutes('*');
  }

  async onModuleDestroy(): Promise<void> {
    await shutdownTracing();

    for (const plugin of this.config.instrumentations) {
      if (plugin.shutdown) {
        try {
          await plugin.shutdown();
        } catch (err) {
          console.warn(`[observability] Failed to shutdown plugin "${plugin.name}":`, err);
        }
      }
    }

    initialized = false;
  }
}
