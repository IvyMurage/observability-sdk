import type { ObservabilityConfig, ResolvedConfig } from './types';
import { DEFAULT_REDACTION_PATHS, DEFAULT_CENSOR } from '../security/redaction';

export function resolveConfig(config: ObservabilityConfig): ResolvedConfig {
  const environment = config.environment || process.env.NODE_ENV || 'development';
  const isProd = environment === 'production';

  return {
    serviceName: config.serviceName,
    environment,
    version: config.version || process.env.npm_package_version || '0.0.0',

    logger: {
      level: config.logger?.level || (isProd ? 'info' : 'debug'),
      prettyPrint: config.logger?.prettyPrint ?? !isProd,
      autoRequestLogging: config.logger?.autoRequestLogging ?? true,
      autoErrorLogging: config.logger?.autoErrorLogging ?? true,
      logRequestBody: config.logger?.logRequestBody ?? false,
      logResponseBody: config.logger?.logResponseBody ?? false,
      excludeRoutes: config.logger?.excludeRoutes ?? ['/health', '/metrics'],
      redaction: {
        paths: config.logger?.redaction?.paths || config.redaction?.paths || DEFAULT_REDACTION_PATHS,
        censor: config.logger?.redaction?.censor || config.redaction?.censor || DEFAULT_CENSOR,
      },
    },

    tracing: {
      enabled: config.tracing?.enabled ?? true,
      exporter: {
        type: config.tracing?.exporter?.type || (isProd ? 'otlp-http' : 'console'),
        endpoint: config.tracing?.exporter?.endpoint || envOrDefault('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318'),
        headers: config.tracing?.exporter?.headers || {},
      },
      sampling: {
        type: config.tracing?.sampling?.type || 'parent-based',
        ratio: config.tracing?.sampling?.ratio ?? (isProd ? 0.1 : 1),
      },
    },

    metrics: {
      enabled: config.metrics?.enabled ?? true,
      prefix: config.metrics?.prefix || '',
      defaultMetrics: config.metrics?.defaultMetrics ?? true,
      endpoint: config.metrics?.endpoint || '/metrics',
      labels: {
        service: config.serviceName,
        environment,
        ...config.metrics?.labels,
      },
    },

    health: {
      enabled: config.health?.enabled ?? true,
      endpoint: config.health?.endpoint || '/health',
    },

    instrumentations: config.instrumentations || [],
    clientOrigins: config.clientOrigins,

    redaction: {
      paths: config.redaction?.paths || DEFAULT_REDACTION_PATHS,
      censor: config.redaction?.censor || DEFAULT_CENSOR,
    },
  };
}

function envOrDefault(key: string, fallback: string): string {
  return process.env[key] || fallback;
}
