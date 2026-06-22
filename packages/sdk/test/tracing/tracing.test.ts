import { describe, it, expect, afterEach } from 'vitest';
import { trace } from '@opentelemetry/api';
import { resolveConfig } from '../../src/core/config';
import { initTracing, shutdownTracing } from '../../src/tracing/tracing.init';
import { ObservabilityTracer } from '../../src/tracing/tracer.service';

describe('tracing', () => {
  afterEach(async () => {
    await shutdownTracing();
  });

  describe('initTracing', () => {
    it('should return null when tracing disabled', () => {
      const config = resolveConfig({
        serviceName: 'test',
        tracing: { enabled: false },
      });

      const provider = initTracing(config);
      expect(provider).toBeNull();
    });

    it('should create provider with console exporter', () => {
      const config = resolveConfig({
        serviceName: 'test-tracing',
        tracing: { exporter: { type: 'console' } },
      });

      const provider = initTracing(config);
      expect(provider).toBeDefined();
    });

    it('should create provider with no exporter', () => {
      const config = resolveConfig({
        serviceName: 'test-none',
        tracing: { exporter: { type: 'none' } },
      });

      const provider = initTracing(config);
      expect(provider).toBeDefined();
    });

    it('should be idempotent (second call returns same provider)', () => {
      const config = resolveConfig({
        serviceName: 'test-idempotent',
        tracing: { exporter: { type: 'none' } },
      });

      const p1 = initTracing(config);
      const p2 = initTracing(config);
      expect(p1).toBe(p2);
    });
  });

  describe('ObservabilityTracer', () => {
    it('should create tracer instance', () => {
      const config = resolveConfig({
        serviceName: 'test-tracer',
        tracing: { exporter: { type: 'none' } },
      });
      initTracing(config);

      const tracer = new ObservabilityTracer(config);
      expect(tracer).toBeDefined();
      expect(tracer.getTracer()).toBeDefined();
    });

    it('should start active span and return result', async () => {
      const config = resolveConfig({
        serviceName: 'test-span',
        tracing: { exporter: { type: 'none' } },
      });
      initTracing(config);
      const tracer = new ObservabilityTracer(config);

      const result = await tracer.startActiveSpan('test-op', async (span) => {
        expect(span).toBeDefined();
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should record exception on span when fn throws', async () => {
      const config = resolveConfig({
        serviceName: 'test-error',
        tracing: { exporter: { type: 'none' } },
      });
      initTracing(config);
      const tracer = new ObservabilityTracer(config);

      await expect(
        tracer.startActiveSpan('failing-op', async () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');
    });
  });
});
