import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { getContext } from '../core/context';
import type { ResolvedConfig, DomainEventOptions, LogLevel } from '../core/types';

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
      transport: this.buildTransport(config),
    });
  }

  private buildTransport(config: ResolvedConfig): pino.TransportSingleOptions | pino.TransportMultiOptions | undefined {
    const targets: pino.TransportTargetOptions[] = [];

    if (config.logger.otlpExport) {
      targets.push({
        target: 'pino-opentelemetry-transport',
        options: {
          resourceAttributes: {
            'service.name': config.serviceName,
            'deployment.environment': config.environment,
            'service.version': config.version,
            'log.pipeline': 'otlp',
          },
        },
      });
    }

    if (config.logger.prettyPrint) {
      targets.push({
        target: 'pino-pretty',
        options: { colorize: true },
      });
    }

    // No transports — write to stdout directly (fastest)
    if (targets.length === 0) return undefined;

    // Single transport
    if (targets.length === 1) return { target: targets[0].target, options: targets[0].options };

    // Multiple transports
    return { targets };
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

  /**
   * Log a domain/business event with standardized schema.
   *
   * Domain events capture business state transitions and actions — not
   * technical HTTP lifecycle (the SDK handles that automatically).
   *
   * @example
   * ```ts
   * logger.domainEvent('tender.published', {
   *   entity_type: 'tender',
   *   entity_id: 'TND-2026-0042',
   *   actor_type: 'user',
   *   actor_id: 'USR-00451',
   *   metadata: {
   *     previous_status: 'draft',
   *     new_status: 'published',
   *     lot_count: 3,
   *   },
   * });
   * ```
   *
   * The SDK automatically injects: service_name, environment, version,
   * request_id, correlation_id, trace_id, span_id, event_category.
   *
   * @param eventName - Dot-separated event name: `{entity}.{action}` (e.g. `tender.published`, `bid.submitted`)
   * @param options - Entity identification, actor info, and domain-specific metadata
   */
  domainEvent(eventName: string, options: DomainEventOptions): void {
    const isProd = this.config.environment === 'production';

    // Validate event name format in non-production environments
    if (!isProd) {
      const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$/;
      if (!EVENT_NAME_PATTERN.test(eventName)) {
        this.pino.warn(
          {
            event_name: eventName,
            expected_pattern: '{entity}.{action} (e.g. tender.published)',
          },
          'invalid_domain_event_name',
        );
      }

      if (!options.entity_type || !options.entity_id) {
        this.pino.warn(
          {
            event_name: eventName,
            missing: [
              !options.entity_type && 'entity_type',
              !options.entity_id && 'entity_id',
            ].filter(Boolean),
          },
          'domain_event_missing_required_fields',
        );
      }
    }

    const level: LogLevel = options.level || 'info';

    const payload: Record<string, unknown> = {
      event_category: 'domain',
      entity_type: options.entity_type,
      entity_id: options.entity_id,
    };

    if (options.actor_type) payload.actor_type = options.actor_type;
    if (options.actor_id) payload.actor_id = options.actor_id;
    if (options.metadata) payload.metadata = options.metadata;

    this.pino[level](payload, eventName);
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
