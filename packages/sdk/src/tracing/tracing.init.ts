import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ObservabilityConfig, ResolvedConfig, InstrumentationPlugin } from '../core/types';
import { resolveConfig } from '../core/config';
import { createSampler } from './sampling';

let provider: NodeTracerProvider | null = null;

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

  const exporter = createExporter(config);
  const spanProcessors = exporter
    ? [
        config.environment === 'development'
          ? new SimpleSpanProcessor(exporter)
          : new BatchSpanProcessor(exporter, {
              maxExportBatchSize: 512,
              scheduledDelayMillis: 5000,
            }),
      ]
    : [];

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

export async function shutdownTracing(): Promise<void> {
  if (provider) {
    await provider.shutdown();
    provider = null;
  }
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
