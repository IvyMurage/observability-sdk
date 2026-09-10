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
| [Product](product.csv) | `product.csv` | 17 (16 HTTP + 1 docs) | ❌ None (manual Trace/Span decorators only) |
| [Profile](profile.csv) | `profile.csv` | 33 (25 HTTP + 8 Kafka) | ❌ None |

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

### Product Service

**Port:** env `PORT`, fallback 3000  
**SDK:** ❌ None — Custom Winston `LoggerService` with DailyRotateFile transports + optional Kafka logging. Manual `@Trace()` / `@Span()` decorators extract `x-trace-id` / `x-span-id` headers for structured log context (no OTel spans). No prom-client. No ObservabilityModule.

| Criticality | Count |
|---|---|
| Critical | 0 |
| High | 6 |
| Medium | 5 |
| Low | 6 |

| Priority | Count |
|---|---|
| P0 | 0 |
| P1 | 5 |
| P2 | 3 |
| P3 | 9 |

**Critical findings:**
- `PATCH /api/products/:id` update body accepts `any` type — **no DTO validation**. Any field can be modified without validation, including fields that should be immutable.
- `console.log('Invalidated cache for product:', id)` in `invalidateProductCache()` — minor data leak, but pattern indicates unstructured logging.
- `GET /api/products/:id/projects` could **route-conflict** with `GET /api/products/:id` — both match `/:id` segment, resolution depends on NestJS module import order.
- Redis caching is **commented out** on categories and projects — inconsistent caching strategy.
- Kafka Product.Updated event is emitted on product update (good), but no observability on emit success/failure.
- Swagger UI (`/api-docs`) is publicly accessible — information disclosure in production.
- Product creation auto-sets status to `'Approved'` — no approval workflow.

**Discrepancies with provided CSV:**
- CSV has no entries for product-service.
- All 17 endpoints discovered from codebase analysis (main branch).

**Migration order:**
1. P1: Wire `ObservabilityModule` in `main.ts` and `app.module.ts`
2. P1: `POST /api/products` (create) — already has best logging, migrate from Winston to SDK
3. P1: `PATCH /api/products/:id` (update) — add domain event + audit trail + typed DTO
4. P1: `GET /api/products/:id` (fetch) — add cache hit/miss metrics + latency histogram
5. P1: `POST /api/products/mapping` (bulk create) — add domain event + logging (currently zero)
6. P2: Verify route conflict between `GET /api/products/:id` and `GET /api/products/:id/projects`
7. P2: Bundle fetch/create endpoints — migrate Winston to SDK
8. P3: Remove legacy Winston `LoggerService`, replace console.log with structured SDK logging
9. P3: Restrict Swagger UI access in production

---

### Profile Service

**Port:** env `PORT`, fallback 3000  
**SDK:** ❌ None — Winston `LoggerService` exists but only used in `HttpExceptionFilter`. Morgan middleware for HTTP request logging. All business logic uses `console.log`/`console.error`/`console.warn`. No prom-client. No OTel. No ObservabilityModule.

| Criticality | Count |
|---|---|
| Critical | 4 |
| High | 9 |
| Medium | 9 |
| Low | 11 |

| Priority | Count |
|---|---|
| P0 | 6 |
| P1 | 8 |
| P2 | 5 |
| P3 | 14 |

**Critical findings:**
- **FIVE unprotected HTTP endpoints exposing PII:**
  - `POST /api/business/create-business` — no auth, creates business records
  - `POST /api/business/batch` — AccessGuard **commented out**, exposes business + representative PII
  - `POST /api/profile/create-individual` — no auth, accepts extensive PII (national ID, income, DOB)
  - `GET /api/profile/:id/customer` — no auth, **duplicate** of authenticated endpoint, exposes full customer PII
  - These represent the **worst security posture of any service analyzed**
