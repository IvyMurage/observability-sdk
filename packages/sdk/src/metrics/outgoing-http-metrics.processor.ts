import { SpanKind } from '@opentelemetry/api';
import type { SpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import type { Counter, Histogram } from 'prom-client';
import type { ObservabilityMetrics } from './metrics.service';

/**
 * SpanProcessor that observes completed outgoing HTTP spans
 * and records Prometheus metrics (counter + histogram with exemplars).
 *
 * Created during tracing init (before metrics exist).
 * Call `setMetrics()` once ObservabilityMetrics is ready.
 * Until then, spans are silently ignored.
 */
export class OutgoingHttpMetricsProcessor implements SpanProcessor {
  private requestsTotal: Counter | null = null;
  private requestDuration: Histogram | null = null;

  /**
   * Bind Prometheus metrics. Called by the module after metrics init.
   */
  setMetrics(metrics: ObservabilityMetrics): void {
    this.requestsTotal = metrics.createCounter(
      'outgoing_http_requests_total',
      'Total outgoing HTTP requests',
      ['target_host', 'method', 'status_code'],
    );

    this.requestDuration = metrics.createHistogram(
      'outgoing_http_duration_seconds',
      'Outgoing HTTP request duration in seconds',
      ['target_host', 'method', 'status_code'],
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      true,
    );
  }

  onStart(_span: Span, _parentContext: Context): void {
    // no-op — we only care about completed spans
  }

  onEnd(span: ReadableSpan): void {
    if (!this.requestsTotal || !this.requestDuration) return;

    // Only process outgoing (client) HTTP spans
    if (span.kind !== SpanKind.CLIENT) return;

    const attrs = span.attributes;

    // Support both old and new OTEL semantic conventions
    const method = String(
      attrs['http.method'] || attrs['http.request.method'] || '',
    );
    if (!method) return; // not an HTTP span

    // Skip if this is a DB span (also SpanKind.CLIENT)
    if (attrs['db.system']) return;

    const statusCode = String(
      attrs['http.status_code'] || attrs['http.response.status_code'] || 'unknown',
    );

    const targetHost = this.extractTargetHost(attrs);
    if (!targetHost) return;

    // Calculate duration from span start/end time ([seconds, nanoseconds])
    const durationSec =
      span.endTime[0] - span.startTime[0] +
      (span.endTime[1] - span.startTime[1]) / 1e9;

    const labels = {
      target_host: targetHost,
      method,
      status_code: statusCode,
    };

    const traceId = span.spanContext().traceId;

    this.requestsTotal.inc(labels);
    this.requestDuration.observe({
      labels,
      value: durationSec,
      exemplarLabels: traceId ? { trace_id: traceId } : undefined,
    });
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  private extractTargetHost(attrs: Record<string, unknown>): string {
    // Prefer explicit host attributes
    const peerName = attrs['net.peer.name'] || attrs['server.address'];
    if (peerName) return String(peerName);

    // Fall back to parsing URL
    const url = String(attrs['http.url'] || attrs['url.full'] || '');
    if (!url) return '';

    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }
}
