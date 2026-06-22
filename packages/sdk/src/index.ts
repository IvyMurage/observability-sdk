// Module
export { ObservabilityModule } from './nestjs/observability.module';
export { ObservabilityHealthModule } from './health/health.module';

// Config & types
export type {
  ObservabilityConfig,
  ResolvedConfig,
  LoggerConfig,
  TracingConfig,
  MetricsConfig,
  HealthConfig,
  RedactionConfig,
  SamplingConfig,
  RequestContext,
  InstrumentationPlugin,
  LogLevel,
} from './core/types';

// Constants
export {
  OBSERVABILITY_CONFIG,
  OBSERVABILITY_LOGGER,
  OBSERVABILITY_TRACER,
  OBSERVABILITY_METRICS,
} from './core/constants';

// Context
export { getContext, runWithContext, createRequestContext } from './core/context';

// Logger
export { ObservabilityLogger } from './logger/logger.service';
export { NestPinoLogger } from './logger/nest-logger';

// Tracing
export { ObservabilityTracer } from './tracing/tracer.service';
export { Span } from './nestjs/span.decorator';

// Metrics
export { ObservabilityMetrics } from './metrics/metrics.service';

// Instrumentations
export { httpInstrumentation } from './instrumentations/http';
export type { HttpInstrumentationOptions } from './instrumentations/http';
export { kafkaInstrumentation, injectKafkaHeaders, withKafkaContext } from './instrumentations/kafka';
export { redisInstrumentation } from './instrumentations/redis';
export { mysqlInstrumentation } from './instrumentations/mysql';
export { pgInstrumentation } from './instrumentations/pg';
export { sequelizeInstrumentation, createSequelizeLogging, createSequelizeErrorLogging } from './instrumentations/sequelize';
export type { SequelizeInstrumentationOptions, SequelizeLoggingFn } from './instrumentations/sequelize';
export { sanitizeQuery, extractOperation, extractTable, parseQuery } from './instrumentations/query-sanitizer';
export type { ParsedQuery } from './instrumentations/query-sanitizer';

// Security
export { sanitizeHeaders, DEFAULT_REDACTION_PATHS } from './security/redaction';

// Health & Diagnostics
export { DiagnosticsService } from './diagnostics/diagnostics.service';
export type { DiagnosticsReport } from './diagnostics/diagnostics.service';

// Bootstrap
export { setupProcessErrorHandlers } from './bootstrap/process-error-handler';
export type { ProcessErrorHandlerOptions } from './bootstrap/process-error-handler';

// Early tracing init (call in main.ts before importing AppModule)
export { setupTracing } from './tracing/tracing.init';

// Standalone (framework-agnostic)
export { createObservability } from './standalone';
export type { Observability } from './standalone';