- `GET /api/business/:id` makes **two external HTTP calls** to Access Control Service (government RDB registry) with **hardcoded credentials** (`ACCESS_CON_USER`/`ACCESS_CON_PASSWORD`) sent in **plaintext POST body**. Zero logging on this external integration.
- `GET /api/profile/individual` returns **ALL customers with no pagination** — full PII dump of entire customer table.
- **Kafka race condition / data loss:** `representative.created` handler **silently drops** representatives if business hasn't been created yet. No retry, no DLQ — representative is **permanently lost**.
- `customer.individual.created` handler creates customers **without business association** if business doesn't exist yet — no mechanism to fix this later.
- Redis cache module is registered globally and injected into `CustomerService` but **never actually used** (no `get`/`set`/`del` calls).
- `console.log` statements in Kafka handlers likely **log PII** (identificationNumber, email, phone) to stdout.
- **New: Business documents** — compliance-critical CRUD with file uploads to external server, zero logging on create/update/delete.
- **New: Business flags** (`setBusinessFlag`) — can suspend/blacklist businesses with platform-wide impact. Has built-in audit table (BusinessFlagHistory) but zero observability layer (no logging, no metrics, no alerts).
- **New: ApiKeyGuard** — `GET /api/business/users/list` uses API key auth (x-api-key header) instead of JWT. Throws if API_KEY env var not configured.

**Discrepancies with provided CSV:**
- CSV has no entries for profile-service.
- All 33 endpoints (25 HTTP + 8 Kafka) discovered from codebase analysis (main branch).

**Migration order:**
1. P0: **SECURITY — immediately:** Add AccessGuard to `create-business`, `batch`, `create-individual`. Add auth or remove `GET /api/profile/:id/customer`.
2. P0: `GET /api/business/:id` — add structured logging + latency tracking on external RDB integration. Move credentials to vault.
3. P0: `Kafka: user.created` — replace console.log with structured SDK logging with PII redaction
4. P0: `Kafka: representative.created` — implement retry with backoff or DLQ for missing business
5. P0: `Kafka: customer.individual.created` — add compensation mechanism for missing business association
6. P0: `GET /api/profile/:id/customer` — add access logging (client IP, user agent) for forensics until endpoint is secured
7. P1: Wire `ObservabilityModule` in `main.ts` and `app.module.ts`
8. P1: `GET /api/profile/individual` — add pagination (returns entire customer table)
9. P1: `PATCH /api/profile/individual/:id` — add domain event + audit trail for PII changes
10. P1: `PATCH /api/profile/update-own-profile` — add signature upload metrics + file server latency tracking
11. P1: Business document CRUD — add domain events + logging + file upload metrics
12. P1: `POST /api/business-flags/businesses/:businessId` — add logging + metrics on flag changes (suspend/blacklist alerts)
13. P1: `DELETE /api/business/business-documents` — add audit trail for compliance document deletion
14. P2: Flag definitions CRUD — add domain events + logging
15. P2: Customer document Kafka handlers — add domain events + logging
16. P2: `GET /api/business/users/list` — add logging for API key auth endpoint
17. P3: Remove unused Redis cache injection. Replace Morgan with SDK HTTP logging. Delete unused Winston LoggerService.

---

## Cross-Service Observations

### Security Concerns (Flag to Team)

| Issue | Service | Severity |
|---|---|---|
| **5 unprotected endpoints** exposing PII (create-business, batch, create-individual, /:id/customer) | profile | Critical |
| Hardcoded credentials sent in **plaintext POST body** to government registry (RDB) | profile | Critical |
| `.env` committed with plaintext DB password + JWT secret | access-management | Critical |
| Unauthenticated `GET /task/:taskId` exposes workflow data | workflow | High |
| Unauthenticated `GET /api/profile/:id/customer` exposes full customer PII (duplicate endpoint) | profile | High |
| Force-complete bypasses approval with no extra auth check | workflow | High |
| `GET /api/profile/individual` returns entire customer table with no pagination | profile | High |
| Kafka `representative.created` **silently drops** representatives (permanent data loss) | profile | High |
| `PATCH /api/products/:id` accepts `any` body — no DTO validation | product | High |
| `console.log` leaks full config item payload | configuration | Medium |
| BasicAuthGuard defaults to admin/password | configuration | Medium |
| `serviceName` mismatch corrupts trace/log attribution | access-management | Medium |
| Swagger UI publicly accessible in production | product | Medium |
| Redis injected but never used in CustomerService | profile | Low |

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
| `identificationNumber` (national ID) | Customer, Representative, Business entities (profile service) |
| `dateOfBirth`, `income`, `maritalStatus` | Customer entity (profile service) |
| `signatureUrl` | Customer entity — biometric data (profile service) |
| `ACCESS_CON_USER`, `ACCESS_CON_PASSWORD` | Business service → RDB government registry integration |
| `FILE_SERVER_AUTHORIZATION` | Customer service → file server upload auth token |
| Shareholder/board member PII | RDB government registry response (names, DOB, nationality, ID docs, addresses) |
| Product `loanTypes`, `eligibility` payloads | May contain business-sensitive pricing parameters |

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
