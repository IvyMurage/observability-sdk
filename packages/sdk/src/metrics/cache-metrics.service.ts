import { Injectable, Inject } from '@nestjs/common';
import type { Counter, Histogram } from 'prom-client';
import { OBSERVABILITY_METRICS } from '../core/constants';
import type { ObservabilityMetrics } from './metrics.service';
import { getContext } from '../core/context';

/**
 * Injectable service for recording cache hit/miss Prometheus metrics.
 *
 * Wraps your existing cache calls — replace `cache.get()` with
 * `cacheMetrics.get(cache, key, 'operation')` to automatically track
 * hit rate, miss rate, and operation latency.
 *
 * @example
 * ```typescript
 * import { CacheMetricsService } from '@brdrwanda/observability';
 *
 * @Injectable()
 * export class ConfigService {
 *   constructor(
 *     @Inject(CACHE_MANAGER) private cache: Cache,
 *     private cacheMetrics: CacheMetricsService,
 *   ) {}
 *
 *   async getConfig(key: string) {
 *     const cached = await this.cacheMetrics.get(this.cache, key, 'config');
 *     if (cached) return cached;
 *
 *     const fresh = await this.fetchFromDb(key);
 *     await this.cacheMetrics.set(this.cache, key, fresh, 300, 'config');
 *     return fresh;
 *   }
 * }
 * ```
 */
@Injectable()
export class CacheMetricsService {
  private hitsTotal: Counter;
  private missesTotal: Counter;
  private operationDuration: Histogram;

  constructor(@Inject(OBSERVABILITY_METRICS) metrics: ObservabilityMetrics) {
    this.hitsTotal = metrics.createCounter(
      'cache_hits_total',
      'Total cache hits',
      ['operation'],
    );

    this.missesTotal = metrics.createCounter(
      'cache_misses_total',
      'Total cache misses',
      ['operation'],
    );

    this.operationDuration = metrics.createHistogram(
      'cache_operation_duration_seconds',
      'Cache operation latency in seconds',
      ['operation', 'result'],
      [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1],
      true,
    );
  }

  /**
   * Get a value from cache with automatic hit/miss tracking.
   *
   * @param cache - The cache instance (e.g. from CACHE_MANAGER)
   * @param key - Cache key
   * @param operation - Label for this cache operation (e.g. 'config', 'session', 'user_profile')
   * @returns The cached value, or undefined on miss
   */
  async get<T>(
    cache: CacheLike,
    key: string,
    operation = 'default',
  ): Promise<T | undefined> {
    const start = performance.now();
    const raw = await cache.get<T>(key);
    const durationSec = (performance.now() - start) / 1000;

    const isHit = raw !== undefined && raw !== null;
    const result = isHit ? 'hit' : 'miss';

    if (isHit) {
      this.hitsTotal.inc({ operation });
    } else {
      this.missesTotal.inc({ operation });
    }

    const traceId = getContext()?.traceId;
    this.operationDuration.observe({
      labels: { operation, result },
      value: durationSec,
      exemplarLabels: traceId ? { trace_id: traceId } : undefined,
    });

    // Normalize null → undefined for consistent return type
    return isHit ? (raw as T) : undefined;
  }

  /**
   * Set a value in cache with latency tracking.
   *
   * @param cache - The cache instance
   * @param key - Cache key
   * @param value - Value to store
   * @param ttl - Time-to-live in seconds (or milliseconds, depending on cache-manager version)
   * @param operation - Label for this cache operation
   */
  async set(
    cache: CacheLike,
    key: string,
    value: unknown,
    ttl?: number,
    operation = 'default',
  ): Promise<void> {
    const start = performance.now();
    await cache.set(key, value, ttl);
    const durationSec = (performance.now() - start) / 1000;

    const traceId = getContext()?.traceId;
    this.operationDuration.observe({
      labels: { operation, result: 'set' },
      value: durationSec,
      exemplarLabels: traceId ? { trace_id: traceId } : undefined,
    });
  }

  /**
   * Delete a value from cache with latency tracking.
   *
   * @param cache - The cache instance
   * @param key - Cache key
   * @param operation - Label for this cache operation
   */
  async del(
    cache: CacheLike,
    key: string,
    operation = 'default',
  ): Promise<void> {
    const start = performance.now();
    await cache.del(key);
    const durationSec = (performance.now() - start) / 1000;

    const traceId = getContext()?.traceId;
    this.operationDuration.observe({
      labels: { operation, result: 'del' },
      value: durationSec,
      exemplarLabels: traceId ? { trace_id: traceId } : undefined,
    });
  }
}

/**
 * Minimal cache interface — compatible with cache-manager's Cache type
 * and most cache wrappers. Avoids importing cache-manager as a dependency.
 */
export interface CacheLike {
  get<T>(key: string): Promise<T | undefined | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
}
