# Endpoint Inventory & Observability Tracking

> Per-service endpoint inventory for observability migration.
> Each service (or domain within large services) produces a separate CSV sheet. This README tracks progress, summarizes findings, and defines migration order.

## Service Overview

| Property | Value |
|---|---|
| Service | application-service |
| Framework | NestJS + Sequelize ORM |
| Database | PostgreSQL (6 schemas: Application, Form, Simulation, Guarantee, Tender, Loan) |
| Transport | HTTP + Kafka (dual) |
| Caching | Redis |
| Patterns | Transactional outbox, SELECT FOR UPDATE, SKIP LOCKED |
| Domains | ECGF (113 endpoints), E-Procurement (99 endpoints), Cross-cutting (4 handlers) |
| Total Endpoints | 216 (113 + 99 + 4) |
| SDK Branch | `ch-add-logger-sdk` |
| SDK Version | v2.0.0 |
| SDK Status | Installed, ObservabilityModule wired |

## Domain Progress

| Domain | CSV File | Endpoints | Status | Reviewed |
|---|---|---|---|---|
| ECGF (Export Credit Guarantee Fund) | [application-ecgf.csv](application-ecgf.csv) | 113 | ✅ Complete | ⏳ Pending |
| E-Procurement | [application-eproc.csv](application-eproc.csv) | 99 | ✅ Complete | ⏳ Pending |
| Cross-cutting (outbox, docs) | [application-crosscutting.csv](application-crosscutting.csv) | 4 | ✅ Complete | ⏳ Pending |

---

## ECGF Domain Summary

**Export Credit Guarantee Fund** — Core BRD guarantee business covering PFI onboarding, guarantee applications, loan applications, claims, individual reports, restructuring, simulation, forms, and workflow events.

### Endpoint Distribution

| Sub-domain | HTTP | Kafka | Total | Critical | P0 |
|---|---|---|---|---|---|
| Guarantee Applications | 12 | 0 | 12 | 3 | 2 |
| Guarantee Documents (GFA/LoG/Invoice) | 7 | 0 | 7 | 4 | 4 |
| Guarantee Loans | 8 | 0 | 8 | 3 | 3 |
| PFI Onboarding | 10 | 0 | 10 | 2 | 2 |
| Loan Applications | 9 | 0 | 9 | 3 | 3 |
| Claims | 11 | 0 | 11 | 2 | 2 |
| Individual Reports | 10 | 0 | 10 | 2 | 2 |
| Restructuring | 5 | 0 | 5 | 1 | 1 |
| External API | 3 | 0 | 3 | 0 | 0 |
| Workflow Events | 0 | 7 | 7 | 2 | 2 |
| Forms (HTTP) | 9 | 0 | 9 | 0 | 0 |
| Forms (Kafka) | 0 | 10 | 10 | 0 | 0 |
| Simulation (Kataza) | 9 | 0 | 9 | 1 | 1 |
| Applications (Kafka) | 0 | 2 | 2 | 0 | 0 |
| Health | 1 | 0 | 1 | 0 | 0 |
| **Total** | **94** | **19** | **113** | **21** | **21** |

### Criticality Distribution

| Criticality | Count | % |
|---|---|---|
| Critical | 21 | 18.6% |
| High | 28 | 24.8% |
| Medium | 33 | 29.2% |
| Low | 31 | 27.4% |

### Priority Distribution

| Priority | Count | % | Description |
|---|---|---|---|
| P0 | 21 | 18.6% | Critical path, security vulnerabilities, financial operations |
| P1 | 14 | 12.4% | Important state transitions, audit trails, external dependencies |
| P2 | 25 | 22.1% | Admin views, listing endpoints, moderate business value |
| P3 | 53 | 46.9% | Read-only, static data, low-frequency admin ops |

### 🔴 Security Findings

| Finding | Endpoints | Severity |
|---|---|---|
| **4 UNPROTECTED public endpoints** generating/processing financial/legal documents | `generate/agreement`, `generate/letter-of-guarantee`, `generate/generate-invoice`, `generate/generate-invoice/:applicationId` (single invoice is protected, batch is not) | **CRITICAL** |
| No ownership filtering on claim data | `api/claims/all`, `api/claims/:claimReferenceId/public` | HIGH |
| API key endpoints (External API) — key usage not tracked | 3 endpoints | MEDIUM |
| Kafka handlers with no auth guard | `GetOptionsGroups` form handler | LOW |

