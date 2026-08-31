# Production Observability Design — API Gateway & Authentication Service

> **Branch:** `feat/observability-metrics-logs-design`
> **Base:** `develop`
> **Date:** 2026-08-31

---

## Service Profiles

### API Gateway

| Attribute | Value |
|-----------|-------|
| Framework | NestJS (Express) |
| Role | Routes all client traffic to downstream microservices |
| Database | None (stateless proxy) |
| Cache | Redis (cache-manager-redis-store) |
| Downstream services | 15+ microservices via HTTP (Axios) |
| Messaging | Kafka (logging microservice) |
| Auth | Token interceptor — extracts `Authorization` header, forwards to downstream |
| Rate limiting | ThrottlerModule (configurable TTL/limit) |
| Error handling | Global `HttpExceptionFilter` with Kafka logging |
| SDK version | `@brdrwanda/observability ^1.0.1` |
| Global prefix | None |

### Authentication Service

| Attribute | Value |
|-----------|-------|
| Framework | NestJS (Express) |
| Role | User registration, login, OTP, token management, RBAC |
| Database | MSSQL (Sequelize + tedious) |
| Cache | Redis (commented out, not active) |
| Messaging | Kafka (logging via legacy LoggerService) |
| Auth flows | Login → OTP → Token, AD login (BRD staff), refresh token, password reset |
| External deps | NIDA (national ID verification), RRA (TIN verification) |
| Rate limiting | ThrottlerModule (10 req/60s) |
| SDK version | `@brdrwanda/observability ^1.0.1` |
| Global prefix | None (routes prefixed in controllers: `api/users`, `api/access`) |

---

## What the SDK Provides Automatically

The SDK auto-instruments once `ObservabilityModule.forRoot()` is configured:

| Capability | SDK Provides | Configuration |
|------------|-------------|---------------|
| `{prefix}_http_requests_total` counter | ✅ | Labels: `method`, `route`, `status_code` |
| `{prefix}_http_request_duration_seconds` histogram | ✅ | Buckets: 5ms–10s, with trace exemplars |
| Node.js runtime metrics (GC, heap, event loop) | ✅ | `defaultMetrics: true` |
| Request context (requestId, correlationId, traceId, clientApp) | ✅ | ContextMiddleware |
| Structured JSON logging (Pino) | ✅ | NestPinoLogger |
| Health endpoint (`/health`) | ✅ | ObservabilityHealthModule |
| Metrics endpoint (`/metrics`) | ✅ | Prometheus scrape target |
| HTTP instrumentation (OpenTelemetry) | ✅ | `httpInstrumentation()` |
| Kafka instrumentation | ✅ | `kafkaInstrumentation()` |
| Redis instrumentation | ✅ | `redisInstrumentation()` |
| Process error handlers | ✅ | `setupProcessErrorHandlers()` |
| Trace context propagation | ✅ | Auto via OTEL |

**What the SDK does NOT provide:**

- Business-domain metrics (auth attempts, token operations)
- Application-specific log events (login success, OTP failure)
- Downstream request metrics per service (gateway-specific)
- Sensitive data redaction (must configure)
- Custom alerting rules

---

## 1. Metrics Design

### 1.1 Common Metrics (Both Services — SDK-provided)

