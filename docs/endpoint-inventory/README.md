# Endpoint Inventory & Observability Tracking

Comprehensive endpoint inventory for BRD microservices — domain events, logging, metrics, tracing, and migration priority per endpoint.

**Last updated:** September 2026  
**Source:** Actual codebase analysis (main branch)

---

## Spreadsheets

| Service | File | Endpoints | SDK Status |
|---|---|---|---|
| [Access Management](access-management.csv) | `access-management.csv` | 9 (7 HTTP + 2 SDK-provided) | ⚠️ Partial |
| [Configuration](configuration.csv) | `configuration.csv` | 18 (16 HTTP + 2 infrastructure) | ✅ Best in fleet |
| [Workflow](workflow.csv) | `workflow.csv` | 22 (21 HTTP + 1 health) | ❌ None |

---

## How to Read the Spreadsheets

Each row is one endpoint. Key columns:

| Column | What It Tells You |
|---|---|
| **Criticality** | Business impact of failure (Critical/High/Medium/Low) |
| **Domain Event** | Business event name to emit via `logger.domainEvent()` — blank means no domain event needed (read-only/CRUD) |
| **Audit Required** | Whether the operation needs a compliance audit trail |
| **Sensitive Data** | Fields that MUST NOT be logged (passwords, tokens, PII) |
| **Recommended Metrics** | Prometheus metrics to add (counter/histogram name + labels) |
| **Existing Observability** | What's already instrumented |
| **Observability Gap** | What's missing — this is what you need to implement |
| **Priority** | P0 (do now) → P3 (low priority) |
| **Migration Status** | Not Started / In Progress / Complete |

---

## Summary by Service

### Access Management Service

**Port:** 9000 (env), fallback 3000  
**SDK:** Partial — `ObservabilityModule` wired, `NestPinoLogger` as app logger, but Winston `LoggerService` still active in controllers. Almost all controller logging is commented out.

| Criticality | Count |
|---|---|
| Critical | 1 |
| High | 2 |
| Medium | 1 |
| Low | 5 |

| Priority | Count |
|---|---|
| P0 | 2 |
| P1 | 1 |
| P2 | 1 |
| P3 | 5 |

**Critical findings:**
- `POST /api/role-access` (authorization check) is the **hottest path in the entire platform** — every authenticated request across all services calls it. Zero custom metrics, zero logging (commented out).
- `PATCH /api/role-access/:id/manage-permission` toggles access grants with **zero audit trail**. Security-critical operation completely invisible.
- `serviceName` mismatch: `main.ts` says `'application-gateway'`, `app.module.ts` says `'access-management-service'`.
- `.env` file committed with **plaintext database password and JWT secret**.

**Discrepancies with provided CSV:**
- CSV lists `GET /api/role-access` — actual codebase has `POST /api/role-access` (body-based query, not GET).
- CSV lists `PUT /api/role-access/:id` and `DELETE /api/role-access/:id` — actual codebase has `PATCH /api/role-access/:roleAccessId/manage-permission` (toggle, not separate update/delete).
- CSV missing: `POST /api/role-access/:roleName/bulk/:projectId/create` (bulk grant).
- CSV missing: `POST /api/routes` (paginated route listing).
- CSV missing: `GET /api/routes` (bulk route creation — yes, a GET that writes).
- CSV missing: `GET /api` (smoke test).

**Migration order:**
1. P0: `POST /api/role-access` — add latency histogram + cache hit ratio + error counter
2. P0: `PATCH /api/role-access/:roleAccessId/manage-permission` — add domain event + audit trail
3. P1: `POST /api/role-access/:roleName/bulk/:projectId/create` — add domain event + audit
4. Fix `serviceName` mismatch in `main.ts`
5. Remove legacy Winston `LoggerService`

---

### Configuration Service

**Port:** env `PORT`, fallback 3000  
**SDK:** Best in fleet — `ObservabilityLogger` injected in controller with traceId/spanId/userId on every handler. Legacy Winston `LoggerService` exists but is **not used anywhere**.

| Criticality | Count |
|---|---|
| Critical | 0 |
| High | 5 |
| Medium | 7 |
| Low | 6 |

| Priority | Count |
|---|---|
| P0 | 0 |
| P1 | 4 |
| P2 | 4 |
| P3 | 10 |

**Critical findings:**
- `console.log('Deleting config item:', configItem)` in `configuration.service.ts:1025` **leaks full config item payload to stdout** — may contain sensitive business rules or templates.
- `console.log('Transaction rolled back')` and `console.error('Error rolling back transaction:')` in schema creation error path.
- **Potential route conflict:** `POST /schema` declared AFTER `POST /:ns/:type` — NestJS may route `POST /schema` to the `:ns/:type` handler with `ns='schema'`. Needs verification.
- `BasicAuthGuard` defaults to `admin`/`password` if env vars not set — security risk if deployed with defaults.
- No custom Prometheus metrics despite being the best-logged service.
- Outbox pattern has proper retry + DLQ but no metrics on outbox queue depth or publish failure rate.

**Discrepancies with provided CSV:**
- CSV has no entries for configuration-service (only access-management and auth were in the CSV).
- All 18 endpoints discovered from codebase analysis.

