# Changelog

All notable changes to `@brdrwanda/observability` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Configurable auto-request logging: `autoRequestLogging`, `autoErrorLogging`, `logRequestBody`, `logResponseBody` options
- Route exclusion: `excludeRoutes` option (defaults to `['/health', '/metrics']`)
- Controller and handler names in request lifecycle logs
- Consistent `request_start` / `request_complete` / `request_error` message format

## [1.0.0] - 2026-06-29

### Changed
- Upgraded OpenTelemetry to v2 API
- Upgraded NestJS peer dependency to support v11
- Migrated npm scope from `@brd-rw` to `@brdrwanda`

### Security
- Resolved security vulnerabilities in OpenTelemetry v1 dependencies

## [0.2.0] - 2026-06-25

### Added
- `logCaughtError()` method on `ObservabilityLogger` — auto-classifies caught exceptions (4xx → warn, 5xx → error with stack)
- `setupProcessErrorHandlers()` — catches `uncaughtException` and `unhandledRejection`, logs as fatal JSON
- Tracing configuration documentation and process error handler options
- "Why this SDK" section in documentation

## [0.1.0] - 2026-06-22

### Added
- `ObservabilityModule.forRoot()` — single module wires up logging, tracing, metrics, and health
- `ObservabilityLogger` — structured JSON logging via Pino with trace context enrichment
- `ObservabilityTracer` — OpenTelemetry tracing with `@Span` decorator and manual span API
- `ObservabilityMetrics` — Prometheus metrics with `createCounter`, `createHistogram`, `createGauge`
- `ObservabilityExceptionFilter` — global exception filter with error classification (bad_request, authentication_failed, server_error, etc.)
- `LoggingInterceptor` — auto logs request started / request completed with duration
- `MetricsInterceptor` — auto records `http_requests_total` and `http_request_duration_seconds`
- `TracingInterceptor` — creates `ControllerName.methodName` spans for each request
- `ContextMiddleware` — request context via AsyncLocalStorage (request_id, correlation_id, trace_id, client_app)
- Instrumentation plugins: `httpInstrumentation`, `sequelizeInstrumentation`, `kafkaInstrumentation`, `redisInstrumentation`, `mysqlInstrumentation`, `pgInstrumentation`
- Kafka helpers: `injectKafkaHeaders`, `withKafkaContext` for trace propagation
- Sequelize helpers: `createSequelizeLogging`, `createSequelizeErrorLogging` for structured query logging
- `DiagnosticsService` — runtime diagnostic report (SDK version, config, active instrumentations)
- `NestPinoLogger` — NestJS LoggerService adapter for Pino
- Standalone mode: `createObservability()` for Express/Fastify/plain Node.js
- Sensitive data redaction with 17 default paths (passwords, tokens, credit cards, SSNs, etc.)
- Health module: `ObservabilityHealthModule` with liveness endpoint
- Metric exemplars: automatic `trace_id` attachment on histogram observations
- Client origin resolution: `clientOrigins` config maps Origin/Referer to friendly app names
- Environment-aware defaults (dev: debug + pretty + console export, prod: info + JSON + OTLP + 10% sampling)
- SQL query sanitizer: strips literals from SQL before logging
- Sandbox environment: Docker Compose with Grafana, Loki, Tempo, Prometheus, Alertmanager, Teams forwarder

### Infrastructure
- Prometheus alert rules: ServiceDown, HighErrorRate, HighLatencyP95, HighLatencyP99, HighMemoryUsage, HighEventLoopLag
- Alertmanager with Microsoft Teams webhook forwarding
- Promtail config for log collection from PM2 or file-based logs
- GitHub Actions workflow for auto-deploying docs to GitHub Pages