| Metric | Type | Labels | Purpose |
|--------|------|--------|---------|
| `{prefix}_http_requests_total` | Counter | `method`, `route`, `status_code` | Request rate, error rate |
| `{prefix}_http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Latency P50/P95/P99 |
| `nodejs_active_handles_total` | Gauge | — | Event loop saturation |
| `nodejs_heap_size_used_bytes` | Gauge | — | Memory pressure |
| `nodejs_eventloop_lag_seconds` | Histogram | — | Event loop lag |
| `process_cpu_seconds_total` | Counter | — | CPU usage |

### 1.2 API Gateway — Service-Specific Metrics

These require application code. Use `MetricsService` from SDK.

| Metric | Type | Labels | Why We Need It |
|--------|------|--------|----------------|
| `apigateway_downstream_requests_total` | Counter | `target_service`, `method`, `status_code` | Which downstream services are failing? |
| `apigateway_downstream_duration_seconds` | Histogram | `target_service` | Which downstream services are slow? |
| `apigateway_downstream_timeouts_total` | Counter | `target_service` | Timeout detection per service |
| `apigateway_throttled_requests_total` | Counter | `route` | Rate-limit hits — capacity signal |
| `apigateway_cache_hits_total` | Counter | `operation` | Redis cache effectiveness |
| `apigateway_cache_misses_total` | Counter | `operation` | Cache miss rate |

**Label safety:** `target_service` is low-cardinality (15 known services). Never use user IDs, request IDs, or full URLs as labels.

### 1.3 Authentication Service — Service-Specific Metrics

| Metric | Type | Labels | Why We Need It |
|--------|------|--------|----------------|
| `authentication_login_attempts_total` | Counter | `method` (`password`, `ad`, `otp`), `result` (`success`, `failure`) | Auth traffic and failure rate |
| `authentication_login_duration_seconds` | Histogram | `method` | Login flow latency |
| `authentication_token_operations_total` | Counter | `operation` (`issue`, `refresh`, `revoke`), `result` | Token lifecycle |
| `authentication_otp_verifications_total` | Counter | `result` (`success`, `expired`, `invalid`) | OTP success rate |
| `authentication_password_resets_total` | Counter | `result` | Password reset flow |
| `authentication_external_api_duration_seconds` | Histogram | `provider` (`nida`, `rra`) | External dependency latency |
| `authentication_external_api_errors_total` | Counter | `provider` | External dependency failures |
| `authentication_db_query_duration_seconds` | Histogram | `operation` (`read`, `write`) | Database performance |

**Label safety:**
- `method`: Only `password` / `ad` / `otp` — never the username
- `result`: Only `success` / `failure` — never the failure reason detail
- `provider`: Only known providers (`nida`, `rra`) — never URLs

---

## 2. Logging Design

### 2.1 Common Log Fields

Every log line should carry these fields. The SDK auto-populates the first group.

**SDK-generated (automatic):**

| Field | Source | Example |
|-------|--------|---------|
| `timestamp` | Pino | `2026-08-31T10:55:09.260Z` |
| `level` | Pino | `info` / `warn` / `error` |
| `pid` | Pino | `17` |
| `service_name` | SDK config | `api-gateway` |
| `environment` | SDK config | `production` |
| `version` | SDK config | `0.0.1` |
| `trace_id` | OTEL context | `950feeb90b7f39582f86e363f29081ac` |
| `span_id` | OTEL context | `fbb0647e3238b975` |
| `request_id` | ContextMiddleware | `uuid` |
| `correlation_id` | ContextMiddleware | `uuid` |

**Application-specific (developer must add):**

| Field | Type | Purpose |
|-------|------|---------|
| `event` | string | Machine-readable event name (`login_success`, `downstream_timeout`) |
| `statusCode` | number | HTTP status code |
| `method` | string | HTTP method |
| `url` | string | Request path (sanitized — no query params with tokens) |
| `duration_ms` | number | Operation duration |
| `target_service` | string | Downstream service name (gateway only) |
| `error_type` | string | Error classification |

### 2.2 Severity Guidelines

| Level | When to Use | Example |
|-------|-------------|---------|
| `DEBUG` | Internal flow details, only in non-production | Token decode steps, cache key generation |
| `INFO` | Successful operations, state changes | Login success, token issued, user created |
| `WARN` | Expected failures, recoverable issues | Invalid password (user error), OTP expired, rate-limited |
| `ERROR` | Unexpected failures, system errors | DB connection failure, NIDA API down, unhandled exception |

**Critical rule:** An invalid password is `WARN`, not `ERROR`. A database timeout during login is `ERROR`. This distinction prevents alert fatigue.

### 2.3 API Gateway Log Events

| Event | Level | Fields | Not Logged |
|-------|-------|--------|------------|
| `request_start` | INFO | `method`, `url`, `client_ip`, `user_agent` | Authorization header |
| `request_complete` | INFO | `method`, `url`, `status_code`, `duration_ms` | Response body |
| `request_error` | WARN/ERROR | `method`, `url`, `status_code`, `error_type`, `message` | Stack trace for 4xx |
| `downstream_request` | DEBUG | `target_service`, `method`, `url`, `duration_ms` | Auth headers forwarded |
| `downstream_failure` | ERROR | `target_service`, `status_code`, `error_type`, `duration_ms` | Response body from downstream |
| `downstream_timeout` | ERROR | `target_service`, `url`, `timeout_ms` | — |
| `throttle_exceeded` | WARN | `route`, `client_ip`, `limit`, `ttl` | — |
| `cache_hit` / `cache_miss` | DEBUG | `operation`, `key_pattern` | Full cache key |
| `startup` | INFO | `port`, `environment`, `node_version` | — |
| `process_error` | ERROR | `error_type`, `message`, `stack` | — |

### 2.4 Authentication Service Log Events

| Event | Level | Fields | ⛔ Never Log |
|-------|-------|--------|-------------|
| `login_attempt` | INFO | `method` (`password`/`ad`), `username_hash` | Password, raw username |
| `login_success` | INFO | `method`, `user_id`, `has_2fa` | Token value |
| `login_failure` | WARN | `method`, `reason` (`invalid_credentials`/`account_locked`/`internal_error`) | Password, raw username |
| `otp_sent` | INFO | `channel` (`sms`/`email`), `user_id` | OTP value, phone number |
| `otp_validated` | INFO | `user_id`, `result` | OTP value |
| `otp_failed` | WARN | `user_id`, `reason` (`expired`/`invalid`/`max_attempts`) | OTP value |
| `token_issued` | INFO | `user_id`, `token_type` (`access`/`refresh`) | Token value |
| `token_refreshed` | INFO | `user_id` | Old/new token values |
| `token_refresh_failed` | WARN | `reason` (`expired`/`revoked`/`invalid`) | Token value |
| `password_reset_requested` | INFO | `user_id` | Email, reset token |
| `password_reset_completed` | INFO | `user_id` | New password, reset token |
| `user_created` | INFO | `user_id`, `registration_method` | Personal details |
| `user_blocked` | WARN | `user_id`, `reason` | — |
| `external_api_call` | INFO | `provider` (`nida`/`rra`), `duration_ms`, `status_code` | National ID, TIN number |
| `external_api_failure` | ERROR | `provider`, `error_type`, `duration_ms` | Request/response body |
| `db_connection_error` | ERROR | `error_type`, `message` | Connection string |
| `ad_login_attempt` | INFO | `domain` | Password |
| `ad_login_result` | INFO/WARN | `domain`, `result` | Password |

**Sensitive data rule:** Hash or omit usernames in logs. Use `user_id` (numeric) for correlation. Never log passwords, tokens, OTP values, national IDs, phone numbers, or email addresses.

---

## 3. Metrics vs Logs Boundary

| Information | Where It Belongs | Why |
|-------------|-----------------|-----|
| Login success/failure rate | **Metric** | Trend, alerting |
| Which user failed to login | **Log** | Investigation, high-cardinality |
| P99 request latency | **Metric** | SLO tracking |
| Why a specific request was slow | **Log + Trace** | Root cause analysis |
| Downstream service error rate | **Metric** | Dependency health |
| Downstream error response body | **Log** | Debugging |
| Token refresh rate | **Metric** | Capacity planning |
| Which token was invalid | **Log** | Security investigation |
| OTP failure rate | **Metric** | Alerting |
| Specific OTP attempt details | **Neither** (security risk) | — |

---

## 4. Alerting Candidates

| Signal | Alert? | Threshold (starting point) | Reason |
|--------|--------|---------------------------|--------|
| `apigateway_http_requests_total{status_code=~"5.."}` rate | **Yes** | > 1% of traffic for 5min | User-impacting gateway errors |
| `apigateway_http_request_duration_seconds` P99 | **Yes** | > 5s for 5min | Performance degradation |
| `apigateway_downstream_timeouts_total` rate | **Yes** | > 5/min for 3min | Downstream outage |
| `authentication_login_attempts_total{result="failure"}` rate | **Yes** | > 20% failure rate for 5min | Auth system problem or attack |
| `authentication_external_api_errors_total` rate | **Yes** | > 50% for 3min | NIDA/RRA dependency down |
| `authentication_http_request_duration_seconds` P99 | **Yes** | > 3s for 5min | Auth latency impact |
| `authentication_db_query_duration_seconds` P99 | **Maybe** | > 1s for 5min | DB saturation early warning |
| `apigateway_throttled_requests_total` rate | **Maybe** | > 100/min | Capacity awareness |
| Node.js heap size | **Yes** | > 80% of limit for 10min | Memory leak / OOM risk |
| Event loop lag P99 | **Maybe** | > 500ms for 5min | CPU saturation |

---

## 5. Dashboard Outlines

### 5.1 API Gateway Dashboard

**Row 1 — Overview (stat panels)**
- Request rate (req/s)
- Error rate (%)
- P95 latency (ms)
- Active requests

**Row 2 — Traffic (time series)**
- Requests by status code (2xx, 4xx, 5xx stacked)
- Request rate by top 10 routes

**Row 3 — Latency (time series + heatmap)**
- P50/P95/P99 latency over time
- Latency heatmap by route

**Row 4 — Downstream Health (time series)**
- Downstream request rate by `target_service`
- Downstream error rate by `target_service`
- Downstream P95 latency by `target_service`
- Timeout count by `target_service`

**Row 5 — Infrastructure (time series)**
- Node.js heap used vs limit
- Event loop lag
- CPU usage
- Redis cache hit rate

### 5.2 Authentication Dashboard

**Row 1 — Overview (stat panels)**
- Login rate (attempts/min)
- Auth success rate (%)
- P95 login latency (ms)
- Active token refreshes/min

**Row 2 — Authentication Traffic (time series)**
- Login attempts: success vs failure
- Login method breakdown (password / AD / OTP)
- Token operations (issue / refresh / revoke)

**Row 3 — Authentication Failures (time series + table)**
- Failure rate by reason (invalid_credentials, expired, locked)
- OTP verification success vs failure
- Password reset requests

**Row 4 — Dependencies (time series)**
- NIDA/RRA API latency
- NIDA/RRA error rate
- DB query latency (read vs write)
- DB connection pool utilization

**Row 5 — Security Signals (time series)**
- Failed login rate (abnormal spike detection)
- Account lockout rate
- Rate-limit hits

---

## 6. SDK Alignment

| Requirement | SDK Provides? | Config Needed? | App Code Needed? |
|-------------|:------------:|:--------------:|:----------------:|
| HTTP request count + duration | ✅ | — | — |
| Node.js runtime metrics | ✅ | `defaultMetrics: true` | — |
| Request context (traceId, requestId) | ✅ | — | — |
| Structured JSON logging | ✅ | `NestPinoLogger` in `main.ts` | — |
| Health endpoint | ✅ | `ObservabilityHealthModule` | — |
| Prometheus metrics endpoint | ✅ | — | — |
| HTTP trace spans | ✅ | `httpInstrumentation()` | — |
| Kafka trace spans | ✅ | `kafkaInstrumentation()` | — |
| Redis trace spans | ✅ | `redisInstrumentation()` | — |
| Downstream service metrics | ❌ | — | ✅ Instrument `AxiosService` |
| Auth domain metrics (login, OTP, token) | ❌ | — | ✅ Add counters in controllers/services |
| External API metrics (NIDA/RRA) | ❌ | — | ✅ Add histogram + counter |
| DB query metrics | ❌ | — | ✅ Sequelize instrumentation or manual |
| Cache hit/miss metrics | ❌ | — | ✅ Instrument Redis cache calls |
| Sensitive data redaction | ⚠️ Partial | `redaction` config | ✅ Review and extend |
| Throttle metrics | ❌ | — | ✅ Custom ThrottlerGuard |
| OTEL traces to Tempo | ✅ | Set `OTEL_EXPORTER_OTLP_ENDPOINT` | — |
| Sequelize DB trace spans | ✅ | Add `sequelizeInstrumentation()` | Install peer dep |

---

## 7. Implementation Plan

### Phase 1 — Common Foundation (Both Services)

1. **Fix SDK config for k8s:**
   - Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo.observability.svc:4318` in secrets
   - Set tracing exporter to `otlp-http` (not `console`) for production
   - Update `httpInstrumentation` ignore paths to `/api/health`, `/api/metrics` if using global prefix

