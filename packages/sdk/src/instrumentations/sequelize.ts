import type { InstrumentationPlugin } from '../core/types';
import type { ObservabilityLogger } from '../logger/logger.service';
import { parseQuery } from './query-sanitizer';

export interface SequelizeInstrumentationOptions {
  logging?: boolean;
  tracing?: boolean;
  sanitizeQueries?: boolean;
  captureSqlText?: boolean;
  slowQueryThreshold?: number;
}

const DEFAULT_OPTIONS: Required<SequelizeInstrumentationOptions> = {
  logging: true,
  tracing: true,
  sanitizeQueries: true,
  captureSqlText: false,
  slowQueryThreshold: 500,
};

export function sequelizeInstrumentation(
  options?: SequelizeInstrumentationOptions,
): InstrumentationPlugin {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    name: 'sequelize',
    otelInstrumentation() {
      if (!opts.tracing) return null;
      try {
        const mod = require('opentelemetry-instrumentation-sequelize');
        return new mod.SequelizeInstrumentation({
          suppressInternalInstrumentation: true,
        });
      } catch {
        console.debug(
          '[observability] Install opentelemetry-instrumentation-sequelize for Sequelize tracing',
        );
        return null;
      }
    },
  };
}

export type SequelizeLoggingFn = (sql: string, timing?: number) => void;

export function createSequelizeLogging(
  logger: ObservabilityLogger,
  options?: SequelizeInstrumentationOptions,
): SequelizeLoggingFn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return (sql: string, timing?: number) => {
    const parsed = parseQuery(sql, opts.captureSqlText && !opts.sanitizeQueries);
    const durationMs = timing ?? 0;

    const meta: Record<string, unknown> = {
      event: durationMs > opts.slowQueryThreshold ? 'db.slow_query' : 'db.query',
      'db.operation': parsed.operation,
      table: parsed.table,
      duration_ms: durationMs,
      success: true,
    };

    if (opts.captureSqlText) {
      meta['db.statement'] = opts.sanitizeQueries
        ? parseQuery(sql, true).sanitized
        : sql;
    }

    if (durationMs > opts.slowQueryThreshold) {
      logger.warn('slow query detected', meta);
    } else {
      logger.debug('query executed', meta);
    }
  };
}

export function createSequelizeErrorLogging(
  logger: ObservabilityLogger,
  options?: SequelizeInstrumentationOptions,
): (error: Error, sql?: string) => void {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return (error: Error, sql?: string) => {
    const meta: Record<string, unknown> = {
      event: 'db.query_error',
      success: false,
      error: error.message,
    };

    if (sql) {
      const parsed = parseQuery(sql, opts.captureSqlText);
      meta['db.operation'] = parsed.operation;
      meta.table = parsed.table;
      if (opts.captureSqlText && parsed.sanitized) {
        meta['db.statement'] = parsed.sanitized;
      }
    }

    logger.error('query failed', meta);
  };
}
