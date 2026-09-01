# Changelog

All notable changes to `@ivymurage/observability` are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-09-01

### Added

#### Outgoing HTTP Metrics (automatic)

Zero app code needed — hooks into existing `httpInstrumentation()` spans via OTEL SpanProcessor.

| Metric | Type | Labels |
|--------|------|--------|
| `{prefix}_outgoing_http_requests_total` | Counter | `target_host`, `method`, `status_code` |
| `{prefix}_outgoing_http_duration_seconds` | Histogram | `target_host`, `method`, `status_code` |

Answers: "Which downstream service is failing? Which is slow?"

**Exemplars** included — click a metric data point → jump to the exact trace.

#### DB Query Metrics (automatic)

Zero app code needed — observes DB spans from `sequelizeInstrumentation()`, `pgInstrumentation()`, or `mysqlInstrumentation()`.

| Metric | Type | Labels |
|--------|------|--------|
| `{prefix}_db_query_duration_seconds` | Histogram | `operation`, `table` |
| `{prefix}_db_query_errors_total` | Counter | `operation`, `table` |

Normalizes Sequelize ORM methods to standard SQL operations:
- `findAll`, `findOne`, `count` → `SELECT`
- `create`, `bulkCreate` → `INSERT`
- `destroy` → `DELETE`

Answers: "Is the database slow? Which table? Reads or writes?"

#### Cache Metrics (injectable service)

New `CacheMetricsService` — wrap your existing cache calls to track hit/miss rates and latency.

| Metric | Type | Labels |
|--------|------|--------|
| `{prefix}_cache_hits_total` | Counter | `operation` |
| `{prefix}_cache_misses_total` | Counter | `operation` |
| `{prefix}_cache_operation_duration_seconds` | Histogram | `operation`, `result` |

Usage:

```typescript
import { CacheMetricsService } from '@ivymurage/observability';

@Injectable()
export class MyService {
  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private cacheMetrics: CacheMetricsService,
  ) {}

  async getData(key: string) {
    // Before:  const cached = await this.cache.get(key);
    // After:
    const cached = await this.cacheMetrics.get(this.cache, key, 'my-operation');
    if (cached) return cached;

    const fresh = await this.fetchFromDb(key);
    await this.cacheMetrics.set(this.cache, key, fresh, 300, 'my-operation');
    return fresh;
  }
}
```

Answers: "Is caching working? What's the hit rate? Did cache go cold after deploy?"

#### Configuration

Two new options in `MetricsConfig` (both default `true`):

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  metrics: {
    httpClientMetrics: true,  // outgoing HTTP metrics (default: true)
    dbQueryMetrics: true,     // DB query metrics (default: true)
  },
  instrumentations: [
    httpInstrumentation(),
    sequelizeInstrumentation(),
  ],
});
```

Set `false` to opt out. `CacheMetricsService` is always opt-in via DI injection.

#### CORS Helper

New `createCorsOptions()` factory — ensures Prometheus scrapes, k8s probes, and health checks are never blocked by CORS middleware.

```typescript
import { createCorsOptions } from '@ivymurage/observability';

const whitelist = process.env.CORS_ORIGIN_WHITELIST?.split(';') ?? [];
app.enableCors(createCorsOptions(whitelist));
```

Replaces the manual `!origin` CORS fix that each service had to add individually. Uses `Set` for O(1) origin lookup.

### Architecture

All three capabilities follow the same pattern:

- **No new runtime dependencies** — uses existing `prom-client` and `@opentelemetry/api`
- **Low cardinality** — fixed label sets, no user IDs or URLs
- **Trace correlation** — all histograms include `trace_id` exemplars
- **Lazy binding** — SpanProcessors created during tracing init, Prometheus metrics bound after DI resolution via `bindOperationalMetrics()`
- **Graceful degradation** — if tracing disabled, span processors are no-op; if cache-manager not used, `CacheMetricsService` is never injected

### Storage Impact

~670 new time series per service → ~1.5 MB/day compressed in Prometheus. Negligible.

---

## [1.0.0] — 2026-08-15

### Initial Release

- `ObservabilityModule.forRoot()` — NestJS dynamic module
- `MetricsInterceptor` — auto HTTP request count + duration histogram
- `ContextMiddleware` — requestId, correlationId, traceId propagation
- `NestPinoLogger` — structured JSON logging
- `ObservabilityTracer` — distributed tracing with OTEL
- `ObservabilityMetrics` — Prometheus counter/histogram/gauge factories
- Health endpoint (`/health`) and metrics endpoint (`/metrics`)
- Instrumentations: `httpInstrumentation`, `kafkaInstrumentation`, `redisInstrumentation`, `sequelizeInstrumentation`, `mysqlInstrumentation`, `pgInstrumentation`
- `@Span()` decorator for custom tracing
- `setupProcessErrorHandlers()` for graceful crash logging
- Sensitive data redaction
- `DiagnosticsService` for runtime health checks