**The 4 unprotected endpoints are the highest-priority security fix in the entire ECGF domain.** These endpoints:
- Generate legally binding GFA (Guarantee Framework Agreement) PDFs with embedded PFI data
- Generate Letters of Guarantee with embedded staff signatures
- Trigger invoice creation at Payment Service and iBank APEX settlement account operations
- Any unauthenticated caller can trigger batch document generation and financial operations

### External Dependencies

| Service | Endpoints Using | Operations |
|---|---|---|
| Profile Service | ~15 | PFI identification via representative TIN, batch PFI lookups |
| Workflow Service | ~10 | Start/resume workflow instances (5 namespaces: guarantee, pfi_onboarding, loan, claim, eproc) |
| Product Service | ~5 | Bundle/product validation and mapping |
| File Management Service | ~10 | Document upload/download (11 claim document types, GFA, LoG, Excel reports) |
| Auth Service | ~3 | Signatory lookup by role, user name resolution (cached 10min) |
| Notification Service | ~5 | Email notifications (borrower, operations, PFI) |
| Payment Service | ~4 | Invoice creation (commitment fee, guarantee coverage) |
| iBank APEX | ~3 | Corporate account onboarding, settlement account lookup (OAuth-protected) |
| Configuration Service | ~2 | HTML template fetching for PDF generation |
| ESRI Service | ~2 | Geospatial land data lookup (Redis cached 5min) |
| Land Center Service | ~2 | Land parcel validation (Redis cached 5min) |

### Workflow Namespaces

| Namespace | Entity Types | Triggered By |
|---|---|---|
| `guarantee` | APPLICATION, INDIVIDUAL_GUARANTEE_REPORT, GUARANTEE_RESTRUCTURE | Guarantee app submit, individual report submit, restructuring submit |
| `pfi_onboarding` | PFI_ONBOARDING | PFI application submit |
| `loan` | LOAN_APPLICATION | Loan application submit/resubmit |
| `claim` | GUARANTEE_CLAIM | Claim submission |

### Database Schemas Used

| Schema | Tables | Key Operations |
|---|---|---|
| Guarantee | Applications, Collaterals, ApplicationDocuments, ApplicationComments, GfaDocuments, GuaranteeLetterDocuments, LOGInvoiceJobStatus, GuaranteeClaims, ClaimDocuments, IndividualGuaranteeReports, IndividualReportData, GuaranteeRestructurings, GuaranteeRestructuringDocuments | CRUD, SELECT FOR UPDATE, SKIP LOCKED, bulk upsert |
| Application | FinancialInstitutionsApplications, FinancialInstitutionProducts, FinancialInstitutionDocuments, Applications, Applicants, LoanApplications, LoanCollaterals, LoanApplicationDocuments, LoanApplicationReviewLogs | CRUD, findOrCreate, bulk create |
| Form | Forms, FormFields, FormFieldOptions, InputTypes | CRUD, transaction-wrapped multi-entity |
| Simulation | Seeds, Crops, SeedDictionary, LaborActivitiesDictionary, FertilizerDictionary, PesticidesAndHerbicides | Read-heavy, simulation calculations |
| Loan | Applications, ApplicationCollateral, ApplicationDocuments | CRUD with workflow integration |

### Existing Observability

- **Logging**: LoggerService via Kafka `logging.info` topic (Winston-based, not SDK Pino). Some modules use manual `emitLog()` calls. Guarantee document generation has best logging (step-by-step).
- **Tracing**: `@Trace()` and `@Span()` decorators on some controllers/services (guarantee apps, PFI onboarding, loan apps). Not consistent across all modules.
- **Metrics**: No custom Prometheus metrics anywhere. No prom-client counters/histograms/gauges.
- **Domain Events**: No structured domain events. Outbox pattern exists but uses generic topic names (e.g., `ProcurementPlanItemSubmitted` reused for guarantee submissions).

### Migration Order (ECGF)

