# Architecture Decisions

This document records the key decisions behind the `@brdrwanda/observability` SDK — what we chose, what we rejected, and why.

---

## ADR-1: Single SDK package instead of multi-package monorepo

**Decision:** Ship one npm package (`@brdrwanda/observability`) containing logging, tracing, and metrics.

**Alternatives considered:**
- `@brdrwanda/observability-core` + `@brdrwanda/observability-logger` + `@brdrwanda/observability-tracing` + `@brdrwanda/observability-metrics`

**Why single package:**
- Services install one package, import from one place
- No cross-package version coordination (logger v1.2 + tracing v1.1 = untested combination)
- Instrumentations that aren't registered never initialize — same isolation benefit without the packaging overhead
- Simpler CI/CD: one build, one version, one changelog

**Trade-off:** Larger install size (~12MB total). Acceptable because services already ship hundreds of MB in node_modules.

---

## ADR-2: Pino over Winston

**Decision:** Use Pino as the structured JSON logger.

**Why Pino:**
- 5x faster than Winston in benchmarks (critical for high-throughput services)
- JSON-native — no serialization overhead
- Built-in redaction (path-based, configurable)
- `mixin` function injects context at serialization time (not at call time) — zero overhead when log level is below threshold
- Async transports via worker threads (pino v9)

**Why not Winston:**
- Winston was already in use across services but with inconsistent configuration
- Winston's `createLogger` + `transports` pattern requires more boilerplate
- Winston's JSON output needs manual formatting to match structured logging requirements
- Kafka transport in Winston adds coupling — SDK sends to stdout, infrastructure handles delivery

**Migration impact:** All `handleInfoLog`/`handleWarnLog`/`handlErrorLog` calls replaced with `logger.info()`/`logger.warn()`/`logger.error()`.

---

## ADR-3: AsyncLocalStorage for request context

**Decision:** Use Node.js native `AsyncLocalStorage` to propagate request context (requestId, correlationId, traceId, spanId).

**What it replaces:**
- `createLoggingContextWithId(traceId, spanId, context, ...)` — a utility that built context objects manually, requiring traceId/spanId to be passed through every function signature
- Manual `@Trace()` and `@Span()` decorator params in controller methods

**Why AsyncLocalStorage:**
- Native Node.js API (no dependencies)
- Context flows automatically through async boundaries (await, callbacks, timers)
- Developers never pass traceId/spanId manually — inject `ObservabilityLogger`, call `.info()`, context is there
- Works with any async pattern: Promises, callbacks, event emitters

**What this means for developers:**
```typescript
// Before: manual context threading
async doWork(traceId: string, spanId: string) {
  const context = createLoggingContextWithId(traceId, spanId, 'doWork', ...);
  this.logger.handleInfoLog('doing work', context);
}

// After: automatic context
async doWork() {
  this.logger.info('doing work');
  // trace_id, span_id, request_id — all injected automatically
}
```

---

## ADR-4: SDK-managed exception filter instead of custom HttpExceptionFilter

**Decision:** The SDK registers its own `ObservabilityExceptionFilter` via `APP_FILTER`. Services must remove their custom exception filters.

**What the old pattern looked like:**
- Each service had `src/filters/http.exception.filter.ts`
- Registered via `app.useGlobalFilters(new HttpExceptionFilter())` in main.ts or `{ provide: APP_FILTER, useClass: HttpExceptionFilter }` in app.module.ts
- The custom filter used `LoggerService` to log errors to Kafka

**Why SDK-managed:**
- Consistent error classification across all services (401=`authentication_failed`, 400+validation=`validation_failed`, 500=`server_error`)
- Automatic trace context on error logs (traceId, spanId linked to the failing request)
- Proper log levels (4xx=warn, 5xx=error with stack trace)
- One implementation to maintain instead of 11 copies

