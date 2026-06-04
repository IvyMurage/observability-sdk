import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import type { RequestContext } from './types';

const storage = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function createRequestContext(
  serviceName: string,
  environment: string,
  version: string,
  overrides?: Partial<RequestContext>,
): RequestContext {
  const span = trace.getActiveSpan();
  const spanCtx = span?.spanContext();

  const defined = overrides
    ? Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined))
    : {};

  return {
    requestId: overrides?.requestId || randomUUID(),
    correlationId: overrides?.correlationId || overrides?.requestId || randomUUID(),
    traceId: spanCtx?.traceId || overrides?.traceId,
    spanId: spanCtx?.spanId || overrides?.spanId,
    serviceName,
    environment,
    version,
    ...defined,
  };
}

export function enrichContextFromSpan(): void {
  const ctx = storage.getStore();
  if (!ctx) return;

  const span = trace.getActiveSpan();
  if (!span) return;

  const spanCtx = span.spanContext();
  ctx.traceId = spanCtx.traceId;
  ctx.spanId = spanCtx.spanId;
}
