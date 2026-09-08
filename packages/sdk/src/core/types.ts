import type { Instrumentation } from '@opentelemetry/instrumentation';

export interface ObservabilityConfig {
  serviceName: string;
  environment?: string;
  version?: string;

  logger?: LoggerConfig;
  tracing?: TracingConfig;
  metrics?: MetricsConfig;
  health?: HealthConfig;

  instrumentations?: InstrumentationPlugin[];

  clientOrigins?: Record<string, string>;

  redaction?: RedactionConfig;
}

export interface LoggerConfig {
  level?: LogLevel;
  prettyPrint?: boolean;
  /** Send logs to OTEL Collector via pino-opentelemetry-transport. Default: true when OTEL_EXPORTER_OTLP_ENDPOINT is set. */
  otlpExport?: boolean;
  redaction?: RedactionConfig;
  autoRequestLogging?: boolean;
  autoErrorLogging?: boolean;
  logRequestBody?: boolean;
  logResponseBody?: boolean;
  excludeRoutes?: string[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface TracingConfig {
  enabled?: boolean;
  exporter?: TracingExporterConfig;
  sampling?: SamplingConfig;
}

export interface TracingExporterConfig {
  type?: 'otlp-http' | 'otlp-grpc' | 'console' | 'none';
  endpoint?: string;
  headers?: Record<string, string>;
}

export interface SamplingConfig {
  type?: 'always' | 'never' | 'probabilistic' | 'parent-based';
  ratio?: number;
}

export interface MetricsConfig {
  enabled?: boolean;
  prefix?: string;
  defaultMetrics?: boolean;
  endpoint?: string;
  labels?: Record<string, string>;
}

export interface HealthConfig {
  enabled?: boolean;
  endpoint?: string;
}

export interface RedactionConfig {
  paths?: string[];
  censor?: string;
}

export interface RequestContext {
  requestId: string;
  correlationId: string;
  traceId?: string;
  spanId?: string;
  clientApp?: string;
  serviceName: string;
  environment: string;
  version: string;
  [key: string]: unknown;
}

// ─── Domain Events ───────────────────────────────────────────────

export type ActorType = 'user' | 'system' | 'scheduler' | 'external';

export interface DomainEventOptions {
  /** The business entity type (e.g. 'tender', 'payment', 'bid') */
  entity_type: string;
  /** The specific entity instance ID (e.g. 'TND-2026-0042') */
  entity_id: string;
  /** Who/what triggered this event */
  actor_type?: ActorType;
  /** Identifier of the actor (user ID, system name) */
  actor_id?: string;
  /** Override log level (default: 'info') */
  level?: LogLevel;
  /** Domain-specific context for troubleshooting */
  metadata?: Record<string, unknown>;
}

// ─── Instrumentation ─────────────────────────────────────────────

export interface InstrumentationPlugin {
  name: string;
  otelInstrumentation?(): Instrumentation | Instrumentation[] | null;
  init?(): void;
  shutdown?(): Promise<void>;
}

export interface ResolvedConfig {
  serviceName: string;
  environment: string;
  version: string;

  logger: Required<LoggerConfig> & {
    redaction: Required<RedactionConfig>;
    excludeRoutes: string[];
  };
  tracing: Required<TracingConfig> & {
    exporter: Required<TracingExporterConfig>;
    sampling: Required<SamplingConfig>;
  };
  metrics: Required<MetricsConfig>;
  health: Required<HealthConfig>;

  instrumentations: InstrumentationPlugin[];
  clientOrigins?: Record<string, string>;
  redaction: Required<RedactionConfig>;
}