| Phase | Sub-domain | Reason |
|---|---|---|
| 1 | Workflow Events (7 Kafka) | Central routing hub — failure affects ALL workflow-driven operations. Add metrics + alerting first. |
| 2 | Guarantee Documents (GFA/LoG/Invoice) | **4 unprotected endpoints** + financial operations + batch processing. Security fix + observability together. |
| 3 | Guarantee Applications (12 HTTP) | Core workflow entry point. High volume. |
| 4 | PFI Onboarding (10 HTTP) | Onboarding gateway. Profile + Product Service dependencies. |
| 5 | Claims (11 HTTP) | Financial payout process. Complex business rules (90-455 day window). |
| 6 | Loan Applications (9 HTTP) | PFI review workflow with audit trail. |
| 7 | Guarantee Loans (8 HTTP) | 4 lending type validations. |
| 8 | Individual Reports (10 HTTP) | Data feeds claim eligibility. Complex Excel processing. |
| 9 | Restructuring (5 HTTP) | Lower volume. Financial recalculation. |
| 10 | Simulation/Kataza (9 HTTP) | Agricultural simulation. ESRI/Land Center dependencies. |
| 11 | External API (3 HTTP) | API-key protected. Lower priority. |
| 12 | Forms HTTP + Kafka (19 total) | Admin operations. Low criticality. |
| 13 | Applications Kafka (2) | Inter-service RPC. |

### Key Patterns to Instrument

1. **SELECT FOR UPDATE / SKIP LOCKED** — Add lock acquisition timing, contention metrics
2. **Transactional outbox** — Track event publication lag, outbox queue depth
3. **Batch processing** (GFA/LoG/Invoice generation) — Per-item success/failure, batch size, stuck-processing detection
4. **Multi-service transactions** (GFA upload → iBank APEX → Payment Service) — Per-step latency, circuit breaker readiness
5. **Excel processing** (Individual Reports) — Memory usage, parsing duration, row counts
6. **Workflow start/resume** — Success/failure per namespace, latency
7. **Redis cache** (ESRI/Land Center, Auth Service) — Hit/miss ratios, TTL effectiveness

---

## E-Procurement Domain Summary

**Electronic Procurement** — BRD's public procurement platform covering procurement plans, requisitions, tender management, bid submission/evaluation, award recommendations, clarifications, and TAT monitoring.

### Endpoint Distribution

| Sub-domain | Endpoints | Critical | P0 |
|---|---|---|---|
| Tenders (Admin) | 21 | 4 | 4 |
| Requisitions | 21 | 1 | 1 |
| Procurement Plans | 16 | 2 | 2 |
| Evaluation | 16 | 3 | 3 |
| Bids | 13 | 2 | 2 |
| Tenders (Public) | 4 | 0 | 0 |
| Clarifications (Admin) | 3 | 0 | 0 |
| Clarifications (Public) | 2 | 0 | 0 |
| TAT Monitoring | 2 | 2 | 2 |
| Tenders (Internal) | 1 | 1 | 1 |
| **Total** | **99** | **14** | **15** |

> **Note**: 7 Kafka Workflow Event handlers are shared between ECGF and E-Procurement (they dispatch to domain-specific approval services based on entityType). They are counted in the ECGF CSV only to avoid double-counting. E-Procurement workflow entity types handled: PLAN_ITEM, REQUISITION_LINE, TENDER_LOT, TENDER_LOT_CLARIFICATION, AWARD.

### Criticality Distribution

| Criticality | Count | % |
|---|---|---|
| Critical | 14 | 14.1% |
| High | 22 | 22.2% |
| Medium | 43 | 43.4% |
| Low | 20 | 20.2% |

### Priority Distribution

| Priority | Count | % | Description |
|---|---|---|---|
| P0 | 15 | 15.2% | Workflow submissions, tender publication, bid submission/opening, evaluation completion, award recommendation, TAT monitoring |
| P1 | 17 | 17.2% | State transitions, workflow resumes, file uploads, participation tracking, bid revisions |
| P2 | 36 | 36.4% | Admin listings, department-scoped views, updates, deletes |
| P3 | 31 | 31.3% | Read-only detail views, static data, low-frequency operations |

### 🔴 Key Findings

| Finding | Impact | Severity |
|---|---|---|
| **Almost zero observability** — only 1 of 99 endpoints has @Trace/@Span (bulkCreate) | Entire procurement pipeline is invisible to monitoring. No metrics, no structured logging, no tracing on 98% of endpoints. | **CRITICAL** |
| **Heavy SELECT FOR UPDATE usage** — 15+ endpoints use row-level locking | Lock contention completely untracked. No lock wait time metrics. No deadlock detection. | HIGH |
| **Raw SQL in bid opening** — `markTendersAsOpened` bypasses Sequelize ORM | ORM-level logging/auditing bypassed. SQL injection surface. | HIGH |
| **Fire-and-forget async patterns** — bid opening report generation via `setImmediate` | Report failures are silent. No delivery confirmation. No retry. | MEDIUM |
| **No domain events for key actions** — bid submission, award recommendation, evaluation completion have no outbox events | Downstream consumers can't react to procurement milestones. | MEDIUM |

