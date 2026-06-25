# Internal Observability Platform SDK — Architecture

## Overview

Single-package observability SDK for distributed NestJS services. One install, one import, everything works.

Provides: structured logging, Prometheus metrics, distributed tracing, request context propagation, sensitive data redaction.

Design principles: pay-for-what-you-use, explicit over magic, driver-level DB instrumentation, zero vendor lock-in, simple + reliable.

---

## Repository Structure

```
observability-platform-sdk/
├── packages/
│   └── sdk/                               # @company/observability (single publishable package)
│       └── src/
│           ├── core/                      # Types, config, AsyncLocalStorage context, constants
│           ├── logger/                    # Pino logger + NestJS adapter
│           ├── tracing/                   # OTel tracer init, tracer service, sampling
│           ├── metrics/                   # prom-client wrapper, /metrics controller
│           ├── security/                  # Redaction paths, header sanitization
│           ├── nestjs/                    # Module, middleware, interceptors, filters, decorators
│           ├── instrumentations/          # HTTP, Kafka, Redis, MySQL, PG
│           ├── health/                    # Health/readiness/liveness controller + module
│           ├── diagnostics/              # SDK self-health reporting
│           └── index.ts                   # All exports
├── examples/
│   └── basic-nestjs/                      # Working example app
├── sandbox/
│   ├── docker-compose.yml                 # Grafana + Loki + Tempo + Prometheus + OTel Collector
│   ├── otel-collector/config.yaml
│   ├── prometheus.yml
│   ├── tempo.yaml
│   └── grafana/provisioning/
├── docs/
│   ├── architecture.md
│   ├── getting-started.md
│   └── adr/
├── package.json                           # Workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── .npmrc
```

### Why single package

Previous designs considered a multi-package monorepo (@obs/core, @obs/logger, etc). Rejected for simplicity:

- Consumer installs ONE package: `npm install @company/observability`
- ONE version to track
- ONE changelog
- No cross-package version coordination
- Instrumentations that aren't registered never initialize (same isolation benefit)
- Optional OTel instrumentation packages are peer deps — consumer installs only what they use

---

## Workspace Strategy

**Tooling:** pnpm workspaces + Turborepo

pnpm workspace exists for the SDK + examples. Turborepo orchestrates build/test/lint. Minimal config.

---

## Module Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Consumer Service                    │
├─────────────────────────────────────────────────────┤
│     ObservabilityModule.forRoot({ config })          │
│     ┌────────────┬───────────┬─────────────────┐    │
│     │ Logger     │ Tracer    │ Metrics         │    │
│     │ (Pino)     │ (OTel)    │ (prom-client)   │    │
│     └────────────┴───────────┴─────────────────┘    │
│     ┌────────────────────────────────────────────┐   │
│     │ Middleware  │ Interceptors │ Exception Filter│  │
│     │ (context)   │ (log+trace)  │ (error handling)│  │
│     └────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│   AsyncLocalStorage Context (requestId, correlationId│
│   traceId, spanId, serviceName)                      │
├─────────────────────────────────────────────────────┤
│   Instrumentations (loaded on demand):               │
│   httpInstrumentation() | kafkaInstrumentation()     │
│   redisInstrumentation() | mysqlInstrumentation()    │
│   pgInstrumentation()                                │
└─────────────────────────────────────────────────────┘
```

---

## Dependency Strategy

### Bundled (always installed)

| Dependency | Why | Overhead |
|---|---|---|
| `pino` v9 | Fastest Node logger, JSON-native, async transports | ~2MB, <1ms init |
| `prom-client` v15 | De facto Prometheus client | ~3MB, lazy metric init |
| `@opentelemetry/api` v1.x | Vendor-neutral tracing API | ~500KB |
| `@opentelemetry/sdk-trace-node` | Span creation + batch export | ~4MB |
| `@opentelemetry/exporter-trace-otlp-http` | OTLP HTTP export (lightweight) | ~1MB |
| `@opentelemetry/instrumentation-http` | HTTP auto-instrumentation | ~200KB |

### Peer dependencies (consumer provides)

| Dependency | Required |
|---|---|
| `@nestjs/common`, `@nestjs/core`, `rxjs` | Always |
| `ioredis`, `kafkajs`, `mysql2`, `pg` | Optional — only if using that instrumentation |
| `@opentelemetry/instrumentation-*` | Optional — only for Redis/Kafka/MySQL/PG tracing |

### Total SDK footprint

- Install: ~12MB
- Memory at idle: ~8MB
- Startup overhead: <50ms

### Rejected

| Dependency | Why |
|---|---|
| `winston` | 5x slower than Pino |
| `@opentelemetry/auto-instrumentations-node` | Loads ~40 instrumentations, massive startup cost |
| `cls-hooked` | Deprecated — AsyncLocalStorage is native |
| `@opentelemetry/sdk-node` | Bundles OTel metrics SDK we don't need |

---

## Database Instrumentation Strategy

**Instrument at driver level, not ORM level.**

| Instrumentation | Driver | Covers |
|---|---|---|
| `mysqlInstrumentation()` | `mysql2` | Sequelize, TypeORM, Prisma, Drizzle, Knex, raw mysql2 |
| `pgInstrumentation()` | `pg` | Sequelize, TypeORM, Prisma, Drizzle, Knex, raw pg |

ORMs change. Drivers don't. Switch from Sequelize to Drizzle → zero SDK changes.

---

## Instrumentation Loading

Explicit registration. No auto-discovery.

```typescript
ObservabilityModule.forRoot({
  serviceName: 'order-service',
  instrumentations: [
    httpInstrumentation(),
    mysqlInstrumentation(),
    // Redis NOT listed = NOT loaded = zero cost
  ],
})
```

Loading order:
1. `forRoot()` resolves config with defaults
2. OTel tracing provider initialized (synchronous, before NestJS providers)
3. OTel instrumentations registered via `registerInstrumentations()`
4. Custom plugins (Kafka helpers) initialized
5. NestJS middleware, interceptors, filters registered globally

Missing optional peer → debug log + skip. Never crash.

---

## Telemetry Pipeline

```
Application
  → stdout/stderr (Pino structured JSON)
  → log collector (FluentBit/Promtail/Vector)
  → Loki/ELK/OpenSearch → Grafana