**Migration order:**
1. P1: Remove `console.log` on line 1025 (data leak), lines 1209-1210 (error handling), `http.exception.filter.ts:25,35`
2. P1: Add domain events for create/update/delete operations
3. P1: Add `config_item_operations_total` and `config_schema_registrations_total` metrics
4. P1: Add `config_outbox_pending` gauge and `config_outbox_failures_total` counter
5. P2: Verify `POST /schema` route conflict
6. P2: Add `config_search_duration_seconds` histogram for JSON_VALUE search performance
7. P3: Delete unused legacy `LoggerService` (Winston)

---

### Workflow Service

**Port:** env `PORT`, fallback 3000  
**SDK:** ❌ None — NestJS built-in `Logger` + barely-used Winston. Zero metrics. Zero tracing. Zero structured logging.

| Criticality | Count |
|---|---|
| Critical | 3 |
| High | 7 |
| Medium | 6 |
| Low | 6 |

| Priority | Count |
|---|---|
| P0 | 4 |
| P1 | 5 |
| P2 | 5 |
| P3 | 8 |

**Critical findings:**
- **Zero observability SDK, zero metrics, zero distributed tracing** on the service that drives every approval workflow in the platform (loans, guarantees, tenders, claims, PFI onboarding, MEL reports).
- `GET /api/workflow/v1/task/:taskId` is **@Public() — unauthenticated**. Exposes task data (assignee, roleCode, comments, fileUrl, departmentCode) to anyone. No access logging, no rate limiting.
- `POST /api/workflow/v1/admin/instances/:instanceId/force-complete` bypasses normal approval flow with **no additional admin-role verification** beyond standard AccessGuard. No audit trail beyond NestJS Logger.
- `POST /api/workflow/v1/tasks/:id/act` is the **core state machine endpoint** (4,444-line service file) with zero structured logging. State transitions, join conditions, multireview fan-out, and json-logic evaluation are all invisible.
- `POST /api/workflow/v1/tasks/actions` (bulk approve/reject) processes multiple tasks without a single transaction — partial failures are possible with no visibility into which tasks succeeded vs failed.
- Outbox `ERR` status has retry cron (every 5 min, max 3 attempts) but no metrics on failure rate or queue depth.
- `WorkflowTaskReassigned` Kafka topic constant defined but never emitted from `reassignTask()`.
- `HttpExceptionFilter` defined but **not registered globally**.
- Double `/api` prefix bug on health check: `GET /api/api`.

**Discrepancies with provided CSV:**
- CSV has no entries for workflow-service.
- All 22 endpoints discovered from codebase analysis.

**Migration order:**
1. P0: Wire `ObservabilityModule` in `main.ts` and `app.module.ts`
2. P0: `POST /tasks/:id/act` — add domain event `workflow.task_acted_on` + structured logging per state transition
3. P0: `POST /instances:start` — add domain event `workflow.instance_started` + metrics
4. P0: `POST /admin/instances/:instanceId/force-complete` — add domain event + security audit trail
5. P0: `GET /task/:taskId` — add access logging (client IP, user agent) for unauthenticated endpoint, flag to service owner for security review
6. P1: `POST /tasks/actions` (bulk) — add domain event with per-task result breakdown
7. P1: Add `workflow_task_action_total`, `workflow_instances_started_total`, `workflow_instance_duration_seconds` metrics
8. P1: Add outbox metrics: `workflow_outbox_pending` gauge, `workflow_outbox_failures_total` counter
9. P1: Resume/reassign/cancel endpoints — add domain events
10. P2: Fix double `/api/api` prefix, register `HttpExceptionFilter` globally
11. P2: Populate `correlationId`/`causationId` in outbox events
12. P3: Remove unused `JwtAuthGuard`, unused `WorkflowTasksInboxView` entity

---

## Cross-Service Observations

### Security Concerns (Flag to Team)

| Issue | Service | Severity |
|---|---|---|
| Unauthenticated `GET /task/:taskId` exposes workflow data | workflow | High |
| `console.log` leaks full config item payload | configuration | Medium |
| `.env` committed with plaintext DB password + JWT secret | access-management | Critical |
| BasicAuthGuard defaults to admin/password | configuration | Medium |
| `serviceName` mismatch corrupts trace/log attribution | access-management | Medium |
| Force-complete bypasses approval with no extra auth check | workflow | High |

### Sensitive Data — Never Log These

| Data | Where It Appears |
|---|---|
| JWT tokens | Authorization header on all authenticated requests |
| `identificationNumber` | IUser interface (decoded from JWT) |
| `autenticatorQrCode` | IUser interface |
| `accountToken` | IUser interface |
| `phone`, `email` | IUser interface |
| `ENCRYPTION_KEY`, `ENCRYPTION_IV` | Environment variables |
| `JWT_SECRET` | Environment variables |
| `DB_PASSWORD` | Environment variables |
| Basic Auth credentials | Authorization header on public endpoints |
| Workflow task comments | May contain business-sensitive review notes |
| Config item payloads | May contain fee structures, templates, business rules |

### Standard Log Fields (Every Request)

```
trace_id, span_id, request_id, correlation_id,
service_name, environment,
http_method, http_route, http_status_code, duration_ms,
user_id (from JWT, never full user object),
error_type, error_message (on failure)
```

### Metrics Naming Convention

All custom metrics should follow the SDK pattern:
```
{service_prefix}_{domain}_{metric_name}_{unit}
```

Examples:
- `accessmanagement_authorization_check_duration_seconds`
- `configuration_item_operations_total`
- `workflow_task_action_total`
