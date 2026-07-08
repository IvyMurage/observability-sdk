import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import { OBSERVABILITY_TRACER, OBSERVABILITY_CONFIG } from '../core/constants';
import { getContext, enrichContextFromSpan } from '../core/context';
import type { ObservabilityTracer } from '../tracing/tracer.service';
import type { ResolvedConfig } from '../core/types';

const DEFAULT_EXCLUDE = ['/health', '/metrics', '/favicon.ico'];

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  private excludeSet: Set<string>;

  constructor(
    @Inject(OBSERVABILITY_TRACER) private tracer: ObservabilityTracer,
    @Inject(OBSERVABILITY_CONFIG) private config: ResolvedConfig,
  ) {
    const configured = config.logger.excludeRoutes ?? [];
    this.excludeSet = new Set([...DEFAULT_EXCLUDE, ...configured]);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest?.();
    const route = req?.url?.split('?')[0];

    if (route && this.excludeSet.has(route)) {
      return next.handle();
    }

    const handler = context.getHandler();
    const controller = context.getClass();
    const spanName = `${controller.name}.${handler.name}`;

    const rawTracer = this.tracer.getTracer();
    const span = rawTracer.startSpan(spanName);
    const spanContext = trace.setSpan(otelContext.active(), span);

    span.setAttributes({
      'nestjs.controller': controller.name,
      'nestjs.handler': handler.name,
      'nestjs.type': context.getType(),
    });

    if (req?.method) {
      span.setAttribute('http.method', req.method);
      span.setAttribute('http.url', req.url);
    }

    const ctx = getContext();
    if (ctx?.clientApp) {
      span.setAttribute('client.app', ctx.clientApp);
    }

    return otelContext.with(spanContext, () => {
      enrichContextFromSpan();

      return next.handle().pipe(
        tap({
          next: () => {
            const res = context.switchToHttp().getResponse?.();
            if (res?.statusCode) {
              span.setAttribute('http.status_code', res.statusCode);
            }
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
          },
          error: (err: Error) => {
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.recordException(err);
            span.end();
          },
        }),
      );
    });
  }
}