### External Dependencies

| Service | Endpoints Using | Operations |
|---|---|---|
| Workflow Service | ~12 | Start/resume instances (PLAN_ITEM, REQUISITION_LINE, TENDER_LOT, CLARIFICATION, AWARD) |
| Auth Service | ~10 | getUserDepartments (department filtering), getStaffUserById (assignee changes), getBusinessRepresentative (supplier identity), getBusinessSuppliersByBusinessIds (bid reports) |
| Configuration Service | ~5 | Budget validation (getBudgetByCode), TAT defaults, bid opening report config/templates |
| File Management Service | ~8 | Document upload, PDF generation from templates |
| Notification Service | ~6 | Publication emails, clarification notifications, assignee changes, award decisions, bid opening reports |

### Workflow Entity Types (E-Procurement)

| Entity Type | Triggered By | Approval Results |
|---|---|---|
| `PLAN_ITEM` | Plan item submission | APPROVED → creates Requisition, emits PROCUREMENT_PLAN_ITEM_APPROVED |
| `REQUISITION_LINE` | Requisition line submission | APPROVED → converts to Tender with DRAFT lots, emits REQUISITION_LINE_APPROVED |
| `TENDER_LOT` | Tender lot submission | APPROVED → tender moves to READY, may auto-publish |
| `TENDER_LOT_CLARIFICATION` | Clarification submission | APPROVED → stores response, notifies supplier |
| `AWARD` | Award recommendation | APPROVED → marks bids EVALUATED, notifies winners/losers |

### Database Schema (Tender.*)

| Table Group | Tables | Key Operations |
|---|---|---|
| Planning | ProcurementPlans, ProcurementPlanItems, ProcurementDocuments | CRUD, budget validation, status transitions |
| Requisitions | Requisitions, RequisitionLines, RequisitionLineDocuments | CRUD, SELECT FOR UPDATE, total synchronization |
| Tenders | Tenders, TenderLots, TenderLotDocuments, TenderPublications, TenderParticipations | CRUD, SELECT FOR UPDATE, bulk status transitions, raw SQL |
| Clarifications | TenderLotClarifications | CRUD, SELECT FOR UPDATE, workflow integration |
| Evaluation | TenderLotEvaluations, TenderLotEvalCriteria, BidScores, TenderLotAwards | CRUD, SELECT FOR UPDATE, weighted score calculation |
| Bids | Bids, BidDocuments, BidRevisions, BidOpeningReports | CRUD, SHA-256 checksums, async report generation |
| TAT | TatJobRuns, TatTrackingEvents | Create, milestone tracking, breach detection |
| Workflow | WorkflowInstances, WorkflowInstanceTasks | Projection tables, upsert, event recording |

### Existing Observability (E-Procurement)

- **Logging**: Only `bulkCreate` (plan) and TAT monitoring have any logging. 97 of 99 endpoints have ZERO logging.
- **Tracing**: Only `bulkCreate` has `@Trace()` and `@Span()` decorators. Everything else is completely untraced.
- **Metrics**: No custom Prometheus metrics anywhere. Zero prom-client usage.
- **Worst observability posture** of any domain in the application-service.

### Migration Order (E-Procurement)

| Phase | Sub-domain | Reason |
|---|---|---|
| 1 | TAT Monitoring (2 internal) | Batch jobs processing ALL items. Breach detection drives compliance. Already has some logging — build on it. |
| 2 | Bids (13 HTTP) | Supplier-facing. Bid submission/opening/withdrawal are critical procurement milestones. SHA-256 integrity. |
| 3 | Evaluation (16 HTTP) | Scoring, weighted calculations, award recommendations. Financial accuracy critical. |
| 4 | Tenders Admin (23 HTTP) | Tender publication, retraction, lot submissions. Heavy SELECT FOR UPDATE usage. |
| 5 | Tenders Internal (1 HTTP) | Scheduled publication. Cron job visibility. |
| 6 | Requisitions (21 HTTP) | Requisition-to-tender pipeline. Budget validation. SELECT FOR UPDATE. |
| 7 | Procurement Plans (16 HTTP) | Plan creation triggers per-item workflows. Budget validation chain. |
| 8 | Clarifications (5 total) | Lower volume. Supplier questions with workflow. |
| 9 | Tenders Public (4 HTTP) | Public-facing but read-only. Latency tracking. |

