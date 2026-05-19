import { describe, it, expect, beforeEach } from 'vitest';
import { ObservabilityMetrics } from '../../src/metrics/metrics.service';
import { resolveConfig } from '../../src/core/config';

describe('ObservabilityMetrics', () => {
  let metrics: ObservabilityMetrics;

  beforeEach(() => {
    const config = resolveConfig({
      serviceName: 'test-metrics',
      metrics: { prefix: 'test', defaultMetrics: false },
    });
    metrics = new ObservabilityMetrics(config);
  });

  it('should create metrics instance', () => {
    expect(metrics).toBeDefined();
    expect(metrics.getRegistry()).toBeDefined();
  });

  it('should create counter', () => {
    const counter = metrics.createCounter('requests_total', 'Total requests', ['method']);
    expect(counter).toBeDefined();
    counter.inc({ method: 'GET' });
    counter.inc({ method: 'POST' }, 5);
  });

  it('should create histogram', () => {
    const histogram = metrics.createHistogram(
      'request_duration_seconds',
      'Request duration',
      ['method'],
    );
    expect(histogram).toBeDefined();
    histogram.observe({ method: 'GET' }, 0.123);
  });

  it('should create histogram with custom buckets', () => {
    const histogram = metrics.createHistogram(
      'custom_duration',
      'Custom duration',
      [],
      [0.1, 0.5, 1, 5],
    );
    expect(histogram).toBeDefined();
    histogram.observe(0.3);
  });

  it('should create gauge', () => {
    const gauge = metrics.createGauge('active_connections', 'Active connections');
    expect(gauge).toBeDefined();
    gauge.set(10);
    gauge.inc();
    gauge.dec();
  });

  it('should return prometheus format metrics', async () => {
    metrics.createCounter('test_counter', 'Test counter');
    const output = await metrics.getMetrics();
    expect(output).toContain('test_test_counter');
    expect(typeof output).toBe('string');
  });

  it('should return correct content type', () => {
    const contentType = metrics.getContentType();
    expect(contentType).toContain('text/plain');
  });

  it('should apply prefix to metric names', async () => {
    metrics.createCounter('my_counter', 'My counter');
    const output = await metrics.getMetrics();
    expect(output).toContain('test_my_counter');
  });
});
