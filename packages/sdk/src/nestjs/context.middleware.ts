import { Injectable, Inject, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { OBSERVABILITY_CONFIG } from '../core/constants';
import type { ResolvedConfig } from '../core/types';
import { createRequestContext, runWithContext, enrichContextFromSpan } from '../core/context';

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  constructor(@Inject(OBSERVABILITY_CONFIG) private config: ResolvedConfig) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId =
      (req.headers['x-request-id'] as string) ||
      (req.headers['x-amzn-requestid'] as string) ||
      undefined;

    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      requestId ||
      undefined;

    const origin = req.headers['origin'] as string | undefined;
    const refererOrigin = this.extractOrigin(req.headers['referer'] as string | undefined);
    const sourceOrigin = origin || refererOrigin;
    const clientApp =
      (req.headers['x-client-app'] as string) ||
      this.resolveClientApp(sourceOrigin) ||
      sourceOrigin ||
      undefined;

    const ctx = createRequestContext(
      this.config.serviceName,
      this.config.environment,
      this.config.version,
      { requestId, correlationId, clientApp },
    );

    runWithContext(ctx, () => {
      enrichContextFromSpan();
      next();
    });
  }

  private resolveClientApp(origin: string | undefined): string | undefined {
    if (!origin || !this.config.clientOrigins) return undefined;
    return this.config.clientOrigins[origin];
  }

  private extractOrigin(referer: string | undefined): string | undefined {
    if (!referer) return undefined;
    try {
      const url = new URL(referer);
      return url.origin;
    } catch {
      return undefined;
    }
  }
}