### Key Patterns to Instrument

1. **SELECT FOR UPDATE contention** — 15+ endpoints. Add lock wait time histograms, contention counters.
2. **Workflow start/resume** — Track per-entity-type success/failure, latency. 5 entity types across E-Procurement.
3. **Budget validation chain** — Configuration Service calls for budget code validation. Track validation duration, failure reasons.
4. **TAT milestone tracking** — Breach counts, due counts, job duration. Alert on threshold breaches.
5. **Bid opening batch job** — Bids opened/disqualified counts, report generation duration, async failure tracking.
6. **Weighted score calculation** — Audit trail for score changes. Calculation accuracy verification.
7. **Tender lifecycle transitions** — Track time-in-state per status. Publication scheduling accuracy.

---

## Cross-cutting Domain Summary

**Infrastructure handlers** — No additional HTTP controllers beyond ECGF and E-Procurement. Cross-cutting concerns are the transactional outbox infrastructure and Swagger documentation.

### Handlers

| Handler | Type | Criticality | Priority |
|---|---|---|---|
| Swagger API Docs (`/api-docs`) | HTTP (auto-generated) | Low | P3 |
| Outbox Publisher (`publishNewEvents`) | Cron (every 5 min) | Critical | P0 |
| Outbox Housekeeping (`purgeSent`) | Cron (daily midnight) | Medium | P2 |
| Outbox Listener (`handleEnqueueEvent`) | EventEmitter | Critical | P0 |

### 🔴 Outbox is Critical Infrastructure

The outbox publisher and listener are the **delivery backbone for ALL domain events** across both ECGF and E-Procurement. 16+ event types flow through this pipeline:

- **E-Procurement**: ProcurementPlanItemSubmitted/Approved, RequisitionLineSubmitted/Approved, TenderLotSubmitted/Approved, TenderPublished, TenderLotClarificationSubmitted
- **ECGF**: LoanApplicationSubmitted/Approved/Resubmitted, PfiOnboardingApplication, ClaimApproved/Rejected, IndividualReportApproved/Rejected

**Current gaps**:
- No queue depth metrics (NEW/ERR status counts)
- No dead-letter alerting (events with 3+ failed attempts)
- No per-topic publish success/failure breakdown
- No Kafka publish latency tracking
- No correlation between domain events and outbox delivery

### Global Middleware (not inventoried as endpoints)

| Middleware | Purpose |
|---|---|
| `HttpExceptionFilter` | Global error formatting. Uses LoggerService for error logging. |
| `ValidationPipe` | class-validator with whitelist + forbidNonWhitelisted. |
| `Morgan` | HTTP request logging in 'dev' format on all routes. |
| `Helmet` | Security headers (X-Content-Type-Options, X-Frame-Options, etc.). |
| `CORS` | Whitelist from `CORS_ORIGIN_WHITELIST` env var (semicolon-separated). |
| `Kafka Transport` | Secondary microservice transport for all @MessagePattern handlers. |

### Shared Service Modules (no endpoints)

| Module | Purpose |
|---|---|
| `ExternalIntegrationModule` | All external API calls (Workflow, Auth, Profile, Config, Notification, ESRI, iBank, Credit Score). Redis caching (5min TTL) for ESRI/Land Center. |
| `OutboxModule` | Transactional outbox pattern. KafkaProducerService, Publisher cron, Housekeeping cron, Listener. |
| `PaginationModule` | Generic Sequelize findAndCountAll wrapper with offset-based pagination. |
| `LoggerModule` | Winston with daily-rotate-file transports. Optional Kafka transport to `logging.info` topic. |
| `DatabaseModule` | Sequelize ORM config. PostgreSQL. autoLoadModels, synchronize=false. |
| `CacheModule` | Global Redis cache via cache-manager-redis-store. TTL from CACHE_TTL env var (default 60s). |

---

## Application Service — Final Totals

| Domain | CSV | Endpoints | Critical | P0 |
|---|---|---|---|---|
| ECGF | application-ecgf.csv | 113 | 21 | 21 |
| E-Procurement | application-eproc.csv | 99 | 14 | 15 |
| Cross-cutting | application-crosscutting.csv | 4 | 2 | 2 |
| **Total** | **3 files** | **216** | **37** | **38** |

---

## SDK Installation Status

