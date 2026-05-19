import { Injectable, Inject, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { OBSERVABILITY_CONFIG } from '../core/constants';
import type { ResolvedConfig } from '../core/types';
import { createRequestContext, runWithContext, enrichContextFromSpan } from '../core/context';

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  constructor(@Inject(OBSERVABILITY_CONFIG) private config: ResolvedConfig) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const requestId =
      (req.headers['x-request-id'] as string) ||
      (req.headers['x-amzn-requestid'] as string) ||
      undefined;

    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      requestId ||
      undefined;

    const ctx = createRequestContext(
      this.config.serviceName,
      this.config.environment,
      this.config.version,
      { requestId, correlationId },
    );

    runWithContext(ctx, () => {
      enrichContextFromSpan();
      next();
    });
  }
}
