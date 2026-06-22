import { trace, SpanStatusCode } from '@opentelemetry/api';

export function Span(name?: string): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    const spanName = name || String(propertyKey);

    descriptor.value = function (...args: unknown[]) {
      const tracer = trace.getTracer('observability-sdk');
      return tracer.startActiveSpan(spanName, (span) => {
        try {
          const result = original.apply(this, args);

          if (result instanceof Promise) {
            return result
              .then((val: unknown) => {
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return val;
              })
              .catch((err: Error) => {
                span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                span.recordException(err);
                span.end();
                throw err;
              });
          }

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          span.recordException(err as Error);
          span.end();
          throw err;
        }
      });
    };

    return descriptor;
  };
}
