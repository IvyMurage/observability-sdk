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
import { OBSERVABILITY_CONFIG, OBSERVABILITY_LOGGER } from '../core/constants';
import type { ObservabilityLogger } from '../logger/logger.service';
import type { ResolvedConfig } from '../core/types';
import { getContext } from '../core/context';

@Catch()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(OBSERVABILITY_LOGGER) private logger: ObservabilityLogger,
    @Inject(OBSERVABILITY_CONFIG) private config: ResolvedConfig,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpCtx = host.switchToHttp();
    const response = httpCtx.getResponse<Response>();
    const request = httpCtx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const { message, event, validationErrors } = this.extractErrorDetails(exception, status);

    const ctx = getContext();

    const meta: Record<string, unknown> = {
      event,
      statusCode: status,
      message,
      method: request?.method,
      url: request?.url,
    };

    if (validationErrors) {
      meta.validationErrors = validationErrors;
    }

    if (status >= 500 && exception instanceof Error) {
      meta.stack = exception.stack;
    }

    if (this.config.logger.autoErrorLogging) {
      if (status >= 500) {
        this.logger.error(event, meta);
      } else if (status >= 400) {
        this.logger.warn(event, meta);
      }
    }

    const span = trace.getActiveSpan();
    if (span) {
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.setAttribute('error.event', event);
      span.setAttribute('http.status_code', status);
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

  private extractErrorDetails(
    exception: unknown,
    status: number,
  ): { message: string; event: string; validationErrors?: string[] } {
    let message = 'Internal server error';
    let validationErrors: string[] | undefined;

    if (exception instanceof HttpException) {
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        const rawMessage = body.message;

        if (Array.isArray(rawMessage)) {
          validationErrors = rawMessage.map(String);
          message = validationErrors.join(', ');
        } else if (typeof rawMessage === 'string') {
          message = rawMessage;
        } else {
          message = exception.message;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const event = this.classifyEvent(status, message, !!validationErrors);

    return { message, event, validationErrors };
  }

  private classifyEvent(status: number, _message: string, hasValidationErrors?: boolean): string {
    if (status === 400 && hasValidationErrors) return 'validation_failed';
    switch (status) {
      case 400: return 'bad_request';
      case 401: return 'authentication_failed';
      case 403: return 'authorization_failed';
      case 404: return 'not_found';
      case 409: return 'conflict';
      case 422: return 'validation_failed';
      case 429: return 'rate_limited';
      default:
        if (status >= 500) return 'server_error';
        return 'client_error';
    }
  }
}
