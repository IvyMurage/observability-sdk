import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { context as otelContext } from '@opentelemetry/api';
import { OBSERVABILITY_CONFIG, OBSERVABILITY_LOGGER } from '../core/constants';
import type { ObservabilityLogger } from '../logger/logger.service';
import type { ResolvedConfig } from '../core/types';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private excludeSet: Set<string>;

  constructor(
    @Inject(OBSERVABILITY_LOGGER) private logger: ObservabilityLogger,
    @Inject(OBSERVABILITY_CONFIG) private config: ResolvedConfig,
  ) {
    this.excludeSet = new Set(config.logger.excludeRoutes);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.config.logger.autoRequestLogging) return next.handle();

    const req = context.switchToHttp().getRequest();
    if (!req?.method) return next.handle();

    const { method, url } = req;
    const route = url?.split('?')[0];

    if (this.excludeSet.has(route)) return next.handle();

    const controller = context.getClass()?.name;
    const handler = context.getHandler()?.name;
    const start = performance.now();
    const activeContext = otelContext.active();

    const startMeta: Record<string, unknown> = { method, route, controller, handler };
    if (this.config.logger.logRequestBody && req.body) {
      startMeta.body = req.body;
    }
    this.logger.info('request_start', startMeta);

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          otelContext.with(activeContext, () => {
            const res = context.switchToHttp().getResponse();
            const duration_ms = Math.round((performance.now() - start) * 100) / 100;
            const completeMeta: Record<string, unknown> = {
              method, route, controller, handler,
              statusCode: res.statusCode,
              duration_ms,
            };
            if (this.config.logger.logResponseBody && responseBody) {
              completeMeta.responseBody = responseBody;
            }
            this.logger.info('request_complete', completeMeta);
          });
        },
        error: (err: Error) => {
          otelContext.with(activeContext, () => {
            const duration_ms = Math.round((performance.now() - start) * 100) / 100;
            this.logger.error('request_failed', {
              method, route, controller, handler,
              error: err.message,
              duration_ms,
            });
          });
        },
      }),
    );
  }
}