| Service | Branch | SDK Version | Status |
|---|---|---|---|
| access-management | `ch-add-logger-sdk` | v1.0.1 | Installed, ObservabilityModule wired |
| configuration | `ch-add-logger-sdk` | v1.0.1 | Installed, ObservabilityModule wired |
| workflow | `ch-add-observability-logger-sdk` | v1.0.6 ⚠️ | Installed, ObservabilityModule wired. **v1.0.6 unstable — downgrade to v1.0.1** |
| product | `ch-add-logger-sdk` | v1.0.1 | Installed, ObservabilityModule wired |
| profile | `ch-add-logger-sdk` | v1.0.1 | Installed, ObservabilityModule wired |
| application | `ch-add-logger-sdk` | v2.0.0 | Installed, ObservabilityModule wired, upgraded to v2.0.0 |
| authentication | `chore/application-endpoint-observability-tracking` | v2.0.0 | Installed, ObservabilityModule + ObservabilityHealthModule wired, ObservabilityLogger used in UsersController (login domain events) |
| uno-job-scheduler | `ft-observability-sdk` (WIP stashed) | Not installed on main | No SDK on main branch. WIP on ft-observability-sdk branch (stashed) |

> ⚠️ v1.0.6+ is unstable — OTEL log transport fails in production mode. All services should use v1.0.1 until v2.0.0 stable release.

## Other Service Inventories

Previous service inventories (access-management, configuration, workflow, product, profile) are tracked on the `chore/endpoint-observability-tracking` branch. See that branch's README for cross-service summaries.

---

## Authentication Service

### Service Overview

| Property | Value |
|---|---|
| Service | authentication-service |
| Framework | NestJS + Sequelize ORM |
| Database | PostgreSQL |
| Transport | HTTP only (Kafka used as producer for logging, not consumer) |
| Auth | JWT Bearer + Active Directory (LDAP) + OTP (email/SMS) |
| External APIs | NIDA (national ID), RRA (tax/TIN), RDB (company registration), Notification Service, Profile Service, Access Management Service, Application Service, Gateway/Giriwawe |
| Total Endpoints | 68 |
| SDK Version | v2.0.0 |
| SDK Status | Partially integrated — ObservabilityLogger in UsersController (login only), old LoggerService (Kafka) still in AccessController |

### Endpoint Distribution

| Controller | Endpoints | Critical | High | Medium | Low | P0 | P1 |
|---|---|---|---|---|---|---|---|
| UsersController | 20 | 4 | 8 | 4 | 4 | 5 | 6 |
| AccessController | 20 | 4 | 6 | 3 | 7 | 3 | 7 |
| StaffUserController | 11 | 2 | 4 | 0 | 5 | 3 | 3 |
| DepartmentController | 7 | 0 | 0 | 4 | 3 | 0 | 0 |
| UnitController | 8 | 0 | 1 | 3 | 4 | 0 | 1 |
| AppController | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| **Total** | **68** | **11** | **22** | **14** | **21** | **13** | **19** |

### Criticality Summary

- **Critical (11)**: Login, OTP validation, user creation, token refresh, password reset, role/permission assignment, user block/unblock, admin creation, staff hard delete, staff role management, 2FA toggle
- **High (22)**: Email confirmation, OTP resend, forgot password, NID/TIN validation, staff user CRUD, business user management, role/permission creation
- **Medium (14)**: User profile, business user updates, department/unit CRUD
- **Low (21)**: Health checks, read-only listings, org chart queries

### Security Findings

1. **2 guards commented out** — `validate-national-id/:nationalId` and `validate-tin-rra/:tinNumber` have `@UseGuards(AccessGuard)` commented out, making NIDA/RRA data publicly accessible
2. **1 endpoint missing guard entirely** — `get-profile-by-role` has no `@UseGuards` and no try/catch
3. **No brute force detection** on OTP validation — unlimited attempts
4. **No rate limiting metrics** on OTP resend — SMS bombing vector
5. **Tokens in URL paths** — confirm-email/:token, find-user-by-reset-token/:resetToken, reset-password/:token — logged by proxies
6. **Password changes with no audit trail** — reset-password has zero logging
7. **Hard delete endpoints** with no audit — staff users and units can be permanently deleted without any record
8. **Old LoggerService (Kafka-based)** still used in AccessController — should migrate to ObservabilityLogger

### Existing Observability

