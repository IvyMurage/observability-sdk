import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { getContext } from '../core/context';
import type { ResolvedConfig } from '../core/types';

export class ObservabilityLogger {
  private pino: pino.Logger;

  constructor(private config: ResolvedConfig) {
    this.pino = pino({
      name: config.serviceName,
      level: config.logger.level,
      redact: {
        paths: config.logger.redaction.paths,
        censor: config.logger.redaction.censor,
      },
      serializers: {
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
        err: pino.stdSerializers.err,
      },
      mixin: () => this.getContextFields(),
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      transport: config.logger.prettyPrint
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    });
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.pino.debug(meta || {}, message);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.pino.info(meta || {}, message);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.pino.warn(meta || {}, message);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.pino.error(meta || {}, message);
  }

  fatal(message: string, meta?: Record<string, unknown>): void {
    this.pino.fatal(meta || {}, message);
  }

  logCaughtError(error: unknown): void {
    const err = error as Record<string, any>;
    const status = err?.getStatus?.() ?? err?.statusCode ?? 500;
    const message = err?.response?.message ?? err?.message ?? 'Unknown error';
    const meta: Record<string, unknown> = { statusCode: status, message };

    if (status >= 500) {
      meta.stack = err?.stack;
      this.pino.error(meta, 'request_error');
    } else {
      this.pino.warn(meta, 'request_error');
    }
  }

  child(bindings: Record<string, unknown>): ObservabilityLogger {
    const child = Object.create(this) as ObservabilityLogger;
    child.pino = this.pino.child(bindings);
    return child;
  }

  getPinoInstance(): pino.Logger {
    return this.pino;
  }

  private getContextFields(): Record<string, unknown> {
    const ctx = getContext();
    const span = trace.getActiveSpan();
    const spanCtx = span?.spanContext();

    return {
      service_name: this.config.serviceName,
      environment: this.config.environment,
      version: this.config.version,
      ...(ctx && {
        request_id: ctx.requestId,
        correlation_id: ctx.correlationId,
        ...(ctx.clientApp && { client_app: ctx.clientApp }),
      }),
      ...(spanCtx && {
        trace_id: spanCtx.traceId,
        span_id: spanCtx.spanId,
      }),
    };
  }
}