2. **Remove legacy logging:**
   - Remove `MorganMiddleware` (SDK handles request logging via Pino)
   - Remove legacy `LoggerService` + Kafka logging (replace with `ObservabilityLogger`)
   - Remove `console.log` / `console.error` calls

3. **Verify CORS fix:**
   - Ensure `!origin` check in `corsOptions` (API Gateway already has it; authentication-service CORS is commented out)

### Phase 2 — API Gateway Instrumentation

1. **Instrument `AxiosService`:**
   - Add `downstream_requests_total` counter
   - Add `downstream_duration_seconds` histogram
   - Add `downstream_timeouts_total` counter
   - Extract `target_service` from URL mapping (known service URLs → service names)

2. **Instrument ThrottlerGuard:**
   - Add `throttled_requests_total` counter in `CustomThrottlerGuard`

3. **Instrument Redis cache:**
   - Add `cache_hits_total` / `cache_misses_total` counters

4. **Structured log events:**
   - Replace `console.warn("Slow request...")` in AxiosService with `ObservabilityLogger`
   - Add `downstream_failure` and `downstream_timeout` events
   - Update `HttpExceptionFilter` to use `ObservabilityLogger` instead of legacy `LoggerService`

### Phase 3 — Authentication Service Instrumentation

1. **Auth domain metrics:**
   - Add `login_attempts_total` counter in `UsersController.login()`
   - Add `login_duration_seconds` histogram
   - Add `token_operations_total` counter
   - Add `otp_verifications_total` counter