| Component | Status |
|---|---|
| ObservabilityModule | ✅ Wired in app.module with metrics, tracing, HTTP/Kafka instrumentations |
| ObservabilityHealthModule | ✅ Imported |
| NestPinoLogger | ✅ Set as app logger in main.ts |
| setupProcessErrorHandlers | ✅ Called in main.ts |
| ObservabilityLogger | ⚠️ Only in UsersController (login domain events) and StaffUserService |
| domainEvent() | ⚠️ Only on login (auth.login_succeeded, auth.login_failed) |
| @Trace() / @Span() decorators | ⚠️ On 5 endpoints (create, validate-national-id, validate-tin-rra, create-user-admin, create-business-user) |
| Old LoggerService (Kafka) | ⚠️ Still used in AccessController — needs migration |
| MorganMiddleware | ⚠️ Applied to all routes — HTTP request logging |
| Custom metrics | ❌ None |
| Audit logging | ❌ None for RBAC changes |

### External Dependencies

| Dependency | Used By | Purpose |
|---|---|---|
| NIDA API | UsersController (getUserNidData, validateNationId, completeFirstLogin) | National ID validation — government identity service |
| RRA API | UsersController (validateTin, validateTinRra, getCompanyInfoFromRra) | TIN/tax validation — tax authority |
| RDB API | UsersController (validateTinNumberRDB) | Company registration validation |
| Active Directory (LDAP) | UsersController (login), ActiveDirectoryService | Staff authentication for @brd.rw users |
| Notification Service | UsersController (email/SMS for OTP, registration, password reset) | Email + SMS delivery |
| Profile Service | AccessController (fetchProfileByRole) | Profile data lookup |
| Access Management Service | AccessService | Access control delegation |
| Application Service | AccessService | Bank/tenant info lookup |
| Gateway/Giriwawe | UsersController (forgotPasswordGiriwawe) | Giriwawe platform password reset |

### Migration Order (Recommended)

| Phase | Priority | Endpoints | Focus |
|---|---|---|---|
| 1 | P0 | Login, OTP validation, token refresh, password reset, user creation | Core auth flow — domain events + metrics |
| 2 | P0 | manage-user-role, manage-role-permission, manage-user-access, create-user-admin | RBAC audit trail — security-critical |
| 3 | P0 | Staff hard delete, staff role management, 2FA toggle | Staff security operations |
| 4 | P1 | OTP resend, email confirmation, forgot password | Auth support flow — rate limiting metrics |
| 5 | P1 | NIDA/RRA/RDB validation endpoints | External API metrics + fix commented-out guards |
| 6 | P1 | Staff CRUD, business user management | Staff lifecycle audit trail |
| 7 | P1 | Role/permission CRUD, user mapping | RBAC management audit |
| 8 | P2 | Department/unit CRUD, business user updates | Org structure changes |
| 9 | P2 | Validation endpoints, profile lookup | Lower-risk operations |
| 10 | P3 | Read-only listings, health checks, org chart queries | Admin UI reads |

### Key Patterns to Instrument

1. **Dual auth path** — login routes to Active Directory or standard DB based on username (@brd.rw → AD). Both paths need equivalent observability.
2. **OTP flow** — resend → validate → token issue. Rate limiting and brute force detection critical.
3. **RBAC operations** — role/permission create/assign/remove. Every change needs audit trail with performer, target, and action.
4. **External API calls** — NIDA, RRA, RDB, Active Directory. Need latency histograms and error rate tracking.
5. **Old LoggerService migration** — AccessController still uses Kafka-based logger. Migrate to ObservabilityLogger with domainEvent().

---

## Uno Job Scheduler

### Service Overview

| Property | Value |
|---|---|
| Service | uno-job-scheduler |
| Framework | NestJS + Sequelize ORM |
| Database | PostgreSQL (Application, ApplicationBankStatus, BankInfo, StatusJobs models) |
| Transport | HTTP (minimal) + Cron (primary) |
| Caching | Redis (access control token caching, 5min TTL) |
| External APIs | Access Control Service (Minecofin + RIM loan APIs), Application Service (guarantee document generation), Payment Service (invoice generation) |
| Total Endpoints | 11 (3 HTTP + 8 Cron jobs) |
| SDK Version | Not installed on main |
| SDK Status | Not integrated. Uses NestJS Logger + console.log |

### Endpoint Distribution

| Controller/Service | HTTP | Cron | Total | Critical | P0 |
|---|---|---|---|---|---|
| ExternalIntegrationService | 0 | 4 | 4 | 4 | 4 |
| GuaranteeFrameworkService | 0 | 3 | 3 | 0 | 0 |
| InvoiceService | 0 | 1 | 1 | 0 | 0 |
| InvoiceController | 1 | 0 | 1 | 0 | 0 |
| AppController | 2 | 0 | 2 | 0 | 0 |
| **Total** | **3** | **8** | **11** | **4** | **4** |

