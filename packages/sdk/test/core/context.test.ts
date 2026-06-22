import { describe, it, expect } from 'vitest';
import { getContext, runWithContext, createRequestContext } from '../../src/core/context';

describe('context', () => {
  it('should return undefined outside of context', () => {
    expect(getContext()).toBeUndefined();
  });

  it('should provide context within runWithContext', () => {
    const ctx = createRequestContext('test-svc', 'dev', '1.0.0');

    runWithContext(ctx, () => {
      const current = getContext();
      expect(current).toBeDefined();
      expect(current!.serviceName).toBe('test-svc');
      expect(current!.environment).toBe('dev');
      expect(current!.version).toBe('1.0.0');
      expect(current!.requestId).toBeDefined();
      expect(current!.correlationId).toBeDefined();
    });
  });

  it('should isolate context between runs', () => {
    const ctx1 = createRequestContext('svc-1', 'dev', '1.0.0');
    const ctx2 = createRequestContext('svc-2', 'dev', '1.0.0');

    runWithContext(ctx1, () => {
      expect(getContext()!.serviceName).toBe('svc-1');
    });

    runWithContext(ctx2, () => {
      expect(getContext()!.serviceName).toBe('svc-2');
    });
  });

  it('should use overrides when provided', () => {
    const ctx = createRequestContext('svc', 'prod', '2.0.0', {
      requestId: 'custom-req-id',
      correlationId: 'custom-corr-id',
    });

    expect(ctx.requestId).toBe('custom-req-id');
    expect(ctx.correlationId).toBe('custom-corr-id');
  });

  it('should use requestId as correlationId fallback', () => {
    const ctx = createRequestContext('svc', 'dev', '1.0.0', {
      requestId: 'req-123',
    });

    expect(ctx.correlationId).toBe('req-123');
  });

  it('should propagate context through async operations', async () => {
    const ctx = createRequestContext('async-svc', 'dev', '1.0.0');

    await runWithContext(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const current = getContext();
      expect(current).toBeDefined();
      expect(current!.serviceName).toBe('async-svc');
    });
  });
});
