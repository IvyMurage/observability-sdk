# BRD Platform — Service Observability Analysis

**Scope:** All BRD microservices — domain events, technical logging, Prometheus metrics  
**SDK:** `@brdrwanda/observability` v2.0.0 (Pino + prom-client + OpenTelemetry)  
**Last analyzed:** September 2026  
**Source:** Actual codebase analysis (main branch), not speculative

---

## Contents

1. [Fleet Overview](#1-fleet-overview)
2. [API Gateway](#2-api-gateway)
3. [Authentication Service](#3-authentication-service)
4. [Access Management Service](#4-access-management-service)
5. [Workflow Service](#5-workflow-service)
6. [Payment Service](#6-payment-service)
7. [Application Service](#7-application-service)
8. [Configuration Service](#8-configuration-service)
9. [Profile Service](#9-profile-service)
10. [Product Service](#10-product-service)
11. [Job Scheduler (uno-job-scheduler)](#11-job-scheduler)
12. [MEL Service](#12-mel-service)
13. [Cross-Cutting Concerns](#13-cross-cutting-concerns)
14. [Implementation Priority](#14-implementation-priority)

---

## 1. Fleet Overview

### SDK Migration Status

| Service | Port | SDK Adopted | Current Logging | Severity |
|---|---|---|---|---|
| api-gateway | 3000 | ⚠️ Partial | SDK + Winston + prom-client (metrics interceptor commented out) | HIGH |
| authentication-service | 8000 | ⚠️ Partial | SDK + Winston + LoggingService(Kafka) — 3 parallel loggers | HIGH |
| access-management-service | 8000 | ⚠️ Partial | SDK + Winston + dead Kafka audit path | MEDIUM |
| workflow-service | 8000 | ❌ None | NestJS Logger + barely-used Winston | CRITICAL |
| payment-service | 8800 | ❌ None | Winston daily-rotate files only | HIGH |
| application-service | 8000 | ⚠️ Partial | SDK in 7/20 controllers; rest = NestJS Logger + console | CRITICAL |
| configuration-service | 8000 | ✅ Best | SDK + legacy Winston+Kafka still wired | LOW |
| profile-service | 8000 | ❌ None | console.log only (25+ sites) | HIGH |
| product-service | 8000 | ❌ None | Winston + Kafka log shipping | MEDIUM |
| uno-job-scheduler | 8000 | ⚠️ Partial | SDK at bootstrap; cron jobs = console.log (18 sites) | CRITICAL |
| mel-service | 3000 | ❌ None | NestJS Logger (3 console sites) | MEDIUM |

### Three Common Anti-Patterns Across Fleet

1. **Winston daily-rotate alongside SDK** — Configuration, auth, access-mgmt, api-gateway, product all have `src/logger/logger.service.ts` (Winston) running parallel to SDK Pino. Logs split across two pipelines.
2. **Scattered console.log/console.error** — 100+ sites fleet-wide. Many leak sensitive data (`console.log('rows', rows)`, `console.log("applicant", applicant)`).
3. **Dead Kafka audit logging** — `LoggingService`/`logMessage()` pattern across auth, access-mgmt, product — commented out or unused. Predecessor to domain events, now dead code.

---

## 2. API Gateway

**Path:** `api-gateway` | **Port:** env `PORT`, default 3000  
**Role:** HTTP fan-out proxy to ~15 upstream services (55 controllers)  
**SDK Status:** ⚠️ Partial — SDK + Winston + prom-client all running, but key middleware commented out

### Architecture

- NestJS monolith proxying all requests via `AxiosService.request()` to upstream services
- NO rate limiting, NO circuit breaker, NO auth guards (auth delegated to downstream)
- Retry logic exists but disabled (`maxRetries: 0`)
- `MorganMiddleware`, `TraceContextMiddleware`, `MetricsInterceptor` — all **commented out**

### Upstream Services Proxied

| Env Var | Routes |
|---|---|
| `USER_SERVICE_URL` | `/api/users`, `/api/staff`, `/api/access` |
| `ACCESS_MANAGEMENT_SERVICE_URL` | `/api/role-access`, `/api/routes` |
| `APPLICATION_SERVICE_URL` | `/api/application`, `/api/tenders`, `/api/guarantee*`, `/api/bids`, `/api/requisitions`, `/api/forms`, `/api/loan-applications`, `/api/simulation`, `/api/financial-institutions`, `/api/claims`, `/api/procurement-plan`, `/api/guarantee-loans`, `/api/individual-reports`, `/api/external`, `/api/internal/tat` |
| `PROPERTIES_SERVICE_URL` | `/api/requests`, `/api/properties`, `/api/units`, `/api/dashboard` |
| `CRM_SERVICE_URL` | `/api/tickets*`, `/api/minuza-*` |
| `CORE_BANKING_SERVICE_URL` | `/api/companies`, `/api/beneficiaries`, `/api/corebanking` |
| `CREDIT_SCORE_SERVICE_URL` | `/api/creditscore` |
| `PROFILE_SERVICE_URL` | `/api/profile`, `/api/business` |
| `PRODUCT_SERVICE_URL` | `/api/products` |
| `CONFIGURATION_SERVICE_URL` | `/api/configuration/v1` |
| `WORKFLOW_SERVICE_URL` | `/api/workflow/v1` |
| `PAYMENT_SERVICE_URL` | `/api/payments`, `/api/invoices` |
| `LOGGING_SERVICE_URL` | `/api/logging` (frontend error forwarding) |
| `FILE_MANAGEMENT_SERVICE_URL` | Internal (restructuring) |

### Domain Events

| Event | When | Severity | Fields |
|---|---|---|---|
| `gateway.upstream_request_failed` | AxiosService catches 5xx / ECONNRESET / ECONNREFUSED / ETIMEDOUT | error | `upstream_service`, `method`, `path`, `status_code`, `error_type`, `duration_ms` |
| `gateway.upstream_timeout` | Request exceeds timeout | error | `upstream_service`, `path`, `timeout_ms` |
| `gateway.health_check_failed` | Kafka or Redis health indicator throws | warn | `component` (kafka/redis), `error` |

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| Every proxied request/response | `AxiosService.request()` | info | Request tracing across gateway boundary — currently invisible |
| Upstream 4xx responses | `AxiosService.formatError()` | warn | Distinguish auth failures from service failures |
| Exception filter catches | `HttpExceptionFilter.catch()` | error | Already has traceId/spanId — replace console.log |
| File upload proxy failures | Controllers using `FileInterceptor` | error | Currently silent on multipart forwarding errors |
| CORS rejections | `corsOptions` callback | warn | Blocked origins invisible today |

**console.log to remove (8 sites):**
- `main.ts:39` (Swagger warn), `main.ts:53` (startup)
- `guarantee-loans.service.ts:55` (payload dump)
- `corebanking.service.ts:42` (URL dump)
- `logger.service.ts:321` (debug leftover)
- `http.exception.filter.ts:46,73` (exception dumps)

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `gateway_upstream_request_duration_seconds` | Histogram | `upstream_service`, `method`, `path`, `status_code` | **Already defined** in MetricsService as `downstream_request_duration_seconds` but interceptor commented out — uncomment and wire |
| `gateway_upstream_request_total` | Counter | `upstream_service`, `method`, `status_code` | **Already defined** as `downstream_requests_total` |
| `gateway_upstream_errors_total` | Counter | `upstream_service`, `error_type` | **Already defined** as `downstream_errors_total` |
| `gateway_http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | **Already defined** as `http_request_duration_seconds` — interceptor commented out |
| `gateway_active_requests` | Gauge | — | **Already defined** as `http_active_requests` |
| `gateway_request_size_bytes` | Histogram | `method`, `route` | **Already defined** |
| `gateway_response_size_bytes` | Histogram | `method`, `route` | **Already defined** |

> **Key finding:** All metrics are already coded in `MetricsService` (prom-client). Just uncomment `MetricsInterceptor` in `app.module.ts` and `MorganMiddleware`/`TraceContextMiddleware` in `configure()`. Zero new code needed for base metrics.

---

## 3. Authentication Service

**Path:** `authentication-service` | **Port:** 8000  
**Role:** User/staff accounts, login, RBAC, 2FA, password management  
**SDK Status:** ⚠️ Partial — SDK in main.ts + users.controller.ts; Winston + LoggingService(Kafka) still active

### Architecture

- HTTP-only server (no Kafka consumer despite consumer config present)
- Kafka producer to: profile-service (`user.created`, `user.updated`), logging-service
- External calls: access-management (role checks), notification (OTP/email), profile (create), Active Directory, NIDA, RRA
- **Three parallel logging mechanisms**: SDK ObservabilityLogger, Winston LoggerService, Kafka LoggingService

### Endpoints (key subset)

| Method | Path | Guard | Description |
|---|---|---|---|
| POST | `/api/users/create` | — | Create individual user account |
| POST | `/api/users/login` | — | Login (standard or AD by domain) |
| POST | `/api/users/validate-otp` | — | Validate OTP (branches to staff flow) |
| POST | `/api/users/forgot-password` | — | Forgot password |
| PATCH | `/api/users/reset-password/:token` | — | Reset password |
| POST | `/api/users/refresh-token` | — | Refresh access token |
| POST | `/api/users/complete-first-login` | — | Staff first-login (NID via NIDA) |
| POST | `/api/access/create-role` | AccessGuard | Create role |
| POST | `/api/access/manage-user-role` | AccessGuard | Assign/remove user role |
| POST | `/api/access/manage-role-permission` | AccessGuard | Assign/remove role permission |
| POST | `/api/access/manage-user-access` | AccessGuard | Block/unblock user |
| POST | `/api/access/create-business-user` | AccessGuard | Create business sub-user |
| POST | `/api/access/logout` | — | Logout |
| POST | `/api/staff/users` | AccessGuard | Create staff user |
| PUT | `/api/staff/users/:id/two-factor-auth` | AccessGuard | Toggle 2FA |

### Domain Events

| Event | When | Severity | Fields |
|---|---|---|---|
| `auth.login_succeeded` | Standard login success | info | `user_id`, `auth_type`, `ip_address` |
| `auth.login_failed` | Standard login failure | warn | `identifier`, `reason`, `ip_address`, `login_attempts` |
| `auth.ad_login_succeeded` | AD/staff login success | info | `user_id`, `sam_account_name`, `ip_address` |
| `auth.ad_login_failed` | AD/staff login failure | warn | `identifier`, `error_type` |
| `auth.otp_validated` | OTP validation success | info | `user_id`, `otp_type` (email/sms) |
| `auth.otp_failed` | OTP validation failure | warn | `identifier`, `reason` |
| `auth.account_created` | Individual user signup | info | `user_id`, `identification_type` |
| `auth.business_user_created` | Business sub-user creation | info | `user_id`, `business_id`, `created_by` |
| `auth.staff_user_created` | Staff user created | info | `staff_user_id`, `department_id`, `created_by` |
| `auth.password_reset_requested` | Forgot password triggered | info | `user_id` |
| `auth.password_reset_completed` | Password reset done | info | `user_id` |
| `auth.user_blocked` | Account blocked via manage-user-access | warn | `user_id`, `blocked_by` |
| `auth.user_unblocked` | Account unblocked | info | `user_id`, `unblocked_by` |
| `auth.role_created` | New role created | info | `role_name`, `created_by` |
| `auth.role_assigned` | Role assigned to user | info | `user_id`, `role_name`, `assigned_by` |
| `auth.role_removed` | Role removed from user | info | `user_id`, `role_name`, `removed_by` |
| `auth.two_factor_enabled` | 2FA toggled on | info | `user_id`, `auth_type` |
| `auth.two_factor_disabled` | 2FA toggled off | warn | `user_id`, `disabled_by` |
| `auth.first_login_completed` | Staff first login via NIDA | info | `staff_user_id`, `national_id_verified` |
| `auth.nida_verification_completed` | NIDA national ID check | info | `national_id` (masked), `result` |
| `auth.nida_verification_failed` | NIDA check failed | warn | `national_id` (masked), `error` |
| `auth.token_refreshed` | Token refresh issued | info | `user_id` |
| `auth.logout` | User logout | info | `user_id`, `device_id` |

**Gap:** `auth.login_succeeded`/`auth.login_failed` already exist in code but ONLY for standard login path. AD/staff login path in `staffUserService.loginWithPassword` does NOT emit these — inconsistent coverage.

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| AD connection failures | `active-directory.service.ts` | error | AD outages invisible today |
| External API call results (NIDA, RRA) | `external.apis.call.ts` | info/error | Currently 16x console.log/error |
| Profile service create/update failures | `profile.service.ts` | error | Silent catch blocks |
| Kafka event emission failures | `access.service.ts:1660,1706` | error | `user.created`/`user.updated` emit failures silently swallowed |
| Device login tracking | `LoggedInDevice` writes | info | Security audit trail |

**console.log to remove (20+ sites):**
- `external.apis.call.ts` — 16 sites (OTP mocks, NIDA/RRA errors)
- `active-directory.service.ts:122`
- `main.ts:27`, `logger.service.ts:300`
- `database-error-handler.ts:56`, `http.exception.filter.ts:35,42`
- `profile.service.ts:31,34,54`
- `staff-user.controller.ts:68`, `unit.service.ts:33,34`
- `access.service.ts:571,1660,1706,1972`

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `auth_login_total` | Counter | `method` (standard/ad), `result` (success/failure), `reason` | Login volume + failure rate |
| `auth_login_duration_seconds` | Histogram | `method`, `result` | Login latency (includes AD/NIDA calls) |
| `auth_otp_total` | Counter | `type` (email/sms), `action` (send/validate), `result` | OTP volume |
| `auth_account_created_total` | Counter | `type` (individual/business/staff) | Signup rate |
| `auth_token_refresh_total` | Counter | — | Token refresh frequency |
| `auth_external_api_duration_seconds` | Histogram | `service` (nida/rra/ad/notification/profile) | External call latency |
| `auth_external_api_errors_total` | Counter | `service`, `error_type` | External dependency failures |
| `auth_active_sessions` | Gauge | — | Count of active LoggedInDevice records |
| `auth_blocked_users_total` | Counter | — | Account blocks (security signal) |

---

## 4. Access Management Service

**Path:** `access-management-microservice` | **Port:** 8000  
**Role:** Route-level RBAC — "which role can call which API path"  
**SDK Status:** ⚠️ Partial — SDK wired in main.ts/app.module.ts, Winston still active

### Architecture

- HTTP-only (Kafka consumer fully commented out in main.ts)
- Redis cache for role-access lookups (hot path — every guarded request in every service)
- MSSQL via Sequelize
- **serviceName mismatch**: `main.ts` uses `'application-gateway'`, `app.module.ts` uses `'access-management-service'` — traces/logs will have inconsistent service attribution

### Endpoints

| Method | Path | Guard | Description |
|---|---|---|---|
| POST | `/api/role-access` | AuthGuard | **HOT PATH** — every service calls this to check route permissions |
| POST | `/api/role-access/all` | AuthGuard | List all role-access entries (admin) |
| POST | `/api/role-access/:roleName/bulk/:projectId/create` | AuthGuard | Bulk-grant role to routes |
| PATCH | `/api/role-access/:roleAccessId/manage-permission` | AuthGuard | Toggle grant/revoke |
| GET | `/api/routes` | AuthGuard | **Anti-pattern: GET that performs writes** — bulk-creates routes |
| POST | `/api/routes` | AuthGuard | List registered routes |

### Domain Events

| Event | When | Severity | Fields |
|---|---|---|---|
| `access.permission_granted` | Role granted access to route | info | `role_name`, `route_path`, `method`, `project_id`, `granted_by` |
| `access.permission_revoked` | Role access toggled to removed | warn | `role_name`, `route_path`, `method`, `revoked_by` |
| `access.permission_restored` | Role access toggled back to active | info | `role_name`, `route_path`, `method`, `restored_by` |
| `access.bulk_permission_granted` | Bulk-grant completed | info | `role_name`, `project_id`, `route_count`, `granted_by` |
| `access.routes_registered` | New API routes registered | info | `route_count`, `registered_by` |
| `access.authorization_check_failed` | Role-access lookup returned no match | warn | `role_name`, `method`, `path` |

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| Cache hits/misses on role-access lookup | `RoleAccessService.fetchOneByAttributes()` | debug | Performance insight on hot path |
| Redis connection failures | Cache manager errors | error | Cache failures degrade all services |
| Duplicate grant rejections | `create()` → 409 CONFLICT | warn | Audit trail |
| Dynamic path matching fallback | `matchPath()` | debug | Understand routing behavior |

**console.log to remove (3 sites):**
- `http.exception.filter.ts` (2 sites)
- `main.ts` (startup)

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `access_authorization_check_total` | Counter | `result` (granted/denied/error) | **Critical** — measures every auth check across fleet |
| `access_authorization_check_duration_seconds` | Histogram | `cache_hit` (true/false) | Latency of hot path |
| `access_cache_hit_ratio` | Gauge | — | Redis cache effectiveness |
| `access_permission_changes_total` | Counter | `action` (grant/revoke/restore/bulk) | Audit rate |
| `access_routes_registered_total` | Counter | — | Route registration rate |

---

## 5. Workflow Service

**Path:** `workflow-service` | **Port:** 8000  
**Role:** Generic workflow state machine engine — drives approvals for payments, applications, tenders, claims, reports  
**SDK Status:** ❌ Not migrated — NestJS Logger + Winston

### Architecture

- Complex state machine with `WorkflowEntity → Schema → Instance → Task → History` entity hierarchy
- Outbox pattern for Kafka publishing (6 topics, 1 defined but never emitted)
- NO correlation-ID propagation despite outbox having columns for it
- NO outbox retry mechanism for failed publishes
- One unauthenticated endpoint: `GET /task/:taskId`
- Single 4444-line service file contains all business logic

### Entity Lifecycle

```
WorkflowInstance: ACTIVE → COMPLETED | CANCELLED | ERROR
WorkflowTask:     READY → COMPLETED | REQUEST_INFO → READY (resume) → COMPLETED | CANCELLED | TIMED_OUT
WorkflowSchema:   DRAFT → PUBLISHED → DEPRECATED → RETIRED
WorkflowEntity:   NEW → ACTIVE → COMPLETED | CANCELLED | SUSPENDED
```

### Kafka Topics (Produced via Outbox)

| Topic | Trigger | Consumers |
|---|---|---|
| `WorkflowSchemaCreated` | Schema snapshot created | — |
| `WorkflowStarted` | Instance started | application-service |
| `WorkflowTaskReady` | Task created/resumed | — |
| `WorkflowTaskCompleted` | Task acted on (approve/reject/request-info) | payment-service, application-service, mel-service |
| `WorkflowCompleted` | Instance reached end state | payment-service, application-service |
| `WorkflowCancelled` | Instance cancelled | — |
| `WorkflowTaskReassigned` | **DEFINED BUT NEVER EMITTED** — dead topic | — |

### Domain Events

| Event | When | Severity | Fields |
|---|---|---|---|
| `workflow.instance_started` | `startInstance()` | info | `instance_id`, `schema_id`, `namespace`, `entity_type`, `entity_ref`, `started_by` |
| `workflow.instance_completed` | Instance reaches COMPLETED | info | `instance_id`, `namespace`, `entity_ref`, `duration_ms`, `step_count` |
| `workflow.instance_cancelled` | `cancelInstance()` | warn | `instance_id`, `entity_ref`, `cancelled_by`, `reason` |
| `workflow.instance_force_completed` | Admin force-complete | warn | `instance_id`, `entity_ref`, `forced_by`, `action` (approve/reject) |
| `workflow.task_created` | Task created in READY state | info | `task_id`, `instance_id`, `step_id`, `role_code`, `assignee` |
| `workflow.task_acted_on` | `actOnTask()` approve/reject/request-info | info | `task_id`, `instance_id`, `action`, `actor`, `has_comment` |
| `workflow.task_reassigned` | Task reassignment | info | `task_id`, `old_assignee`, `new_assignee`, `reassigned_by` |
| `workflow.task_resumed` | Task moved REQUEST_INFO → READY | info | `task_id`, `instance_id`, `resumed_by` |
| `workflow.schema_created` | New schema version registered | info | `schema_id`, `namespace`, `entity_type`, `version` |
| `workflow.outbox_publish_failed` | Kafka publish from outbox errored | error | `event_id`, `topic`, `attempts`, `error` |
| `workflow.bulk_action_completed` | Bulk approve/reject finished | info | `action`, `total`, `success_count`, `failed_count`, `skipped_count` |

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| State transition details | `actOnTask()` — each transition | info | Core state machine traceability |
| Join condition evaluation | `checkAndCreateTasksForJoinConditions` | debug | Debug multi-branch workflows |
| JSON-Logic evaluation results | `validateJsonLogic` | debug | Transition condition debugging |
| Outbox publish attempts | `OutboxListener` | info/error | Currently success=silent, failure=error |
| External staff lookup failures | `ExternalIntegrationService` | error | Multireview assignee resolution failures |
| Notification email failures | `WorkflowNotificationsService` | error | Task-ready/cancel email failures |
| Schema validation failures | `createEntitySchema()` Ajv | warn | Invalid schema submissions |

**console.log to remove (3 sites):**
- `main.ts:32` (startup)
- `http.exception.filter.ts:28,38` (exception dumps — redundant with Winston call right after)

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `workflow_instances_started_total` | Counter | `namespace`, `entity_type` | Volume by domain |
| `workflow_instances_completed_total` | Counter | `namespace`, `entity_type`, `result` (completed/cancelled/error) | Completion rates |
| `workflow_instance_duration_seconds` | Histogram | `namespace`, `entity_type` | End-to-end approval time |
| `workflow_tasks_created_total` | Counter | `namespace`, `step_id` | Task volume per step |
| `workflow_task_action_total` | Counter | `action` (approve/reject/request_info), `namespace` | Decision distribution |
| `workflow_task_duration_seconds` | Histogram | `namespace`, `step_id` | Time-to-act per step |
| `workflow_active_instances` | Gauge | `namespace` | Open workflows |
| `workflow_active_tasks` | Gauge | `namespace`, `state` (ready/claimed/request_info) | Task queue depth |
| `workflow_outbox_pending` | Gauge | — | Unsent outbox rows (ERR or NEW > N seconds) |
| `workflow_outbox_failures_total` | Counter | `topic` | Publish failure rate |
| `workflow_bulk_action_total` | Counter | `action`, `result` (success/failed/skipped) | Bulk operation outcomes |

---

## 6. Payment Service

**Path:** `payment-microservice` | **Port:** 8800  
**Role:** ECGF invoice payment management (NOT a generic payment gateway)  
**SDK Status:** ❌ Not migrated — Winston daily-rotate files

> Full analysis in [payment-service-analysis.md](payment-service-analysis.md)

### Payment Status Lifecycle

```
PENDING_REVIEW → APPROVED → RECONCILED (happy path)
PENDING_REVIEW → RETURNED_FOR_CLARIFICATION → RESUBMITTED → PENDING_REVIEW (clarification cycle)
PENDING_REVIEW → REJECTED (terminal)
```

### Domain Events (Summary)

| Event | When | Severity |
|---|---|---|
| `payment.submitted` | Payment proof submitted by PFI | info |
| `payment.confirmed` | Payment approved with confirmed amount | info |
| `payment.rejected` | Payment rejected via workflow | warn |
| `payment.clarification_requested` | Returned for clarification | info |
| `payment.resubmitted` | PFI resubmits after clarification | info |
| `payment.reconciled` | Payment reconciled (final) | info |
| `payment.workflow_started` | Workflow instance started for payment | info |
| `payment.workflow_resumed` | Workflow resumed after resubmission | info |
| `invoice.created` | Corporate invoice created | info |
| `invoice.pdf_generated` | Invoice PDF generated and uploaded | info |
| `invoice.pdf_generation_failed` | PDF generation error | error |

### Key Metrics (Summary)

| Metric | Type | Labels |
|---|---|---|
| `payment_submitted_total` | Counter | `payment_type`, `institution_id` |
| `payment_status_transitions_total` | Counter | `from_status`, `to_status` |
| `payment_amount_confirmed` | Histogram | `payment_type` |
| `invoice_pdf_generation_duration_seconds` | Histogram | — |
| `payment_workflow_duration_seconds` | Histogram | `outcome` |

### Security Concerns

- `console.log('rows', rows)` in `payment.service.ts` leaks full query results
- `proofOfPayment` base64 data handled without size validation
- `GET /api/payments/:id` and review endpoints have NO access guard

---

## 7. Application Service

**Path:** `application-service` | **Port:** 8000  
**Role:** Core platform domain — loan/guarantee applications, tenders/procurement, claims, PFI onboarding, simulations  
**SDK Status:** ⚠️ Partial — SDK in 7/20 controllers, rest use NestJS Logger + console (27 console sites)

### Architecture

- **Largest service**: 20 controllers, ~40 entities
- Central workflow-event fan-out: consumes `WorkflowCompleted`, `WorkflowStarted`, `WorkflowTaskCompleted` and routes to 7 domain approval services
- Fan-out HTTP deps: 15+ internal services
- Half-migrated SDK — biggest inconsistency in fleet

### Domain Modules

| Module | Controllers | Key Entities |
|---|---|---|
| Loan Applications | `applications.controller.ts`, `loan-application.controller.ts` | Application, Applicant, ApplicationProduct, BankInfo |
| Guarantee Applications | `guarantee-application.controller.ts`, `guarantee.controller.ts` | GuaranteeApplication (amount/fee/coverage/collateral) |
| Guarantee Loans | `guarantee-loans.controller.ts` | GuaranteeLoan |
| Tenders/Procurement | `tenders.controller.ts`, `requisitions.controller.ts`, `procurement-plan.controller.ts`, `bids/bid.controller.ts` | Tender, TenderLot, Requisition, RequisitionLine, ProcurementPlan, Bid, TATTrackingEvent |
| Claims | `claims.controller.ts` | Claim (submitted/resubmitted/underReview/approved/rejected/paid/cancelled/needMoreInfo) |
| PFI Onboarding | `financial-institutions.controller.ts` | FinancialInstitution (TIN, cluster, capital, nplRatio, guaranteeLine) |
| Simulation | `simulation.controller.ts` | 11 entities: crops, seeds, fertilizers, pesticides, labor, simulations, inputs, results |
| Individual Reports | `individual-reports.controller.ts` | IndividualGuaranteeReport |
| Restructuring | `restructuring.controller.ts` | Restructuring |
| Forms | `forms/form.controller.ts` + Kafka form controllers | FormField, FormGroup, FormOption |
| External API | `external-api.controller.ts` | Partner-facing disbursement/bank-info API |

### Domain Events

#### Loan & Guarantee Applications

| Event | When | Severity | Fields |
|---|---|---|---|
| `application.submitted` | Loan application submitted | info | `application_id`, `applicant_id`, `bundle_id`, `loan_amount` |
| `application.approved` | Workflow approval | info | `application_id`, `approved_by` |
| `application.rejected` | Workflow rejection | warn | `application_id`, `rejected_by`, `reason` |
| `application.needs_more_info` | Clarification requested | info | `application_id` |
| `guarantee_application.submitted` | Guarantee application submitted | info | `application_id`, `guarantee_amount`, `institution_id` |
| `guarantee_application.approved` | Guarantee approved | info | `application_id`, `coverage_rate` |
| `guarantee_application.rejected` | Guarantee rejected | warn | `application_id`, `reason` |
| `guarantee_loan.initiated` | Guarantee loan initiated | info | `loan_id`, `institution_id` |
| `guarantee_loan.submitted` | Guarantee loan submitted for review | info | `loan_id` |

#### Tenders & Procurement

| Event | When | Severity | Fields |
|---|---|---|---|
| `tender.created` | Tender created | info | `tender_id`, `reference_no`, `category_code`, `estimated_amount` |
| `tender.published` | Tender publication released | info | `tender_id`, `publication_date`, `submission_deadline` |
| `tender.closed` | Tender closed | info | `tender_id` |
| `requisition.submitted` | Requisition submitted | info | `requisition_id`, `department`, `requester` |
| `requisition.approved` | Requisition approved via workflow | info | `requisition_id` |
| `bid.submitted` | Bid submitted for tender lot | info | `bid_id`, `tender_lot_id`, `supplier_id`, `amount` |
| `procurement_plan.submitted` | Procurement plan submitted | info | `plan_id`, `department` |

#### Claims & Restructuring

| Event | When | Severity | Fields |
|---|---|---|---|
| `claim.created` | Claim in default submitted | info | `claim_reference_id`, `log_reference` |
| `claim.status_changed` | Claim status transition | info | `claim_reference_id`, `from_status`, `to_status`, `changed_by` |
| `claim.approved` | Claim approved | info | `claim_reference_id` |
| `claim.paid` | Claim payment processed | info | `claim_reference_id`, `amount` |
| `restructuring.submitted` | Guarantee restructuring request | info | `reference_id`, `log_reference` |

#### PFI Onboarding

| Event | When | Severity | Fields |
|---|---|---|---|
| `pfi.onboarded` | Financial institution onboarded | info | `institution_id`, `name`, `tin`, `cluster` |
| `pfi.submitted` | PFI application submitted for review | info | `institution_id` |
| `pfi.status_changed` | PFI status transition | info | `institution_id`, `from_status`, `to_status` |

#### Simulation

| Event | When | Severity | Fields |
|---|---|---|---|
| `simulation.calculated` | Kataza loan/agri simulation run | info | `simulation_id`, `type` (loan/agri), `duration_ms` |
| `simulation.upi_validated` | UPI validation completed | info | `upi`, `result` |

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| Claim creation SQL errors | `claims.service.ts:744-750` | error | Currently dumps raw `error.parent.errors` via console |
| Workflow event fan-out routing | `workflow-events.controller.ts` | info | Central dispatch to 7+ services — trace which handler ran |
| External service call failures | All HTTP client calls | error | 15+ downstream dependencies |
| TAT/SLA checks | `internal-procurement-tat.controller.ts` | info | Turnaround-time compliance |
| Scheduled tender publications | `internal-tenders.controller.ts` | info | Cron-triggered, no trace context |
| Bank membership checks | `check/membership` endpoint | info | Compliance-relevant |
| Account balance decryption | `decrypt-account-balance` endpoint | info | Security audit |

**console.log to remove (27 sites):**
- `claims.service.ts` — 7 sites (raw SQL error dumps, claim creation debug)
- `guarantee-loans.service.ts:989,1005,1017` (`console.log("applicant", applicant)` — PII leak)
- `guarantee-loans.controller.ts:24`
- `products.service.ts:35` (`'------------------------------->'` debug)
- `tenders.service.ts:1438,1530`, `tenders-approval.service.ts:211`
- `applications.service.ts:1839`
- `notifications.service.ts:303,342`
- `utils/index.ts:547`
- `main.ts` (2 sites)

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `application_submitted_total` | Counter | `type` (loan/guarantee/guarantee_loan), `bundle_id` | Application volume |
| `application_status_transitions_total` | Counter | `type`, `from_status`, `to_status` | Status flow |
| `application_processing_duration_seconds` | Histogram | `type`, `outcome` | End-to-end time |
| `tender_created_total` | Counter | `category_code`, `method_code` | Tender volume |
| `tender_status_total` | Counter | `status` | Distribution |
| `bid_submitted_total` | Counter | — | Bid volume |
| `claim_created_total` | Counter | `status` | Claim volume |
| `claim_amount_total` | Counter | — | Claim value (monetary tracking) |
| `pfi_onboarded_total` | Counter | `cluster` | PFI growth |
| `simulation_duration_seconds` | Histogram | `type` (loan/agri) | Kataza performance |
| `workflow_event_fanout_total` | Counter | `topic`, `target_handler` | Workflow event routing volume |
| `workflow_event_fanout_errors_total` | Counter | `topic`, `target_handler` | Handler failures |

---

## 8. Configuration Service

**Path:** `configuration-microservice` | **Port:** 8000  
**Role:** JSON-schema registry + generic config item CRUD + config-item linking  
**SDK Status:** ✅ Best in fleet — SDK with ObservabilityLogger, traceId/spanId/userId in every handler

### Architecture

- SDK properly integrated — `ObservabilityLogger` injected, structured logging with trace context
- **BUT** legacy `LoggerService` (Winston + Kafka log shipping to `LOGGING_MICROSERVICE`) still wired
- Outbox pattern for config-change Kafka publishing
- Entities: `ConfigItem`, `ConfigLink`, `SchemaRegistry`, `OutboxConfiguration`

### Endpoints

| Method | Path | Guard | Description |
|---|---|---|---|
| GET | `/api/configuration/v1/public-api/schemas` | BasicAuth | Fetch public schema |
| GET | `/api/configuration/v1/public/:ns/:type` | BasicAuth | Fetch public config item |
| POST | `/api/configuration/v1/:ns/:type` | AccessGuard | Create config item |
| PUT | `/api/configuration/v1/:ns/:type/:code` | AccessGuard | Update config item |
| DELETE | `/api/configuration/v1/:ns/:type/:code` | AccessGuard | Delete config item |
| GET | `/api/configuration/v1/:ns/:type/:code/links` | AccessGuard | Get linked items |
| POST | `/api/configuration/v1/:ns/:type/:code/links/...` | AccessGuard | Create link |
| DELETE | `/api/configuration/v1/:ns/:type/:code/links/...` | AccessGuard | Delete link |
| GET | `/api/configuration/v1/:ns/:type/search` | AccessGuard | Search items |
| POST | `/api/configuration/v1/schema` | AccessGuard | Register JSON schema |
| GET | `/api/configuration/v1/schema` | AccessGuard | Fetch schema |

### Domain Events

| Event | When | Severity | Fields |
|---|---|---|---|
| `config.item_created` | Config item created | info | `namespace`, `resource_type`, `code`, `schema_version`, `created_by` |
| `config.item_updated` | Config item updated | info | `namespace`, `resource_type`, `code`, `version`, `updated_by` |
| `config.item_deleted` | Config item deleted | warn | `namespace`, `resource_type`, `code`, `deleted_by` |
| `config.link_created` | Config item linked | info | `namespace`, `relation`, `from_code`, `to_code` |
| `config.link_deleted` | Config link removed | info | `namespace`, `relation`, `from_code`, `to_code` |
| `config.schema_registered` | New JSON schema version | info | `schema_id`, `namespace`, `resource_type`, `version`, `compat_mode` |
| `config.schema_validation_failed` | Item failed schema validation | warn | `namespace`, `resource_type`, `code`, `errors` |
| `config.outbox_publish_failed` | Outbox Kafka publish error | error | `event_id`, `type`, `attempts` |

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| Schema compatibility checks | `SchemaRegistry` compat validation | info | Backward/forward compat decisions |
| Optimistic concurrency conflicts | `rowVersion` check failures | warn | Concurrent update detection |
| Outbox publish retries | `kafka-outbox-publisher.service.ts` | warn | Event delivery reliability |

**console.log to remove (7 sites):**
- `main.ts:45`, `utils/index.ts:72` (decryption failure)
- `configuration.service.ts:1025,1209,1211` (transaction rollback)
- `filters/http.exception.filter.ts:25,35`

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `config_item_operations_total` | Counter | `namespace`, `operation` (create/update/delete) | Config change rate |
| `config_schema_registrations_total` | Counter | `namespace`, `compat_mode` | Schema evolution rate |
| `config_schema_validation_failures_total` | Counter | `namespace`, `resource_type` | Invalid config submissions |
| `config_link_operations_total` | Counter | `relation`, `operation` (create/delete) | Linking activity |
| `config_outbox_pending` | Gauge | — | Unsent outbox rows |
| `config_outbox_failures_total` | Counter | `event_type` | Publish failure rate |
| `config_search_duration_seconds` | Histogram | `namespace` | Search performance |

---

## 9. Profile Service

**Path:** `profile-microservice` | **Port:** 8000  
**Role:** Business/customer/representative profiles — onboarding driven by Kafka events from auth-service  
**SDK Status:** ❌ None — pure console.log (25+ sites)

### Architecture

- Onboarding pipeline: consumes Kafka events `user.created`, `customer.individual.created`, `representative.created`
- Also exposes Kafka RPC: `business.findByRegistrationNumber`
- External deps: access-management, access-control, file-server (signature upload)
- Entities: `Business`, `Customer`, `Representative`, `CustomerDocument`

### Endpoints

| Method | Path | Guard | Description |
|---|---|---|---|
| POST | `/api/business/create-business` | — | Create business |
| GET | `/api/business/all` | AccessGuard | List all businesses |
| GET | `/api/business/representative` | — | Get current user's representative |
| POST | `/api/business/batch` | — | Bulk lookup by IDs |
| GET | `/api/business/:id` | — | Get business by ID |
| GET | `/api/business/identification/:regNum` | — | Lookup by registration number |
| POST | `/api/profile/create-individual` | — | Create individual customer |
| GET | `/api/profile/individual` | — | Get current user's customer profile |
| PATCH | `/api/profile/individual/:id` | — | Update customer profile |
| PATCH | `/api/profile/update-own-profile` | — | Update own profile (multipart signature) |

### Domain Events

| Event | When | Severity | Fields |
|---|---|---|---|
| `profile.business_created` | Business record created | info | `business_id`, `registration_number`, `business_name` |
| `profile.customer_created` | Individual customer created | info | `customer_id`, `identification_number` (masked) |
| `profile.representative_created` | Business representative registered | info | `representative_id`, `business_id` |
| `profile.customer_updated` | Customer profile updated | info | `customer_id`, `updated_fields[]` |
| `profile.signature_uploaded` | Signature file uploaded | info | `customer_id` |
| `profile.business_not_found` | Kafka event received for nonexistent business (race condition) | warn | `registration_number`, `event_type` |
| `profile.kafka_event_received` | Inbound Kafka consumer event | info | `topic`, `event_type` |
| `profile.kafka_event_failed` | Kafka event processing error | error | `topic`, `event_type`, `error` |

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| Kafka consumer event processing | `business-kafka.controller.ts`, `customer-kafka.controller.ts` | info/error | Currently 11 console.log/error sites |
| Business ID resolution race | `resolveBusinessId` skip logic | warn | Business-not-found-yet handling |
| File server upload results | Signature upload path | info/error | External call result |
| External service call failures | axios calls | error | Dependency failures |

**console.log to remove (25+ sites):**
- `business-kafka.controller.ts` (3), `business.service.ts` (6)
- `customer-kafka.controller.ts` (8), `customer.service.ts` (4)
- `http.exception.filter.ts` (2), `main.ts` (2)

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `profile_created_total` | Counter | `type` (business/customer/representative) | Onboarding rate |
| `profile_updated_total` | Counter | `type` | Update rate |
| `profile_kafka_events_received_total` | Counter | `topic`, `result` (success/failure) | Kafka consumer health |
| `profile_kafka_event_processing_duration_seconds` | Histogram | `topic` | Consumer processing time |
| `profile_signature_uploads_total` | Counter | `result` (success/failure) | Signature upload rate |
| `profile_external_call_duration_seconds` | Histogram | `service` (access_mgmt/file_server) | Dependency latency |

---

## 10. Product Service

**Path:** `product-microservice` | **Port:** 8000  
**Role:** Product/bundle/category/project catalog — loan and guarantee product configuration  
**SDK Status:** ❌ None — Winston + Kafka log shipping (bespoke pre-SDK tracing)

### Architecture

- Uses custom pre-SDK tracing: `Trace`/`Span` decorators, `createLoggingContextWithId` helper generating local `traceId`/`spanId`/`requestId` (not OTel)
- Winston `LoggerService` instantiated per-controller with Kafka log shipping
- External deps: access-management, configuration-service
- Entities: `Product`, `Bundle`, `ProductCategory`, `Project`, `ProductMapping`

### Endpoints

| Method | Path | Guard | Description |
|---|---|---|---|
| POST | `/api/products` | AccessGuard | Create product |
| GET | `/api/products/:id` | AccessGuard | Get product |
| POST | `/api/products/all` | AccessGuard | List products (filtered) |
| PATCH | `/api/products/:id` | AccessGuard | Update product |
| POST | `/api/products/bundles` | AccessGuard | Create bundle |
| POST | `/api/products/bundles/all` | AccessGuard | List bundles |
| POST | `/api/products/categories/all` | AccessGuard | List categories |
| POST | `/api/products/mapping` | AccessGuard | Create product↔bundle mapping |

### Product Status Lifecycle

```
Pending → Approved
Pending → Rejected
```

### Domain Events

| Event | When | Severity | Fields |
|---|---|---|---|
| `product.created` | Product created | info | `product_id`, `name`, `type` (cash/material), `product_type` (loan/guarantee), `currency` |
| `product.updated` | Product updated | info | `product_id`, `updated_fields[]`, `updated_by` |
| `product.status_changed` | Status transition | info | `product_id`, `from_status`, `to_status` |
| `bundle.created` | Bundle created | info | `bundle_id`, `category_id`, `name` |
| `product.mapping_created` | Product linked to bundle | info | `product_id`, `bundle_id` |

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| Cache invalidation | `product.service.ts:479` | debug | Currently console.log |
| Product pricing/config changes | `update` handler | info | Audit trail for financial product changes |

**console.log to remove (4 sites):**
- `main.ts:34`, `product.service.ts:479` (cache)
- `http.exception.filter.ts:30,40`

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `product_created_total` | Counter | `type` (cash/material), `product_type` (loan/guarantee) | Product catalog growth |
| `product_status_total` | Gauge | `status` (pending/approved/rejected) | Product approval pipeline |
| `bundle_created_total` | Counter | — | Bundle creation rate |
| `product_mapping_total` | Counter | — | Product-to-bundle linking rate |
| `product_cache_invalidation_total` | Counter | — | Cache churn visibility |

---

## 11. Job Scheduler

**Path:** `uno-job-scheduler` | **Port:** 8000  
**Role:** Scheduled jobs — bank integration (SACCO/RIM), invoice generation, guarantee framework  
**SDK Status:** ⚠️ Partial — SDK at bootstrap, cron jobs all use console.log (18 sites)

### Architecture

- All business logic in `@Cron` jobs — NO request context, NO trace IDs
- Direct HTTP to external bank gateways (SACCO/RIM via Minecofin)
- Shares Application schema entities (same DB as application-service)
- `StatusJobs` table is a hand-rolled job audit log — natural fit for real observability

### Cron Jobs

| Job | Schedule | What It Does |
|---|---|---|
| `GuaranteeFrameworkService` (3 jobs) | `45 * * * *` (hourly) | Generate guarantee frameworks, letters of guarantee, guarantee invoices |
| `InvoiceService` | Hourly | Generate invoices |
| `sendApplicationsToMinecofin` | Every 30 min | Push pending loan applications to SACCO/RIM bank gateways |
| `saccoLoanStatus` | Every 30 min | Poll SACCO bank for loan status updates |
| `rimLoanStatus` | Every 30 min | Poll RIM bank for loan status updates |
| `checkSaccoMissed` | Daily midnight | Reconciliation sweep for missed status updates |

### Domain Events

| Event | When | Severity | Fields |
|---|---|---|---|
| `job.started` | Cron job begins | info | `job_name`, `schedule`, `run_id` |
| `job.completed` | Cron job finishes | info | `job_name`, `run_id`, `duration_ms`, `records_processed` |
| `job.failed` | Cron job errors | error | `job_name`, `run_id`, `error`, `records_processed` |
| `bank.application_submitted` | Application sent to Minecofin | info | `application_id`, `bank_classification` (SACCO/RIM), `external_id` |
| `bank.application_submission_failed` | Bank gateway rejected submission | error | `application_id`, `bank_classification`, `error` |
| `bank.status_received` | Status update received from bank | info | `application_id`, `bank_name`, `old_status`, `new_status` |
| `bank.status_poll_completed` | Status polling batch finished | info | `bank_classification`, `total_checked`, `updates_found` |
| `bank.reconciliation_completed` | Missed-status sweep done | info | `total_checked`, `mismatches_found` |
| `invoice.generated` | Invoice generated by scheduler | info | `invoice_id`, `application_id` |
| `guarantee.framework_generated` | Guarantee framework document generated | info | `application_id` |
| `guarantee.letter_generated` | Letter of guarantee generated | info | `application_id` |

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| Every cron job start/end with timing | All `@Cron` methods | info | Replace hand-rolled `StatusJobs` table |
| Bank gateway request/response | `external-integration.service.ts`, `loan.gateway.ts` | info/error | Currently 10 console sites with `'===rim-response==>'` markers |
| Application status update results | `updateStatusData` Sequelize transaction | info | DB write results for bank status sync |
| Connection failures to bank gateways | axios calls | error | External dependency monitoring |
| Records-per-batch counts | Each polling job | info | Volume tracking |

**console.log to remove (18 sites):**
- `guarantee-framework.service.ts` (6) — JSON.stringify result dumps
- `invoice.service.ts` (2)
- `external-integration.service.ts` (8) — ad-hoc markers like `'===rim-response==>'`, `'===getting error while sending the application [RECONCILIATION] ===>'`
- `loan.gateway.ts` (2)

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `job_execution_total` | Counter | `job_name`, `result` (success/failure) | Job reliability |
| `job_execution_duration_seconds` | Histogram | `job_name` | Job performance |
| `job_records_processed_total` | Counter | `job_name` | Volume per run |
| `bank_submissions_total` | Counter | `bank_classification`, `result` (success/failure) | Bank integration health |
| `bank_status_polls_total` | Counter | `bank_classification` | Polling rate |
| `bank_status_updates_received_total` | Counter | `bank_classification`, `from_status`, `to_status` | Status update volume |
| `bank_reconciliation_mismatches_total` | Counter | `bank_classification` | Data quality signal |
| `bank_gateway_request_duration_seconds` | Histogram | `bank_classification`, `operation` (submit/poll) | Gateway latency |
| `invoice_generated_total` | Counter | — | Invoice generation rate |
| `guarantee_documents_generated_total` | Counter | `type` (framework/letter/invoice) | Document generation rate |

---

## 12. MEL Service

**Path:** `mel-service` | **Port:** 3000  
**Role:** Monitoring, Evaluation & Learning — program lifecycle, KPI tracking, periodic report submission/approval  
**SDK Status:** ❌ None — NestJS built-in Logger (most consistent non-SDK service)

### Architecture

- Program lifecycle: `draft → active → inactive → archived`
- Report submission with reporting-period windows and deadline tracking
- Multi-stage review: officer → coordinator (driven partly by workflow-service via Kafka)
- Kafka consumer: `WorkflowTaskCompleted` from workflow-service
- Kafka producer: `WELCOME_PACKAGE` topic
- Excel upload parsing, PDF generation
- External deps: access-management, file-server, notification-service

### Report Status Lifecycle

```
draft → pending_review → officer_approved → approved (happy path)
draft → pending_review → rejected
draft → pending_review → action_required → pending_review (revision cycle)
```

### Endpoints (key subset)

| Method | Path | Guard | Description |
|---|---|---|---|
| POST | `/programs` | — | Create program |
| PUT | `/programs/:id/status` | — | Change program status |
| POST | `/programs/:id/reports` | — | Submit periodic report |
| POST | `/reports/search` | — | Search reports |
| POST | `/reports/:id/review` | — | Review report (approve/reject/action-required) |
| GET | `/reports/:id/files/:templateId/download` | — | Download report file |
| POST | `/kpis` | — | Create KPI |
| POST | `/kpis/import` | — | Bulk import KPIs |
| POST | `/donors/search` | — | Search donors |
| POST | `/templates` | — | Create report template |
| POST | `/mel/forms` | — | Create form |

### Domain Events

| Event | When | Severity | Fields |
|---|---|---|---|
| `mel.program_created` | Program created | info | `program_id`, `name`, `type`, `donor`, `total_budget` |
| `mel.program_status_changed` | Program lifecycle transition | info | `program_id`, `from_status`, `to_status`, `changed_by` |
| `mel.report_submitted` | Periodic report submitted | info | `report_id`, `program_id`, `reporting_period`, `deadline_status` (on_time/delayed) |
| `mel.report_reviewed` | Report approved/rejected/action-required | info | `report_id`, `decision`, `reviewer`, `reviewer_role` (officer/coordinator) |
| `mel.report_overdue` | Report past deadline window | warn | `program_id`, `reporting_period`, `days_overdue` |
| `mel.kpi_created` | KPI indicator defined | info | `kpi_id`, `indicator_code`, `target` |
| `mel.kpi_bulk_imported` | Batch KPI import completed | info | `program_id`, `count`, `source` (excel) |
| `mel.form_created` | Evaluation form created | info | `form_id`, `title`, `questions_count` |
| `mel.donor_created` | Donor registered | info | `donor_id`, `name` |
| `mel.template_created` | Report template created | info | `template_id`, `name` |
| `mel.workflow_task_processed` | Kafka workflow event processed | info | `task_id`, `action`, `report_id` |
| `mel.excel_parse_failed` | Excel report upload parse error | error | `report_id`, `error` |
| `mel.pdf_generated` | Report PDF generated | info | `report_id` |

### Technical Logging

| What to Log | Where | Level | Why |
|---|---|---|---|
| Report submission with deadline tracking | Programs/reports flow | info | Compliance — on_time vs delayed submissions |
| Workflow event Kafka consumption | `ReportWorkflowEventsController` | info/error | External event processing |
| Excel parse results | `report-excel-parser.ts` | info/error | Bulk data import audit |
| PDF generation timing | `pdf.generator.ts` | info | Performance tracking |
| File upload/download to file-server | Service calls | info/error | External dependency |
| Notification send results | notification service calls | info/error | Communication delivery |

**console.log to remove (3 sites):**
- `main.ts` (startup)
- `http.exception.filter.ts` (2)

### Prometheus Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `mel_programs_total` | Gauge | `status` (draft/active/inactive/archived) | Program distribution |
| `mel_reports_submitted_total` | Counter | `deadline_status` (on_time/delayed) | Submission compliance |
| `mel_reports_reviewed_total` | Counter | `decision` (approved/rejected/action_required) | Review pipeline |
| `mel_report_review_duration_seconds` | Histogram | `reviewer_role` | Review latency |
| `mel_kpis_imported_total` | Counter | `source` (manual/excel) | KPI data intake |
| `mel_excel_parse_duration_seconds` | Histogram | — | Parse performance |
| `mel_pdf_generation_duration_seconds` | Histogram | — | PDF gen performance |
| `mel_workflow_events_processed_total` | Counter | `result` (success/failure) | Kafka consumer health |

---

## 13. Cross-Cutting Concerns

### Legacy Winston Logger Pattern (Remove from All)

These services all have near-identical `src/logger/logger.service.ts` (Winston + daily-rotate + optional Kafka):

| Service | Also Has SDK? | Action |
|---|---|---|
| authentication-service | ⚠️ Yes | Remove Winston, consolidate to SDK |
| access-management-service | ⚠️ Yes | Remove Winston, consolidate to SDK |
| api-gateway | ⚠️ Yes | Remove Winston, consolidate to SDK |
| workflow-service | ❌ No | Migrate to SDK, then remove Winston |
| payment-service | ❌ No | Migrate to SDK, then remove Winston |
| configuration-service | ✅ Yes | Remove Winston + Kafka log shipping |
| product-service | ❌ No | Migrate to SDK, then remove Winston |
| profile-service | ❌ No (has unused Winston) | Migrate to SDK, delete unused Winston |
| mel-service | ❌ No (has unused Winston) | Migrate to SDK, delete unused Winston |

### Dead Kafka Log-Shipping Pattern (Remove)

Services with `logMessage()` / Kafka `logging.info`/`logging.warn` emission to a `LOGGING_MICROSERVICE`:

- authentication-service (`LoggingService` — appears unused)
- access-management-service (commented out `logMessage()`)
- configuration-service (active — still ships to Kafka)
- product-service (active — Kafka log shipping)

These predate the observability SDK and should be removed once SDK domain events replace them.

### serviceName Mismatches

| Service | main.ts | app.module.ts | Fix |
|---|---|---|---|
| access-management-service | `'application-gateway'` | `'access-management-service'` | Align to `'access-management-service'` |

### Unguarded Endpoints (Security Audit)

| Service | Endpoint | Risk |
|---|---|---|
| workflow-service | `GET /task/:taskId` (`@Public()`) | Unauthenticated task data access |
| payment-service | `GET /api/payments/:id` | No AccessGuard |
| payment-service | `POST /api/payments/:id/confirm` | No AccessGuard |
| payment-service | `POST /api/payments/:id/request-clarification` | No AccessGuard |
| payment-service | `POST /api/invoices/corporates` | No AccessGuard |

### Correlation ID Propagation Gap

No service currently propagates correlation IDs end-to-end:
- api-gateway generates `x-trace-id`/`x-span-id` in `AxiosService.buildHeaders()` but `TraceContextMiddleware` is commented out
- workflow-service outbox has `correlationId`/`causationId` columns but they're never populated
- No service reads incoming correlation headers

**Fix:** Enable `TraceContextMiddleware` in api-gateway → SDK auto-propagates via Pino context → each service's SDK reads/forwards

---

## 14. Implementation Priority

### Phase 1: Quick Wins (1-2 weeks)

1. **API Gateway — Uncomment existing middleware/interceptors**
   - Uncomment `MetricsInterceptor`, `MorganMiddleware`, `TraceContextMiddleware` in `app.module.ts`
   - Fix serviceName in access-management-service `main.ts`
   - Impact: Immediately get request metrics + trace propagation for entire platform

2. **Remove console.log/error across all services** (100+ sites)
   - Biggest security wins: payment-service `console.log('rows', rows)`, application-service `console.log("applicant", applicant)`
   - Replace with SDK `logger.error()` or `logger.warn()` as appropriate

3. **Configuration Service — Remove legacy Winston + Kafka log shipping**
   - Already has SDK — just remove parallel pipeline

### Phase 2: Critical Service Migration (2-4 weeks)

4. **Workflow Service → SDK migration**
   - Highest domain value — drives approvals for 7+ services
   - Add correlation-ID population to outbox
   - Add outbox retry mechanism

5. **Application Service — Complete SDK migration**
   - 13/20 controllers still unmigrated
   - Claims service SQL error logging is a data leak
   - Central workflow fan-out needs structured event logging

6. **Job Scheduler — SDK + structured job logging**
   - Cron jobs are biggest blind spot — no trace context, no structured output
   - Replace `StatusJobs` table with proper metrics
   - Replace `'===rim-response==>'` markers with structured logs

### Phase 3: Full Fleet (4-6 weeks)

7. **Authentication Service — Consolidate 3 loggers to SDK**
   - Extend domain events to AD login path
   - Remove Winston + dead LoggingService

8. **Payment Service → SDK migration**
   - Full analysis in [payment-service-analysis.md](payment-service-analysis.md)

9. **Profile Service → SDK migration**
   - No SDK at all — start from scratch
   - 25+ console sites to replace

10. **Product Service → SDK migration**
    - Remove bespoke tracing (`Trace`/`Span` decorators) in favor of OTel
    - Remove Kafka log shipping

11. **MEL Service → SDK migration**
    - Cleanest non-SDK service (NestJS Logger is structured)
    - Report deadline tracking needs domain events

### Phase 4: Platform Hardening

12. **API Gateway — Add rate limiting + circuit breaker**
    - Currently zero resilience patterns
    - Add domain events for circuit breaker state changes

13. **End-to-end correlation ID propagation**
    - api-gateway → downstream services → Kafka events → consumers

14. **Unguarded endpoint audit + remediation**
    - Payment and workflow endpoints without AccessGuard