**What the SDK filter returns to the client:**
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "timestamp": "2026-06-25T10:00:00.000Z",
  "requestId": "req-abc-123",
  "traceId": "trace-def-456"
}
```

Same `statusCode` + `message` as the old filter, plus debugging fields (`requestId`, `traceId`).

**For caught errors (try/catch):** Use `this.logger.logCaughtError(error)` — a built-in method on `ObservabilityLogger` that extracts status/message, picks the right log level, and includes stack traces for 5xx.

---

## ADR-5: stdout/stderr for log delivery, not Kafka

**Decision:** SDK writes structured JSON to stdout. Log delivery to Loki/ELK is handled by infrastructure (Promtail, FluentBit, Vector), not application code.

**What the old pattern looked like:**
- `LoggerService` sent logs to both Winston (console) and Kafka (`loggingClient.emit()`)
- Each service injected `ClientKafka` into the logger
- Logger depended on Kafka broker being available

**Why stdout:**
- Decouples application from delivery infrastructure
- No Kafka dependency in the logger — one fewer failure mode
- Standard 12-factor app pattern: application produces, infrastructure ships
- Works with any collector: Promtail, FluentBit, Vector, CloudWatch agent
- Simplifies testing — logs are just stdout, no Kafka mock needed

**Infrastructure requirement:** Services must pipe stdout to a location where Promtail/FluentBit can read it. For PM2: `pm2 start dist/main.js --log /tmp/observability-logs/service.log`. For Docker: stdout goes to container logs automatically.

---

## ADR-6: OpenTelemetry for tracing with W3C propagation

**Decision:** Use OpenTelemetry SDK with W3C TraceContext (`traceparent` header) for distributed tracing.

**Why OpenTelemetry:**
- Vendor-neutral — export to Tempo, Jaeger, Zipkin, Datadog, or any OTLP-compatible backend
- W3C TraceContext is the industry standard for HTTP propagation
- Auto-instrumentation for HTTP, Kafka, database drivers
- Parent-based sampling respects upstream decisions

**Why not custom tracing (x-trace-id headers):**
- Services already pass `x-trace-id` in headers, but each service generates its own — no true end-to-end tracing
- No span hierarchy (parent-child relationships)
- No sampling control
- No integration with Grafana Tempo for trace visualization

**Coexistence:** The SDK's `TracingInterceptor` extracts `traceparent` if present. Services can continue sending `x-trace-id` for backwards compatibility, but `traceparent` is the source of truth.

---

## ADR-7: Driver-level database instrumentation, not ORM-level

**Decision:** Instrument at the database driver level (`mysql2`, `pg`, `tedious`) rather than the ORM level (Sequelize).

**Why driver-level:**
- All ORMs use the same underlying driver — instrumenting once covers Sequelize, TypeORM, Prisma, Drizzle, Knex, and raw queries
- ORM switch (e.g., Sequelize → Drizzle) requires zero SDK changes
- OTel community maintains driver instrumentations — battle-tested, low maintenance burden

**Sequelize-specific addition:** `createSequelizeLogging()` provides structured query logging on top of driver instrumentation. This is optional convenience, not the primary instrumentation.

---

## ADR-8: Prometheus client-side metrics, not StatsD/push

**Decision:** Use `prom-client` with a `/metrics` endpoint that Prometheus scrapes.

**Why pull-based (Prometheus scrape):**
- No push infrastructure needed (no StatsD server, no Graphite)
- Prometheus already deployed in BRD infrastructure
- `/metrics` endpoint is a health signal itself — if the endpoint is down, Prometheus alerts
- Exemplars link metrics to traces (click histogram dot → jump to trace in Tempo)

**Built-in metrics:**
- `http_requests_total` (counter) with `method`, `route`, `status_code` labels
- `http_request_duration_seconds` (histogram) with exemplars
- Node.js process metrics (event loop lag, memory, CPU)

---

## ADR-9: logCaughtError as a built-in method, not a helper function

**Decision:** Add `logCaughtError(error)` as a method on `ObservabilityLogger` rather than documenting a helper function pattern.

**What the old pattern was:**
- Each controller copy-pasted a `private logCaughtError()` helper
- Or worse, each catch block had inline error logging with inconsistent format

**Why built-in:**
- One implementation, tested once, used everywhere
- Consistent event name (`request_error`), consistent severity routing
- Extracts status from NestJS `HttpException.getStatus()`, `error.statusCode`, or defaults to 500
- Extracts message from `error.response.message`, `error.message`, or defaults to `'Unknown error'`
- Stack trace included only for 5xx (avoids noise from expected 4xx errors)
- No helper function, no utility file, no import — it's on the logger you already have

```typescript
catch (error) {
  this.logger.logCaughtError(error);
  return ResponseCommon.handleError(error?.getStatus() || 500, error?.message, res);
}
```
