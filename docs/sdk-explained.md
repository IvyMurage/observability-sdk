# Observability SDK — Code Translated to Plain English

This document explains every module and file in the SDK, translating the code into plain language so anyone can understand what it does and why.

---

## The Big Picture

This SDK is a toolkit that you plug into any NestJS service. Once plugged in, it automatically:

1. Writes structured log entries (JSON) to stdout with trace IDs, request IDs, and service info baked in
2. Creates distributed traces so you can follow a request as it hops between services
3. Exposes performance metrics (request count, duration, errors) that Prometheus can scrape
4. Redacts sensitive data (passwords, tokens, API keys) so they never appear in logs or traces
5. Propagates request context through async operations so every log line and span knows which request it belongs to

The developer's job is one line of config. The SDK handles the rest.

---

## Module-by-Module Breakdown

---

### 1. Core — The Foundation

#### `core/types.ts` — The Blueprint

This file defines the shape of everything. It doesn't do anything — it just describes what things look like.

- **ObservabilityConfig**: The object you pass to `ObservabilityModule.forRoot()`. It says: "My service is called X, I want logging at this level, tracing sent to this endpoint, metrics with this prefix, and these instrumentations enabled."

- **ResolvedConfig**: The "filled in" version of the above. If you didn't specify a log level, it fills in the default. If you didn't specify a tracing endpoint, it fills in `localhost:4318`. Every field is guaranteed to have a value — no more "maybe undefined."

- **RequestContext**: The identity card of a single request. Every request gets one. It carries: a unique request ID, a correlation ID (for tracking across services), trace and span IDs (from OpenTelemetry), the service name, environment, and version. This context follows the request everywhere — into logs, into traces, across async boundaries.

- **InstrumentationPlugin**: The contract for add-on monitoring. If you want to monitor Redis, Kafka, or MySQL, you create a plugin that matches this shape. It has a name, optionally returns an OpenTelemetry instrumentation object, and optionally has init/shutdown lifecycle hooks.

#### `core/constants.ts` — Name Tags for Dependency Injection

NestJS uses dependency injection — you ask for things by name, and the framework gives them to you. This file creates four unique symbols (like unique name tags) so NestJS knows what you're asking for:

- `OBSERVABILITY_CONFIG` — "give me the resolved configuration"
- `OBSERVABILITY_LOGGER` — "give me the logger"
- `OBSERVABILITY_TRACER` — "give me the tracer"
- `OBSERVABILITY_METRICS` — "give me the metrics service"

Symbols are used instead of strings because two strings can accidentally be the same. Two symbols are always unique.

#### `core/config.ts` — The Smart Defaults Engine

This file takes the partial config you provide and fills in everything you didn't specify with sensible defaults.

How it decides defaults:

- **Environment**: Uses your explicit value, then falls back to `NODE_ENV` env var, then falls back to `"development"`.
- **Is it production?** If environment is `"production"`, it flips several defaults:
  - Log level: `info` (not `debug` — less noise in prod)
  - Pretty printing: off (JSON only — machines read prod logs)
  - Trace exporter: `otlp-http` (send to collector, not console)
  - Sampling ratio: 10% (don't trace every request — too expensive in prod)
- **Tracing endpoint**: Checks the standard OpenTelemetry env var `OTEL_EXPORTER_OTLP_ENDPOINT` first, then falls back to `localhost:4318`.
- **Metrics labels**: Automatically adds `service` and `environment` labels to all metrics so you can filter dashboards by service.
- **Redaction paths**: Uses your custom paths if provided, otherwise uses the built-in list of sensitive field patterns.

The result is a fully-resolved config where nothing is undefined. Every downstream module can trust that all values exist.

#### `core/context.ts` — The Request Identity System

This is the mechanism that lets every log line and every trace span know "I belong to request X."

**How it works:**

It uses Node.js's `AsyncLocalStorage` — a built-in feature that lets you store data that automatically follows async operations. Think of it as a invisible backpack attached to each request. Whenever code runs as part of that request (even through `await`, `setTimeout`, or Promise chains), the backpack comes along.

- **`createRequestContext()`**: Creates a new identity card for a request. Generates a UUID for the request ID, checks if OpenTelemetry has an active trace span (to grab the trace ID), and bundles everything together.

- **`runWithContext(ctx, fn)`**: Runs a function with the identity card attached. Everything that function calls (and everything those calls call, etc.) can access the identity card.

- **`getContext()`**: Reads the identity card from the invisible backpack. If you're outside a request (like during startup), it returns undefined.

- **`enrichContextFromSpan()`**: After OpenTelemetry creates a trace span, this copies the trace ID and span ID into the request context so logs can include them.

---

### 2. Security — The Censor

#### `security/redaction.ts` — Sensitive Data Protection

This file does two things:

**1. Defines what's sensitive.** The `DEFAULT_REDACTION_PATHS` list tells Pino (the logger): "If you see any of these field patterns in a log entry, replace the value with `[REDACTED]`." The patterns use wildcards:
- `*.password` means "any object, at any depth, with a field called password"
- `req.headers.authorization` means "specifically the authorization header on request objects"

The list covers: passwords, tokens (access, refresh, API keys), connection strings, credit cards, SSNs, and auth headers.

**2. Sanitizes HTTP headers.** The `sanitizeHeaders()` function takes a set of HTTP headers and replaces the values of known-sensitive headers (Authorization, Cookie, API keys) with `[REDACTED]`. This is used when logging request/response headers or adding them to trace spans.

---

### 3. Logger — The Structured Log Writer

#### `logger/logger.service.ts` — The Main Logger

This wraps Pino (the fastest Node.js JSON logger) and adds automatic context injection.

**Setup (constructor):**
- Creates a Pino instance configured with the service name, log level, and redaction rules.
- Registers standard serializers for requests, responses, and errors (Pino knows how to extract the useful parts).
- Registers a **mixin function** — this is the key magic. Every time Pino writes a log line, it calls the mixin to get extra fields. The mixin reads the current request context (from AsyncLocalStorage) and the current trace span (from OpenTelemetry) and returns them. This means every log line automatically includes `service_name`, `environment`, `version`, `request_id`, `correlation_id`, `trace_id`, and `span_id` — without the developer doing anything.
- In development: uses `pino-pretty` for human-readable colored output.
- In production: writes raw JSON to stdout.

**Log methods (debug, info, warn, error, fatal):**
Each one calls the corresponding Pino method. The metadata object (second argument) is merged with the mixin fields. So `logger.info('order created', { orderId: '123' })` produces a JSON line with the message, the orderId, AND all the context fields.

**Child loggers:**
`child({ component: 'auth' })` creates a new logger that inherits everything but adds `component: 'auth'` to every log line. Useful for tagging logs from a specific part of the code.

#### `logger/nest-logger.ts` — The NestJS Bridge

NestJS has its own logger interface (`LoggerService`) with methods like `log()`, `error()`, `warn()`. This class implements that interface and forwards everything to our Pino-based logger.

This means when NestJS itself writes internal log messages (like "Nest application successfully started"), those messages go through our logger and get the same structured JSON format with the same context fields.

The `extractMeta()` helper handles NestJS's quirky calling convention — sometimes the last argument is a string (the "context" like "MyController"), sometimes it's an object, sometimes it's an Error.

---

### 4. Tracing — The Distributed Trace System

#### `tracing/tracing.init.ts` — The Trace Engine Startup

This file initializes OpenTelemetry's tracing system. It runs once, before the app starts handling requests.

**What it does:**

1. **Creates a Resource** — tells OpenTelemetry "I am service X, version Y, running in environment Z." This metadata appears on every trace span.

2. **Creates a TracerProvider** — the central object that manages trace spans. Configured with the resource and a sampler (which decides if a given request should be traced or skipped).

3. **Creates an Exporter** — decides where trace data goes:
   - `otlp-http`: Sends traces to an OpenTelemetry Collector via HTTP (production)
   - `otlp-grpc`: Same but over gRPC (optional, needs extra package)
   - `console`: Prints traces to stdout (development/debugging)
   - `none`: Discards traces (testing)

4. **Creates a SpanProcessor** — sits between span creation and export:
   - Development: `SimpleSpanProcessor` — exports each span immediately (good for debugging)
   - Production: `BatchSpanProcessor` — buffers up to 512 spans and flushes every 5 seconds (much more efficient)

5. **Registers the provider globally** — after this, any code calling `trace.getTracer()` from the OpenTelemetry API gets a working tracer.

6. **Registers instrumentations** — collects all OTel instrumentation objects from the plugins the user registered (HTTP, Redis, etc.) and activates them. These instrumentations monkey-patch libraries to automatically create spans.

**Idempotency:** The `provider` variable and `initialized` flag ensure this only runs once, even if `forRoot()` is called multiple times.

**Shutdown:** `shutdownTracing()` flushes any buffered spans and cleans up. Called when the NestJS app shuts down.

#### `tracing/tracer.service.ts` — The Span Creator

This is the developer-facing API for creating custom trace spans.

- **`startActiveSpan(name, fn)`**: Creates a new span, runs your function inside it, and automatically:
  - Marks the span as OK if the function succeeds
  - Marks the span as ERROR and records the exception if the function throws
  - Ends the span when the function completes (success or failure)

  Example: `tracer.startActiveSpan('calculate-credit-score', async (span) => { ... })` creates a span called "calculate-credit-score" that wraps whatever business logic you put inside.

- **`getActiveSpan()`**: Returns the currently-active span (if any). Useful for adding custom attributes to an existing span.

- **`getTracer()`**: Returns the raw OpenTelemetry Tracer object for advanced use cases.

#### `tracing/sampling.ts` — The Traffic Controller

Not every request needs to be traced (especially in high-traffic production). This file creates a sampler that decides which requests get traced:

- **`always`**: Trace every single request. Good for development.
- **`never`**: Trace nothing. Good for testing.
- **`probabilistic`**: Trace X% of requests randomly. Example: ratio 0.1 = trace 10%.
- **`parent-based`**: If an incoming request already has a trace (from an upstream service), continue it. If it's a new request with no parent trace, use the probabilistic ratio to decide. This is the default because it keeps distributed traces complete — if the gateway traces a request, all downstream services trace it too.

---

### 5. Metrics — The Performance Counter

#### `metrics/metrics.service.ts` — The Metric Registry

This wraps `prom-client` (the standard Prometheus metrics library for Node.js).

**Setup:**
- Creates a fresh metric registry (isolated from any global metrics).
- Sets default labels (service name, environment, plus any custom labels). These appear on every metric automatically.
- If `defaultMetrics` is enabled, registers Node.js process metrics: CPU usage, memory usage, event loop lag, open file handles, etc.

**Creating metrics:**
- **Counter** (`createCounter`): A number that only goes up. Example: total number of requests served. You call `counter.inc()` each time an event happens.
- **Histogram** (`createHistogram`): Measures the distribution of values. Example: request duration. You call `histogram.observe(0.123)` with each measurement. Prometheus can then show percentiles (p50, p95, p99). Default buckets are tuned for HTTP latency (5ms to 10s).
- **Gauge** (`createGauge`): A number that goes up and down. Example: currently active connections. You call `gauge.set(10)`, `gauge.inc()`, `gauge.dec()`.

**Serving metrics:**
`getMetrics()` returns all registered metrics in Prometheus text format — the format Prometheus expects when it scrapes the `/metrics` endpoint.

#### `metrics/metrics.controller.ts` — The /metrics Endpoint

A simple NestJS controller that serves `GET /metrics`. When Prometheus scrapes this endpoint, it gets all the registered metrics in the correct text format with the correct content type header.

---

### 6. NestJS Integration — The Glue Layer

#### `nestjs/observability.module.ts` — The Main Entry Point

This is the single module developers import. `ObservabilityModule.forRoot(config)` wires everything together.

**What `forRoot()` does:**

1. **Resolves config** — fills in defaults for anything not specified.
2. **Initializes tracing** — starts the OpenTelemetry trace provider (only once).
3. **Initializes plugins** — calls `init()` on each instrumentation plugin.
4. **Registers providers** — makes the logger, tracer, and metrics service available for injection throughout the app:
   - Each service is created as a singleton (one instance, shared everywhere).
   - Registered both by Symbol token (e.g., `OBSERVABILITY_LOGGER`) and by class (e.g., `ObservabilityLogger`) so developers can inject using either style.
5. **Registers the NestJS logger adapter** — so NestJS internal logs go through Pino.
6. **Registers the context middleware** — runs on every request to set up AsyncLocalStorage context.
7. **Registers interceptors globally** — logging interceptor and tracing interceptor run on every request automatically.
8. **Registers the exception filter** — catches unhandled errors globally.
9. **Conditionally adds the metrics controller** — if metrics are enabled, adds the `/metrics` endpoint.
10. **Marks the module as global** — so other modules don't need to import it explicitly.

**Shutdown (`onModuleDestroy`):**
When the app shuts down, it flushes pending traces, shuts down each plugin, and resets the initialization flag.

#### `nestjs/context.middleware.ts` — The Request Context Setup

This middleware runs before every HTTP request handler. Its job:

1. **Extract IDs from headers**: If the incoming request has `x-request-id` or `x-correlation-id` headers (set by an upstream service or API gateway), use those. Otherwise, generate new UUIDs.
2. **Create request context**: Build the identity card for this request.
3. **Run the rest of the request inside AsyncLocalStorage**: Everything downstream (controllers, services, database calls) can now call `getContext()` to get the request's identity card.
4. **Enrich from span**: If OpenTelemetry already created a trace span for this request (from the HTTP instrumentation), copy the trace ID into the context.

#### `nestjs/logging.interceptor.ts` — The Request Logger

This interceptor runs around every HTTP handler. It:

1. Logs `"request started"` with method and URL when the request arrives.
2. Starts a timer.
3. Lets the handler run.
4. When the handler completes: logs `"request completed"` with method, URL, status code, and duration in milliseconds.
5. If the handler throws: logs `"request failed"` with the error message and duration.

Because the logger automatically includes context fields (via the mixin), these log lines include trace_id, request_id, etc. without the interceptor needing to pass them explicitly.

#### `nestjs/tracing.interceptor.ts` — The Span Creator for Handlers

This interceptor creates an OpenTelemetry span for every NestJS handler method. The span:

- Is named `ControllerName.methodName` (e.g., `OrderController.findAll`).
- Has attributes for the controller name, handler name, context type, HTTP method, and URL.
- Is marked OK when the handler succeeds (with status code recorded).
- Is marked ERROR when the handler throws (with the exception recorded).
- Ends when the handler completes.

This gives you a span for every controller method without writing any tracing code.

#### `nestjs/exception.filter.ts` — The Error Safety Net

This catch-all exception filter handles any unhandled error in the app:

1. **Determines the HTTP status**: If it's an NestJS `HttpException`, uses its status code. Otherwise, 500.
2. **Logs the error**: Writes a structured error log with the message, status code, HTTP method, URL, and stack trace.
3. **Records on trace span**: If there's an active trace span, marks it as ERROR and records the exception. This makes errors visible in your trace viewer (Tempo/Jaeger).
4. **Returns a clean error response**: Sends JSON with status code, message, timestamp, request ID, and trace ID. Including the trace ID in error responses lets developers search for the exact trace when debugging.

#### `nestjs/span.decorator.ts` — The @Span Decorator

A TypeScript decorator you put on service methods to wrap them in a trace span:

```typescript
@Span('calculate-score')
async calculateScore(userId: string) {
  // This method is now wrapped in a span called "calculate-score"
}
```

How it works: It replaces the original method with a wrapper that creates an OpenTelemetry span, runs the original method inside it, and handles success/error/cleanup. Works with both sync and async methods.

---

### 7. Instrumentations — The Library Monitors

Each instrumentation is a factory function that returns a plugin object. The pattern is the same for all:

#### `instrumentations/http.ts` — HTTP Monitoring (Bundled)

Returns an OpenTelemetry HTTP instrumentation that monkey-patches Node's `http` and `https` modules. This means every HTTP request your app makes (outbound) or receives (inbound) automatically gets a trace span — no code changes needed.

Options let you ignore certain paths (like `/health` and `/metrics` — you don't need traces for health checks).

This is the only instrumentation bundled as a direct dependency because almost every service makes HTTP calls.

#### `instrumentations/kafka.ts` — Kafka Monitoring

Two parts:

1. **Auto-instrumentation**: Tries to load `@opentelemetry/instrumentation-kafkajs`. If installed, it monkey-patches kafkajs to automatically propagate trace context through message headers. If not installed, returns null (no crash).

2. **Manual helpers**:
   - `injectKafkaHeaders()`: When producing a message, call this to inject the current trace context into the message headers. The consumer on the other end can extract it.
   - `withKafkaContext(headers, spanName, fn)`: When consuming a message, call this to extract trace context from the message headers and run your handler inside that context. This connects the consumer's spans to the producer's trace.

#### `instrumentations/redis.ts`, `mysql.ts`, `pg.ts` — Database/Cache Monitoring

All follow the same pattern:
1. Try to `require()` the corresponding OpenTelemetry instrumentation package.
2. If found, return an instance that will monkey-patch the database driver to create spans for every query/command.
3. If not found, log a debug hint about which package to install and return null.

Key design: these instrument at the **driver level** (mysql2, pg, ioredis), not the ORM level. So if you switch from Sequelize to Prisma or Drizzle, the instrumentation keeps working because all ORMs use the same underlying driver.

---

### 8. Health — The Liveness Probes

#### `health/health.controller.ts` and `health/health.module.ts`

Three endpoints for container orchestrators and load balancers:

- **`GET /health`**: Returns service name, environment, version, uptime, and timestamp. For human operators and dashboards.
- **`GET /health/ready`**: Returns `{ status: 'ok' }`. Tells Kubernetes "this pod is ready to receive traffic." (In a more advanced setup, this would check database connections, cache connectivity, etc.)
- **`GET /health/live`**: Returns `{ status: 'ok' }`. Tells Kubernetes "this pod is alive and not stuck." If this fails, Kubernetes restarts the pod.

The health module is separate and optional — you import `ObservabilityHealthModule` alongside `ObservabilityModule` if you want these endpoints.

---

### 9. Diagnostics — SDK Self-Reporting

#### `diagnostics/diagnostics.service.ts`

Reports the status of the observability SDK itself. Returns:
- SDK version
- Service name and environment
- Whether tracing is enabled and which exporter is configured
- Whether metrics are enabled
- Which instrumentations are loaded
- Node.js version
- Uptime

This lets operators answer "is observability actually working in this service?" without digging through code.

---

### 10. Index — The Public API

#### `index.ts`

This file decides what consumers can import from `@company/observability`. It re-exports exactly what's needed and nothing more:

- The two NestJS modules (observability + health)
- All TypeScript types (for type-safe config)
- The injection tokens (for custom injection)
- Context functions (for reading/creating request context manually)
- Logger and tracer classes (for injection into services)
- The @Span decorator
- Metrics service
- All instrumentation factory functions
- Kafka helper functions
- Security utilities

Everything else (internal implementations, middleware, interceptors, filters) stays internal.

---

## How It All Flows Together

### Request Lifecycle (what happens when `GET /users/42` hits your service):

```
1. HTTP request arrives at the NestJS server

2. OpenTelemetry HTTP instrumentation (monkey-patched http module)
   creates a root span: "HTTP GET /users/42"

3. Context Middleware runs:
   - Extracts x-request-id and x-correlation-id from headers
     (or generates new UUIDs)
   - Creates a RequestContext object
   - Stores it in AsyncLocalStorage
   - Copies trace_id from the OTel span into the context

4. Logging Interceptor runs:
   - Logs: {"level":"info", "msg":"request started", "method":"GET",
     "url":"/users/42", "trace_id":"abc123", "request_id":"req-456"}
   - Starts a timer

5. Tracing Interceptor runs:
   - Creates a child span: "AppController.getUser"
   - Adds attributes: http.method, http.url, nestjs.controller, etc.

6. Your controller method runs:
   - You call logger.info('fetching user', { userId: '42' })
   - The logger's mixin automatically adds trace_id, request_id,
     service_name, etc. to the log line
   - If you have @Span('get-user') on the service method,
     another child span is created

7. If your method calls a MySQL database:
   - The MySQL instrumentation (monkey-patched mysql2 driver)
     automatically creates a span: "db.query SELECT * FROM users"
   - The span includes the SQL statement, database name, duration

8. Your method returns the result

9. Tracing Interceptor completes:
   - Marks span "AppController.getUser" as OK
   - Records http.status_code = 200
   - Ends the span

10. Logging Interceptor completes:
    - Logs: {"level":"info", "msg":"request completed", "method":"GET",
      "url":"/users/42", "statusCode":200, "duration_ms":4.23,
      "trace_id":"abc123", "request_id":"req-456"}

11. HTTP instrumentation completes:
    - Ends root span "HTTP GET /users/42"

12. BatchSpanProcessor buffers the spans
    - Every 5 seconds (or when 512 spans accumulate),
      sends them to the OTel Collector

13. Response sent to client
```

### If an error occurs (at any step):

```
- Exception Filter catches it
- Logs the error with full context (trace_id, request_id, stack trace)
- Marks the active trace span as ERROR
- Records the exception on the span
- Returns JSON error response with requestId and traceId
  (so the developer can search for the exact trace in Grafana)
```

### Cross-service trace propagation:

```
Service A (API Gateway)                Service B (Order Service)
+-----------------------+              +-----------------------+
| Receives request      |              |                       |
| OTel creates span     |              |                       |
| trace_id: abc123      |              |                       |
|                       |   HTTP call  |                       |
| Makes HTTP request ---|--------------| OTel HTTP instr.      |
| OTel auto-injects     |  (traceparent| extracts traceparent  |
| traceparent header    |   header)    | Continues same trace  |
|                       |              | trace_id: abc123      |
|                       |              | (same trace!)         |
+-----------------------+              +-----------------------+
```

The `traceparent` header propagation happens automatically via the HTTP instrumentation. No developer code needed. The gateway's span and the order service's span appear in the same trace in Grafana/Tempo.

---

## What the Developer Actually Writes

### Minimum viable setup (covers 90% of needs):

```typescript
// app.module.ts — 1 import, 1 config block
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  instrumentations: [httpInstrumentation()],
})

// main.ts — 1 line to replace NestJS logger
app.useLogger(app.get(NestPinoLogger));
```

That's it. Logs, traces, metrics, context propagation, error handling, and sensitive data redaction all work automatically.

### Optional additions:

```typescript
// Add custom spans for business logic
@Span('process-payment')
async processPayment(orderId: string) { ... }

// Use the logger with automatic context
this.logger.info('payment processed', { orderId, amount });

// Create custom metrics
const counter = this.metrics.createCounter('orders_total', 'Total orders', ['status']);
counter.inc({ status: 'completed' });

// Kafka: inject trace context into messages
await producer.send({
  topic: 'events',
  messages: [{ value: data, headers: injectKafkaHeaders() }],
});
```
