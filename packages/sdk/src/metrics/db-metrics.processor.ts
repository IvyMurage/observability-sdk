import { SpanKind } from '@opentelemetry/api';
import type { SpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import type { Counter, Histogram } from 'prom-client';
import type { ObservabilityMetrics } from './metrics.service';

/**
 * SpanProcessor that observes completed database spans
 * and records Prometheus metrics (histogram + error counter with exemplars).
 *
 * Works with any DB instrumentation that sets standard OTEL DB attributes:
 * - db.system (sequelize, mssql, pg, mysql, etc.)
 * - db.operation (SELECT, INSERT, UPDATE, DELETE)
 * - db.sql.table (table name)
 *
 * Created during tracing init (before metrics exist).
 * Call `setMetrics()` once ObservabilityMetrics is ready.
 */
export class DbMetricsProcessor implements SpanProcessor {
  private queryDuration: Histogram | null = null;
  private queryErrors: Counter | null = null;

  /**
   * Bind Prometheus metrics. Called by the module after metrics init.
   */
  setMetrics(metrics: ObservabilityMetrics): void {
    this.queryDuration = metrics.createHistogram(
      'db_query_duration_seconds',
      'Database query duration in seconds',
      ['operation', 'table'],
      [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      true,
    );

    this.queryErrors = metrics.createCounter(
      'db_query_errors_total',
      'Total database query errors',
      ['operation', 'table'],
    );
  }

  onStart(_span: Span, _parentContext: Context): void {
    // no-op
  }

  onEnd(span: ReadableSpan): void {
    if (!this.queryDuration || !this.queryErrors) return;

    // Only process client (outgoing) spans that are DB operations
    if (span.kind !== SpanKind.CLIENT) return;

    const attrs = span.attributes;

    // Check for DB system attribute — present in all DB instrumentations
    const dbSystem = attrs['db.system'];
    if (!dbSystem) return; // not a DB span

    const operation = this.normalizeOperation(
      String(attrs['db.operation'] || attrs['db.operation.name'] || 'unknown'),
    );

    const table = String(
      attrs['db.sql.table'] || attrs['db.collection.name'] || 'unknown',
    );

    // Calculate duration from span timing
    const durationSec =
      span.endTime[0] - span.startTime[0] +
      (span.endTime[1] - span.startTime[1]) / 1e9;

    const labels = { operation, table };
    const traceId = span.spanContext().traceId;

    this.queryDuration.observe({
      labels,
      value: durationSec,
      exemplarLabels: traceId ? { trace_id: traceId } : undefined,
    });

    // Count errors (span status code 2 = ERROR)
    if (span.status.code === 2) {
      this.queryErrors.inc(labels);
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Normalize SQL operations to a small set of labels.
   * Keeps cardinality low — only standard CRUD operations.
   */
  private normalizeOperation(raw: string): string {
    const upper = raw.toUpperCase().trim();
    switch (upper) {
      case 'SELECT':
      case 'INSERT':
      case 'UPDATE':
      case 'DELETE':
      case 'UPSERT':
        return upper;
      // Sequelize ORM methods → standard SQL operations
      case 'FINDALL':
      case 'FINDONE':
      case 'FINDBYID':
      case 'FINDORCREATE':
      case 'COUNT':
        return 'SELECT';
      case 'CREATE':
      case 'BULKCREATE':
        return 'INSERT';
      case 'DESTROY':
        return 'DELETE';
      default:
        return 'OTHER';
    }
  }
}
