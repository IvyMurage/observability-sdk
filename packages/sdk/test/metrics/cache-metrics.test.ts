import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheMetricsService } from '../../src/metrics/cache-metrics.service';
import { ObservabilityMetrics } from '../../src/metrics/metrics.service';
import { resolveConfig } from '../../src/core/config';
import type { CacheLike } from '../../src/metrics/cache-metrics.service';

function makeConfig() {
  return resolveConfig({
    serviceName: 'test-service',
    metrics: { prefix: 'cachetest' },
  });
}

function makeMockCache(data: Record<string, unknown> = {}): CacheLike {
  const store = { ...data };
  return {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
      return store[key] as T | undefined;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
    del: vi.fn(async (key: string) => {
      delete store[key];
    }),
  };
}

describe('CacheMetricsService', () => {
  let service: CacheMetricsService;
  let metrics: ObservabilityMetrics;

  beforeEach(() => {
    metrics = new ObservabilityMetrics(makeConfig());
    // CacheMetricsService expects injection via OBSERVABILITY_METRICS token,
    // but we can construct directly for testing
    service = new CacheMetricsService(metrics as any);
  });

  it('should record cache hit', async () => {
    const cache = makeMockCache({ myKey: 'hello' });
    const result = await service.get(cache, 'myKey', 'config');

    expect(result).toBe('hello');
    expect(cache.get).toHaveBeenCalledWith('myKey');

    const output = await metrics.getMetrics();
    expect(output).toContain('cachetest_cache_hits_total');
    expect(output).toContain('operation="config"');
    expect(output).not.toContain('cachetest_cache_misses_total{');
  });

  it('should record cache miss', async () => {
    const cache = makeMockCache({});
    const result = await service.get(cache, 'missing', 'session');

    expect(result).toBeUndefined();

    const output = await metrics.getMetrics();
    expect(output).toContain('cachetest_cache_misses_total');
    expect(output).toContain('operation="session"');
  });

  it('should record set operation latency', async () => {
    const cache = makeMockCache();
    await service.set(cache, 'key', 'value', 300, 'config');

    expect(cache.set).toHaveBeenCalledWith('key', 'value', 300);

    const output = await metrics.getMetrics();
    expect(output).toContain('cachetest_cache_operation_duration_seconds');
    expect(output).toContain('result="set"');
  });

  it('should record del operation latency', async () => {
    const cache = makeMockCache({ key: 'val' });
    await service.del(cache, 'key', 'cleanup');

    expect(cache.del).toHaveBeenCalledWith('key');

    const output = await metrics.getMetrics();
    expect(output).toContain('cachetest_cache_operation_duration_seconds');
    expect(output).toContain('result="del"');
  });

  it('should normalize null to undefined on miss', async () => {
    const cache: CacheLike = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
    };

    const result = await service.get(cache, 'key');
    expect(result).toBeUndefined();

    const output = await metrics.getMetrics();
    expect(output).toContain('cachetest_cache_misses_total');
  });

  it('should use default operation label when not specified', async () => {
    const cache = makeMockCache({ k: 'v' });
    await service.get(cache, 'k');

    const output = await metrics.getMetrics();
    expect(output).toContain('operation="default"');
  });
});
