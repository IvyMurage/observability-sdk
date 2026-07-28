import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Counter, Histogram } from 'prom-client';
import { OBSERVABILITY_METRICS } from '../core/constants';
import type { ObservabilityMetrics } from '../metrics/metrics.service';
import { getContext } from '../core/context';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private httpRequestsTotal: Counter;
  private httpRequestDuration: Histogram;

  constructor(@Inject(OBSERVABILITY_METRICS) metrics: ObservabilityMetrics) {
    this.httpRequestsTotal = metrics.createCounter(
      'http_requests_total',
      'Total number of HTTP requests',
      ['method', 'route', 'status_code'],
    );

    this.httpRequestDuration = metrics.createHistogram(
      'http_request_duration_seconds',
      'HTTP request duration in seconds',
      ['method', 'route', 'status_code'],
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      true,
    );
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!req?.method) return next.handle();

    const { method } = req;
    const route = this.extractRoute(context, req);
    const start = performance.now();

    const recordMetrics = (statusCode: string) => {
      const duration = (performance.now() - start) / 1000;
      const labels = { method, route, status_code: statusCode };
      const traceId = getContext()?.traceId;
      this.httpRequestsTotal.inc(labels);
      this.httpRequestDuration.observe({
        labels,
        value: duration,
        exemplarLabels: traceId ? { trace_id: traceId } : undefined,
      });
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          recordMetrics(String(res.statusCode));
        },
        error: (err: Error & { status?: number }) => {
          recordMetrics(String(err.status || 500));
        },
      }),
    );
  }

  private extractRoute(context: ExecutionContext, req: { route?: { path?: string }; url?: string }): string {
    if (req.route?.path) return req.route.path;
    const handler = context.getHandler();
    const controller = context.getClass();
    return `${controller.name}.${handler.name}`;
  }
}