Application
  → OTLP HTTP/gRPC
  → OpenTelemetry Collector
  → Tempo/Jaeger → Grafana

Application
  → /metrics endpoint (Prometheus format)
  → Prometheus scrape
  → Grafana
```

SDK emits telemetry. Infrastructure collects, stores, queries. Clean separation.

---

## Log Format

Every log entry:

```json
{
  "level": "info",
  "time": "2026-05-19T10:00:00.000Z",
  "service_name": "workflow-service",
  "environment": "production",
  "version": "1.2.3",
  "trace_id": "abc123def456",
  "span_id": "789ghi",
  "request_id": "req-uuid",
  "correlation_id": "corr-uuid",
  "msg": "order created",
  "orderId": "ord-123"
}
```

Context fields injected automatically via Pino mixin + AsyncLocalStorage. No manual enrichment needed.

---

## Security

| Concern | Mitigation |
|---|---|
| Credentials in logs | Pino redaction: `*.password`, `*.token`, `*.secret`, `req.headers.authorization`, etc. |
| Credentials in traces | `sanitizeHeaders()` strips Authorization, Cookie, API keys from span attributes |
| Log injection | Pino JSON serialization escapes by default |
| Metric endpoint | `/metrics` — deploy behind internal network or auth middleware |

Default redaction paths cover: passwords, tokens, API keys, connection strings, credit cards, SSNs. Extensible via config.

---

## Runtime Overhead

| Technique | Where |
|---|---|
| Single AsyncLocalStorage | Context — one ALS, not per-subsystem |
| Pino mixin (not per-log clone) | Logger — context fields injected at serialization time |
| BatchSpanProcessor (512 spans / 5s) | Tracing — amortized export cost |
| Lazy serialization | Logger — Pino skips work below log level threshold |
| Parent-based sampling (10% prod) | Tracing — reduces trace volume without losing correlated traces |
| prom-client lazy init | Metrics — metrics created on first use |

---

## Deployment

Works with:
- **Kubernetes**: sidecar OTel collector, stdout → log collector DaemonSet
- **Docker Compose**: direct OTLP to collector service
- **PM2 / bare-metal**: direct OTLP export, stdout to file → log shipper

No deployment-specific code. Exporter config + env vars handle transport differences.

---

## Future Extensibility

| Extension point | Mechanism |
|---|---|
| Custom instrumentations | `InstrumentationPlugin` interface |
| Custom log transports | Pino transport protocol |
| Custom trace exporters | OTel `SpanExporter` interface |
| Custom context fields | Override `createRequestContext()` |
| Custom health checks | Extend `HealthController` |
| New frameworks | Same core, new module adapter (Express, Fastify) |
