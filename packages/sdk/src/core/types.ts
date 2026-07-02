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
