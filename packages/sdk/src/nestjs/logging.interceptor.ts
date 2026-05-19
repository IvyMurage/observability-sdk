import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { OBSERVABILITY_LOGGER } from '../core/constants';
import type { ObservabilityLogger } from '../logger/logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(@Inject(OBSERVABILITY_LOGGER) private logger: ObservabilityLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!req?.method) return next.handle();

    const { method, url } = req;
    const start = performance.now();

    this.logger.info('request started', { method, url });

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          const duration = performance.now() - start;
          this.logger.info('request completed', {
            method,
            url,
            statusCode: res.statusCode,
            duration_ms: Math.round(duration * 100) / 100,
          });
        },
        error: (err: Error) => {
          const duration = performance.now() - start;
          this.logger.error('request failed', {
            method,
            url,
            error: err.message,
            duration_ms: Math.round(duration * 100) / 100,
          });
        },
      }),
    );
  }
}
