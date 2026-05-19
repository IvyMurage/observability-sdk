import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { Response } from 'express';
import { OBSERVABILITY_LOGGER } from '../core/constants';
import type { ObservabilityLogger } from '../logger/logger.service';
import { getContext } from '../core/context';

@Catch()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  constructor(@Inject(OBSERVABILITY_LOGGER) private logger: ObservabilityLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpCtx = host.switchToHttp();
    const response = httpCtx.getResponse<Response>();
    const request = httpCtx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof Error ? exception.message : 'Internal server error';

    const ctx = getContext();

    this.logger.error('unhandled exception', {
      error: message,
      statusCode: status,
      method: request?.method,
      url: request?.url,
      stack: exception instanceof Error ? exception.stack : undefined,
    });

    const span = trace.getActiveSpan();
    if (span) {
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      if (exception instanceof Error) {
        span.recordException(exception);
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      requestId: ctx?.requestId,
      traceId: ctx?.traceId,
    });
  }
}
