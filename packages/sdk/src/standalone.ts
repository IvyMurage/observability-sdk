import type { ObservabilityConfig, ResolvedConfig } from './core/types';
import { resolveConfig } from './core/config';
import { ObservabilityLogger } from './logger/logger.service';
import { ObservabilityMetrics } from './metrics/metrics.service';
import { ObservabilityTracer } from './tracing/tracer.service';
import { initTracing, shutdownTracing } from './tracing/tracing.init';
import { setupProcessErrorHandlers } from './bootstrap/process-error-handler';
import { runWithContext, createRequestContext } from './core/context';
import type { IncomingMessage, ServerResponse } from 'http';

export interface Observability {
  logger: ObservabilityLogger;
  metrics: ObservabilityMetrics;
  tracer: ObservabilityTracer;
  config: ResolvedConfig;
  middleware(): (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  metricsHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  healthHandler: (req: IncomingMessage, res: ServerResponse) => void;
  shutdown(): Promise<void>;
}

export function createObservability(config: ObservabilityConfig): Observability {
  const resolved = resolveConfig(config);

  setupProcessErrorHandlers({ serviceName: resolved.serviceName });
  initTracing(resolved);

  for (const plugin of resolved.instrumentations) {
    if (plugin.init) {
      try { plugin.init(); } catch (err) {
        console.warn(`[observability] Failed to init plugin "${plugin.name}":`, err);
      }
    }
  }

  const logger = new ObservabilityLogger(resolved);
  const metrics = new ObservabilityMetrics(resolved);
  const tracer = new ObservabilityTracer(resolved);

  function middleware() {
    return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const ctx = createRequestContext(resolved.serviceName, resolved.environment, resolved.version);
      const clientHeader = req.headers['x-client-app'];
      if (typeof clientHeader === 'string' && resolved.clientOrigins?.[clientHeader]) {
        ctx.clientApp = resolved.clientOrigins[clientHeader];
      }

      runWithContext(ctx, () => {
        const start = Date.now();
        logger.info('request started', { method: req.method, url: req.url });

        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.info('request completed', {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration_ms: duration,
          });
        });

        next();
      });
    };
  }

  async function metricsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const registry = metrics.getRegistry();
    const accept = req.headers['accept'] || '';
    const { Registry } = await import('prom-client');
    if (accept.includes('application/openmetrics-text')) {
      registry.setContentType(Registry.OPENMETRICS_CONTENT_TYPE);
    } else {
      registry.setContentType(Registry.PROMETHEUS_CONTENT_TYPE);
    }
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  }

  function healthHandler(_req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({
      status: 'ok',
      service: resolved.serviceName,
      uptime: process.uptime(),
    }));
  }

  async function shutdown(): Promise<void> {
    await shutdownTracing();
    for (const plugin of resolved.instrumentations) {
      if (plugin.shutdown) {
        try { await plugin.shutdown(); } catch {}
      }
    }
  }

  return { logger, metrics, tracer, config: resolved, middleware, metricsHandler, healthHandler, shutdown };
}
