import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig } from '../../src/core/config';

describe('resolveConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should resolve minimal config with defaults', () => {
    const config = resolveConfig({ serviceName: 'test-service' });

    expect(config.serviceName).toBe('test-service');
    expect(config.environment).toBe('test');
    expect(config.version).toBeDefined();
    expect(config.logger.level).toBe('debug');
    expect(config.logger.prettyPrint).toBe(true);
    expect(config.tracing.enabled).toBe(true);
    expect(config.tracing.exporter.type).toBe('console');
    expect(config.tracing.sampling.ratio).toBe(1);
    expect(config.metrics.enabled).toBe(true);
    expect(config.metrics.endpoint).toBe('/metrics');
    expect(config.health.enabled).toBe(true);
    expect(config.instrumentations).toEqual([]);
  });

  it('should use production defaults when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';

    const config = resolveConfig({ serviceName: 'prod-service' });

    expect(config.environment).toBe('production');
    expect(config.logger.level).toBe('info');
    expect(config.logger.prettyPrint).toBe(false);
    expect(config.tracing.exporter.type).toBe('otlp-http');
    expect(config.tracing.sampling.ratio).toBe(0.1);
  });

  it('should override defaults with explicit config', () => {
    const config = resolveConfig({
      serviceName: 'custom-service',
      environment: 'staging',
      version: '2.0.0',
      logger: { level: 'warn', prettyPrint: false },
      tracing: {
        enabled: false,
        sampling: { type: 'probabilistic', ratio: 0.5 },
      },
      metrics: { enabled: false, prefix: 'custom' },
    });

    expect(config.environment).toBe('staging');
    expect(config.version).toBe('2.0.0');
    expect(config.logger.level).toBe('warn');
    expect(config.logger.prettyPrint).toBe(false);
    expect(config.tracing.enabled).toBe(false);
    expect(config.tracing.sampling.ratio).toBe(0.5);
    expect(config.metrics.enabled).toBe(false);
    expect(config.metrics.prefix).toBe('custom');
  });

  it('should use OTEL_EXPORTER_OTLP_ENDPOINT env var', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';

    const config = resolveConfig({ serviceName: 'test' });

    expect(config.tracing.exporter.endpoint).toBe('http://collector:4318');
  });

  it('should merge redaction paths from config', () => {
    const config = resolveConfig({
      serviceName: 'test',
      redaction: { paths: ['*.custom_secret'], censor: '***' },
    });

    expect(config.redaction.paths).toContain('*.custom_secret');
    expect(config.redaction.censor).toBe('***');
  });

  it('should set default metric labels', () => {
    const config = resolveConfig({
      serviceName: 'test',
      metrics: { labels: { team: 'platform' } },
    });

    expect(config.metrics.labels).toEqual({
      service: 'test',
      environment: 'test',
      team: 'platform',
    });
  });
});