2. **External API metrics:**
   - Add `external_api_duration_seconds` histogram for NIDA/RRA calls
   - Add `external_api_errors_total` counter

3. **Database metrics:**
   - Add `sequelizeInstrumentation()` to instrumentations array
   - Install `opentelemetry-instrumentation-sequelize` peer dependency
   - Add `db_query_duration_seconds` histogram for critical queries

4. **Structured log events:**
   - Add auth events: `login_attempt`, `login_success`, `login_failure`, `otp_sent`, `otp_validated`, `token_issued`
   - Ensure sensitive data never appears in logs
   - Replace legacy `LoggerService` in `AccessController` with `ObservabilityLogger`

### Phase 4 — Validation

1. **Generate traffic:** Hit login, OTP, token refresh, password reset endpoints
2. **Validate metrics:** Check Prometheus targets, query each metric
3. **Validate logs:** Verify structured events in Loki with correct fields
4. **Validate correlation:** Click trace_id in log → opens trace in Tempo
5. **Validate dashboards:** Build dashboard panels from designed metrics
6. **Security audit:** Confirm no passwords, tokens, OTPs, national IDs, or PII in logs or metric labels

---

## 8. Production Readiness Checklist

| Area | API Gateway | Auth Service | Notes |
|------|:-----------:|:------------:|-------|
| SDK configured | ✅ | ✅ | Both have `ObservabilityModule.forRoot()` |
| Metrics endpoint | ✅ | ✅ | `/metrics` exposed |
| Health endpoint | ✅ | ✅ | `ObservabilityHealthModule` imported |
| NestPinoLogger | ✅ | ✅ | Both use `app.useLogger(app.get(NestPinoLogger))` |
| Process error handlers | ✅ | ✅ | `setupProcessErrorHandlers()` in `main.ts` |
| OTEL tracing (production) | ⚠️ | ⚠️ | Gateway hardcoded to `localhost:4318`; Auth uses env var but only in production |
| HTTP instrumentation | ✅ | ✅ | `httpInstrumentation()` configured |
| Kafka instrumentation | ✅ | ✅ | `kafkaInstrumentation()` configured |
| Redis instrumentation | ✅ | ❌ | Auth has Redis commented out |
| Sequelize instrumentation | ➖ | ❌ | Auth needs `sequelizeInstrumentation()` |
| Legacy logging removed | ❌ | ❌ | Both still have `MorganMiddleware` + legacy `LoggerService` |
| Downstream metrics | ❌ | ➖ | Gateway needs `AxiosService` instrumented |
| Auth domain metrics | ➖ | ❌ | Auth needs login/OTP/token counters |
| External API metrics | ➖ | ❌ | Auth needs NIDA/RRA instrumented |
| Sensitive data redaction | ⚠️ | ⚠️ | Not explicitly configured — needs audit |
| Structured log events | ⚠️ | ⚠️ | Basic logging exists; needs event taxonomy |
| CORS fix for Prometheus | ✅ | ⚠️ | Gateway has fix; Auth CORS disabled (OK if behind gateway) |
| Dashboard designed | ❌ | ❌ | Outlined above |
| Alert candidates identified | ✅ | ✅ | See Section 4 |
| Validation plan | ❌ | ❌ | See Phase 4 |