### Criticality Summary

- **Critical (4)**: All loan integration crons — sendApplicationsToMinecofin, saccoLoanStatus, rimLoanStatus, checkSaccoMissed (reconciliation)
- **High (5)**: GFA generation, LoG generation, guarantee invoice generation, payment invoice cron, manual invoice trigger
- **Low (2)**: Health checks

### Security Findings

1. **No auth on manual invoice trigger** — `GET api/invoices/generate` is publicly accessible, triggers financial operation
2. **Basic Auth credentials** in env vars sent to Payment Service — no rotation mechanism visible
3. **Access Control Service credentials** (ACCESS_CON_USER/PASSWORD) hardcoded in env — used for login to get tokens
4. **sequelize.literal** used for balance updates with `principalAmount` — SQL injection risk if amount not sanitized
5. **console.log** used throughout — may leak sensitive data (loan amounts, account numbers) to stdout

### Existing Observability

| Component | Status |
|---|---|
| NestJS Logger | ⚠️ Basic logging in all services (log, warn, error) |
| console.log/error | ❌ Used alongside Logger — unstructured, no context |
| MorganMiddleware | ⚠️ Applied to HTTP routes |
| Custom metrics | ❌ None |
| Tracing | ❌ None |
| Job tracking | ⚠️ StatusJobs table for saccoLoanStatus only — not for other crons |
| SDK | ❌ Not installed on main |

### Cron Schedule Summary

| Cron Job | Default Schedule | Env Override |
|---|---|---|
| sendApplicationsToMinecofin | Every 30 min | SEND_LOAN_REQUEST_CRON |
| saccoLoanStatus | Every 30 min | GET_LOAN_STATUS_CRON |
| rimLoanStatus | Every 30 min | GET_LOAN_STATUS_CRON_RIM |
| checkSaccoMissed | Daily midnight | MISSED_STATUS_CRON |
| generateGuaranteeFramework | Hourly (min 45) | GUARANTEE_FRAMEWORK_CRON |
| generateLetterOfGuarantee | Hourly (min 45) | LETTER_OF_GUARANTEE_CRON |
| generateLetterOfGuaranteeInvoice | Hourly (min 45) | GUARANTEE_INVOICE_CRON |
| generateInvoice | Hourly (top of hour) | GENERATE_INVOICE_CRON |

### External Dependencies

| Dependency | Used By | Purpose |
|---|---|---|
| Access Control Service | ExternalIntegrationService (login, loan-request, loan-status) | Auth token + Minecofin/RIM loan APIs |
| Minecofin API (via Access Control) | MinecofinLoanGateway, saccoLoanStatus, checkSaccoMissed | SACCO loan submission + status polling |
| RIM API (via Access Control) | RimLoanGateway, rimLoanStatus | RIM bank loan submission + status polling |
| Application Service | GuaranteeFrameworkService (GFA, LoG, invoice generation) | Guarantee document generation triggers |
| Payment Service | InvoiceService (invoice generation with Basic Auth) | Payment invoice generation |

### Migration Order (Recommended)

| Phase | Priority | Endpoints | Focus |
|---|---|---|---|
| 1 | P0 | sendApplicationsToMinecofin, saccoLoanStatus | Core loan submission + status polling — metrics + domain events |
| 2 | P0 | rimLoanStatus, checkSaccoMissed | RIM polling + reconciliation — auto-rejection alerting |
| 3 | P1 | GFA/LoG/Invoice generation crons | Document generation — duration + failure metrics |
| 4 | P1 | Manual invoice trigger | Add auth + metrics |
| 5 | P3 | Health checks | Standard endpoints |

### Key Patterns to Instrument

1. **Loan submission pipeline** — Application created → sent to Minecofin/RIM → status polled → DISBURSED/REJECTED. Full lifecycle needs end-to-end tracing.
2. **Reconciliation** — Daily midnight job catches missed loans. Auto-rejection after N retries is business-critical decision needing alerting.
3. **Access Control token lifecycle** — Login → cache (5min) → reuse. Token failures block all loan operations.
4. **Balance updates** — BankInfo.balance adjusted on DISBURSED status. Financial accuracy depends on correct transaction handling.
5. **Three guarantee crons at same minute** — GFA + LoG + Invoice all at minute 45. Could overload application-service. Consider staggering.
