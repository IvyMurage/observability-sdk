import { describe, it, expect, beforeEach } from 'vitest';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { OutgoingHttpMetricsProcessor } from '../../src/metrics/outgoing-http-metrics.processor';
import { DbMetricsProcessor } from '../../src/metrics/db-metrics.processor';
import { ObservabilityMetrics } from '../../src/metrics/metrics.service';
import { resolveConfig } from '../../src/core/config';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

function makeConfig(prefix = 'test') {
  return resolveConfig({
    serviceName: 'test-service',
    metrics: { prefix },
  });
}

function makeSpan(overrides: Partial<{
  kind: SpanKind;
  attributes: Record<string, unknown>;
  startTime: [number, number];
  endTime: [number, number];
  status: { code: number };
  traceId: string;
}>): ReadableSpan {
  return {
    kind: overrides.kind ?? SpanKind.CLIENT,
    attributes: overrides.attributes ?? {},
    startTime: overrides.startTime ?? [1000, 0],
    endTime: overrides.endTime ?? [1000, 250_000_000], // 250ms
    status: overrides.status ?? { code: SpanStatusCode.OK },
    spanContext: () => ({
      traceId: overrides.traceId ?? 'abc123',
      spanId: 'def456',
      traceFlags: 1,
    }),
    name: 'test-span',
    parentSpanId: undefined,
    resource: {} as any,
    instrumentationLibrary: { name: 'test' },
    events: [],
    links: [],
    duration: [0, 250_000_000],
    ended: true,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

describe('OutgoingHttpMetricsProcessor', () => {
  let processor: OutgoingHttpMetricsProcessor;
  let metrics: ObservabilityMetrics;

  beforeEach(() => {
    processor = new OutgoingHttpMetricsProcessor();
    metrics = new ObservabilityMetrics(makeConfig('outhttp'));
    processor.setMetrics(metrics);
  });

  it('should record metrics for outgoing HTTP spans', async () => {
    const span = makeSpan({
      kind: SpanKind.CLIENT,
      attributes: {
        'http.method': 'POST',
        'http.status_code': 200,
        'net.peer.name': 'auth-service.svc',
      },
    });

    processor.onEnd(span);

    const output = await metrics.getMetrics();
    expect(output).toContain('outhttp_outgoing_http_requests_total');
    expect(output).toContain('target_host="auth-service.svc"');
    expect(output).toContain('method="POST"');
    expect(output).toContain('status_code="200"');
    expect(output).toContain('outhttp_outgoing_http_duration_seconds');
  });

  it('should ignore non-client spans (server/internal)', async () => {
    const span = makeSpan({
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': 'GET',
        'http.status_code': 200,
        'net.peer.name': 'client',
      },
    });

    processor.onEnd(span);

    const output = await metrics.getMetrics();
    expect(output).not.toContain('outgoing_http_requests_total{');
  });

  it('should ignore DB spans (also client kind)', async () => {
    const span = makeSpan({
      kind: SpanKind.CLIENT,
      attributes: {
        'http.method': 'POST',
        'db.system': 'mssql',
        'net.peer.name': 'db.server',
      },
    });

    processor.onEnd(span);

    const output = await metrics.getMetrics();
    expect(output).not.toContain('outgoing_http_requests_total{');
  });

  it('should ignore spans without metrics bound', () => {
    const fresh = new OutgoingHttpMetricsProcessor();
    const span = makeSpan({
      attributes: { 'http.method': 'GET', 'net.peer.name': 'host' },
    });

    // Should not throw
    fresh.onEnd(span);
  });

  it('should extract host from URL when peer name not set', async () => {
    const span = makeSpan({
      kind: SpanKind.CLIENT,
      attributes: {
        'http.method': 'GET',
        'http.status_code': 200,
        'http.url': 'https://nida.gov.rw/api/verify',
      },
    });

    processor.onEnd(span);

    const output = await metrics.getMetrics();
    expect(output).toContain('target_host="nida.gov.rw"');
  });

  it('should support new OTEL semantic conventions', async () => {
    const span = makeSpan({
      kind: SpanKind.CLIENT,
      attributes: {
        'http.request.method': 'PUT',
        'http.response.status_code': 204,
        'server.address': 'config-service.svc',
      },
    });

    processor.onEnd(span);

    const output = await metrics.getMetrics();
    expect(output).toContain('method="PUT"');
    expect(output).toContain('status_code="204"');
    expect(output).toContain('target_host="config-service.svc"');
  });
});

describe('DbMetricsProcessor', () => {
  let processor: DbMetricsProcessor;
  let metrics: ObservabilityMetrics;

  beforeEach(() => {
    processor = new DbMetricsProcessor();
    metrics = new ObservabilityMetrics(makeConfig('dbtest'));
    processor.setMetrics(metrics);
  });

  it('should record metrics for DB query spans', async () => {
    const span = makeSpan({
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'mssql',
        'db.operation': 'SELECT',
        'db.sql.table': 'Users',
      },
    });

    processor.onEnd(span);

    const output = await metrics.getMetrics();
    expect(output).toContain('dbtest_db_query_duration_seconds');
    expect(output).toContain('operation="SELECT"');
    expect(output).toContain('table="Users"');
  });

  it('should normalize Sequelize ORM operations', async () => {
    const cases = [
      { input: 'findAll', expected: 'SELECT' },
      { input: 'findOne', expected: 'SELECT' },
      { input: 'create', expected: 'INSERT' },
      { input: 'bulkCreate', expected: 'INSERT' },
      { input: 'destroy', expected: 'DELETE' },
      { input: 'count', expected: 'SELECT' },
    ];

    for (const { input, expected } of cases) {
      const freshMetrics = new ObservabilityMetrics(makeConfig(`norm_${input}`));
      const freshProcessor = new DbMetricsProcessor();
      freshProcessor.setMetrics(freshMetrics);

      const span = makeSpan({
        kind: SpanKind.CLIENT,
        attributes: {
          'db.system': 'sequelize',
          'db.operation': input,
          'db.sql.table': 'TestTable',
        },
      });

      freshProcessor.onEnd(span);

      const output = await freshMetrics.getMetrics();
      expect(output).toContain(`operation="${expected}"`);
    }
  });

  it('should count error spans', async () => {
    const span = makeSpan({
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'mssql',
        'db.operation': 'INSERT',
        'db.sql.table': 'Users',
      },
      status: { code: 2 }, // SpanStatusCode.ERROR
    });

    processor.onEnd(span);

    const output = await metrics.getMetrics();
    expect(output).toContain('dbtest_db_query_errors_total');
    expect(output).toContain('operation="INSERT"');
  });

  it('should ignore non-DB spans', async () => {
    const span = makeSpan({
      kind: SpanKind.CLIENT,
      attributes: {
        'http.method': 'GET',
        'http.status_code': 200,
      },
    });

    processor.onEnd(span);

    const output = await metrics.getMetrics();
    expect(output).not.toContain('db_query_duration_seconds{');
  });

  it('should ignore spans without metrics bound', () => {
    const fresh = new DbMetricsProcessor();
    const span = makeSpan({
      attributes: { 'db.system': 'mssql', 'db.operation': 'SELECT' },
    });

    // Should not throw
    fresh.onEnd(span);
  });
});
