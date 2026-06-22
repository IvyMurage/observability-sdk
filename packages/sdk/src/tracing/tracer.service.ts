import { trace, SpanStatusCode, type Span, type Tracer, type SpanOptions } from '@opentelemetry/api';
import type { ResolvedConfig } from '../core/types';

export class ObservabilityTracer {
  private tracer: Tracer;

  constructor(config: ResolvedConfig) {
    this.tracer = trace.getTracer(config.serviceName, config.version);
  }

  async startActiveSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: SpanOptions,
  ): Promise<T> {
    return this.tracer.startActiveSpan(name, options || {}, async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  getTracer(): Tracer {
    return this.tracer;
  }
}