---

## 9. Final Assessment

> **If API Gateway and Authentication Service were serving real production traffic tomorrow, would this observability design give an SRE enough signal to detect user-impacting problems, understand their scope, and investigate the root cause without being overwhelmed by telemetry noise?**

**Yes, with the gaps closed.** The SDK already provides the foundation — HTTP RED metrics, structured logging, trace context, and health checks. The gaps are:

### Must-fix before production confidence:

1. **OTEL endpoint** — Both services must send traces to Tempo, not console/localhost
2. **Downstream visibility** (Gateway) — Without per-service metrics on `AxiosService`, you can't identify which of 15+ downstream services is causing failures
3. **Auth domain metrics** — Without login/OTP/token counters, you can't distinguish "authentication is down" from "one downstream service is slow"
4. **Legacy logging cleanup** — `MorganMiddleware` and legacy `LoggerService` create duplicate, unstructured logs that increase noise and cost

### Nice-to-have (Phase 2):

5. Sequelize instrumentation on auth service
6. Redis cache metrics on gateway
7. Throttle metrics
8. Dashboards and alerts

The design is intentionally compact: **18 service-specific metrics** across both services plus the SDK auto-metrics. No high-cardinality labels. No sensitive data exposure. Every metric maps to an operational question an SRE would ask during an incident.
