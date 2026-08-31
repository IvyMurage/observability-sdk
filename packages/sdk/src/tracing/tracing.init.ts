import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import type { SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ObservabilityConfig, ResolvedConfig, InstrumentationPlugin } from '../core/types';
import { resolveConfig } from '../core/config';
import { createSampler } from './sampling';
import { OutgoingHttpMetricsProcessor } from '../metrics/outgoing-http-metrics.processor';
import { DbMetricsProcessor } from '../metrics/db-metrics.processor';

let provider: NodeTracerProvider | null = null;

// Operational metrics processors — created during init, bound to metrics later
let outgoingHttpProcessor: OutgoingHttpMetricsProcessor | null = null;
let dbProcessor: DbMetricsProcessor | null = null;

export function setupTracing(config: ObservabilityConfig): void {
  const resolved = resolveConfig(config);
  initTracing(resolved);
}

export function initTracing(config: ResolvedConfig): NodeTracerProvider | null {
  if (!config.tracing.enabled) return null;
  if (provider) return provider;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.version,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
  });

  const spanProcessors: SpanProcessor[] = [];
  const exporter = createExporter(config);
  if (exporter) {
    const processor = config.environment === 'development'
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter, {
          maxExportBatchSize: 512,
          scheduledDelayMillis: 5000,
        });
    spanProcessors.push(processor);
  }

  // Create operational metrics processors (metrics bound later via bindOperationalMetrics)
  if (config.metrics.enabled && config.metrics.httpClientMetrics) {
    outgoingHttpProcessor = new OutgoingHttpMetricsProcessor();
    spanProcessors.push(outgoingHttpProcessor);
  }

  if (config.metrics.enabled && config.metrics.dbQueryMetrics) {
    dbProcessor = new DbMetricsProcessor();
    spanProcessors.push(dbProcessor);
  }

  provider = new NodeTracerProvider({
    resource,
    sampler: createSampler(config.tracing.sampling),
    spanProcessors,
  });

  provider.register();

  const otelInstrumentations = collectOtelInstrumentations(config.instrumentations);
  if (otelInstrumentations.length > 0) {
    registerInstrumentations({
      tracerProvider: provider,
      instrumentations: otelInstrumentations,
    });
  }

  return provider;
}

/**
 * Bind Prometheus metrics to operational span processors.
 * Called by ObservabilityModule after ObservabilityMetrics is created.
 */
export function bindOperationalMetrics(metrics: import('../metrics/metrics.service').ObservabilityMetrics): void {
  if (outgoingHttpProcessor) {
    outgoingHttpProcessor.setMetrics(metrics);
  }
  if (dbProcessor) {
    dbProcessor.setMetrics(metrics);
  }
}

export async function shutdownTracing(): Promise<void> {
  if (provider) {
    await provider.shutdown();
    provider = null;
  }
  outgoingHttpProcessor = null;
  dbProcessor = null;
}

function createExporter(config: ResolvedConfig): SpanExporter | null {
  switch (config.tracing.exporter.type) {
    case 'otlp-http': {
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
      return new OTLPTraceExporter({
        url: `${config.tracing.exporter.endpoint}/v1/traces`,
        headers: config.tracing.exporter.headers,
      });
    }
    case 'otlp-grpc': {
      try {
        const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
        return new OTLPTraceExporter({
          url: config.tracing.exporter.endpoint,
          headers: config.tracing.exporter.headers,
        });
      } catch {
        console.warn('[observability] Install @opentelemetry/exporter-trace-otlp-grpc for gRPC export');
        return null;
      }
    }
    case 'console':
      return new ConsoleSpanExporter();
    case 'none':
      return null;
    default:
      return null;
  }
}

function collectOtelInstrumentations(plugins: InstrumentationPlugin[]): Instrumentation[] {
  const result: Instrumentation[] = [];

  for (const plugin of plugins) {
    if (!plugin.otelInstrumentation) continue;

    try {
      const inst = plugin.otelInstrumentation();
      if (!inst) continue;
      if (Array.isArray(inst)) {
        result.push(...inst);
      } else {
        result.push(inst);
      }
    } catch (err) {
      console.warn(`[observability] Failed to load instrumentation "${plugin.name}":`, err);
    }
  }

  return result;
}
