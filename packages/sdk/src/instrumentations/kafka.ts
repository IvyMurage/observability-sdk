import { context, propagation, trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type { InstrumentationPlugin } from '../core/types';

export function kafkaInstrumentation(): InstrumentationPlugin {
  return {
    name: 'kafka',
    otelInstrumentation() {
      try {
        const mod = require('@opentelemetry/instrumentation-kafkajs');
        return new mod.KafkaJsInstrumentation();
      } catch {
        return null;
      }
    },
  };
}

export function injectKafkaHeaders(
  existingHeaders?: Record<string, string | Buffer | undefined>,
): Record<string, string | Buffer | undefined> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  return { ...existingHeaders, ...headers };
}

export function withKafkaContext<T>(
  headers: Record<string, Buffer | string | undefined> | undefined,
  spanName: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const carrier: Record<string, string> = {};
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (value) carrier[key] = value.toString();
    }
  }

  const extractedCtx = propagation.extract(context.active(), carrier);
  const tracer = trace.getTracer('observability-sdk');

  return context.with(extractedCtx, () =>
    tracer.startActiveSpan(spanName, { kind: SpanKind.CONSUMER }, async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        span.recordException(err as Error);
        span.end();
        throw err;
      }
    }),
  );
}
