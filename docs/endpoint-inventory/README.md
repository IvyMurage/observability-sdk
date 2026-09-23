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
| mel-service | `ft-observability` | v2.0.0 | Installed, ObservabilityModule wired, centralized domain event utilities |
| payment | `ft-observability` | v2.0.0 | Installed, ObservabilityModule wired, domain events + @Span throughout |
| uno-job-scheduler | `ft-observability-sdk` (WIP stashed) | Not installed on main | No SDK on main branch. WIP on ft-observability-sdk branch (stashed) |
| api-gateway | `ch-configure-sdk-clean` (WIP, 4 commits) | Not installed on main | Pure BFF — no SDK, no DB, no domain events. Uses Winston + custom x-trace-id/x-span-id headers |

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

---

## MEL Service

### Service Overview

| Property | Value |
|---|---|
| Service | mel-service |
| Framework | NestJS + Sequelize ORM |
| Database | PostgreSQL (Programs, Reports, Donors, Forms, KPIs, Templates, UserDrafts) |
| Transport | HTTP + Kafka consumer (WorkflowTaskCompleted) |
| External APIs | Notification Service, Workflow Service, File Management Service, Auth Service (NID/TIN validation via AxiosService) |
| Total Endpoints | 46 (44 HTTP + 1 Kafka consumer + 1 health) |
| SDK Version | v2.0.0 |
| SDK Status | Fully integrated. Best observability implementation across all services. Centralized domain event utilities. |

### Endpoint Distribution

| Controller | HTTP | Kafka | Total | Critical | P0 |
|---|---|---|---|---|---|
| ProgramsController | 15 | 0 | 15 | 2 | 2 |
| ReportsController | 6 | 0 | 6 | 1 | 1 |
| DonorsController | 3 | 0 | 3 | 0 | 0 |
| FormsController | 6 | 0 | 6 | 0 | 0 |
| KpisController | 6 | 0 | 6 | 0 | 0 |
| TemplatesController | 7 | 0 | 7 | 1 | 1 |
| ReportWorkflowEventsController | 0 | 1 | 1 | 1 | 1 |
| AppController | 2 | 0 | 2 | 0 | 0 |
| **Total** | **45** | **1** | **46** | **5** | **5** |

### Criticality Summary

- **Critical (5)**: Program creation, report submission, report review, template creation, Kafka workflow task processing
- **High (11)**: Program update/status change/delete, file uploads, report file download, report update, form create/update, KPI import, template update/delete
- **Medium (16)**: Draft operations, donor CRUD, KPI CRUD, list operations for programs/reports/donors
- **Low (14)**: Read-only GETs (drafts, single records, lists for forms/kpis/templates), health checks

### Priority Distribution

| Priority | Count | % | Description |
|---|---|---|---|
| P0 | 5 | 10.9% | Program creation, report submission, report review, template creation, Kafka workflow task |
| P1 | 11 | 23.9% | Program update/status/delete, file upload/download, report update, form create/update, KPI import, template update/delete |
| P2 | 16 | 34.8% | Draft save operations, donor CRUD, KPI CRUD, list/summary operations |
| P3 | 14 | 30.4% | Read-only drafts, single-record GETs, read-only lists, health checks |

### Domain Events

46 MelEvents across 6 entity groups (best coverage across all services):

| Entity Group | Events | Entity Types |
|---|---|---|
| Program | 14 | PROGRAM, PROGRAM_DRAFT, FILE |
| Report | 14 | REPORT, REPORT_DRAFT |
| Donor | 6 | DONOR |
| Form | 8 | FORM, FORM_DRAFT |
| KPI | 10 | KPI |
| Template | 10 | TEMPLATE, TEMPLATE_DRAFT |

7 enumerated failure reasons: VALIDATION_FAILED, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, PAYLOAD_TOO_LARGE, INTERNAL_ERROR

### Observability Architecture (Gold Standard)

| Component | Status | Notes |
|---|---|---|
| ObservabilityModule | ✅ `serviceName: 'mel-service'`, `prefix: 'mel'` | |
| setupTracing() | ✅ Called in main.ts | |
| setupProcessErrorHandlers() | ✅ Called in main.ts | |
| NestPinoLogger | ✅ Set as app logger | |
| bufferLogs | ⚠️ Not passed to NestFactory.create | Minor gap |
| logDomainEvent() | ✅ Centralized utility in all 7 controllers | Supports info/debug level parameter |
| logDomainFailure() | ✅ With classifyFailure() severity routing | fault → error, client mistake → warn |
| buildDomainEvent() | ✅ Auto-extracts actor from req.user, adds duration_ms + channel | |
| countFiles() | ✅ Tracks file uploads across flat and grouped fields | |
| @Span decorators | ✅ On service methods: program-create, report-workflow-task-completed, program-update, program-status-update | |
| HttpExceptionFilter | ⚠️ Built with span enrichment but commented out in main.ts | Relying on SDK's built-in APP_FILTER |
| Custom metrics | ❌ None | Blocked on endpoint inventory (now complete) |

### External Dependencies

| Dependency | Used By | Purpose |
|---|---|---|
| Notification Service | ProgramsService | Email notifications for program/report events |
| Workflow Service | ProgramsService | Start/resume report workflow instances |
| File Management Service | ProgramsService, ReportsController | Program file uploads, report file uploads/downloads |
| Auth Service (via AxiosService) | ProgramsService | NID/TIN validation, token exchange |
| XLSX library | KpisService, TemplatesService | Excel import/export for KPIs and templates |

### Migration Status

All 46 endpoints have domain events instrumented. Reads at debug level, writes at info level, failures classified as warn/error. This is the most complete observability migration across all reviewed services.

**Remaining work**:
- Define custom Prometheus metrics based on endpoint inventory
- Create Grafana dashboard
- Pass `bufferLogs: true` to NestFactory.create
- Consider wiring HttpExceptionFilter or confirming SDK APP_FILTER is sufficient

---

## Payment Service

### Service Overview

| Property | Value |
|---|---|
| Service | payment-service |
| Framework | NestJS + Sequelize ORM |
| Database | SQL Server (via Tedious) |
| Transport | HTTP + Kafka (dual) |
| Patterns | Transactional outbox (EventEmitter → Kafka), status history tracking |
| Domains | Payments (7 HTTP), Invoices (6 HTTP), Workflow Events (2 Kafka) |
| Total Endpoints | 17 (15 HTTP + 2 Kafka) |
| SDK Branch | `ft-observability` |
| SDK Version | v2.0.0 |
| SDK Status | Installed, ObservabilityModule wired, domain events + @Span on all service methods |

### Endpoint Distribution

| Controller | HTTP | Kafka | Total | Critical | P0 |
|---|---|---|---|---|---|
| PaymentController | 7 | 0 | 7 | 3 | 3 |
| InvoiceController | 6 | 0 | 6 | 2 | 2 |
| WorkflowEventsController | 0 | 2 | 2 | 1 | 1 |
| AppController | 2 | 0 | 2 | 0 | 0 |
| **Total** | **15** | **2** | **17** | **6** | **6** |

### Criticality Summary

- **Critical (6)**: Invoice creation (unguarded), invoice PDF generation, payment submission, payment confirmation (unguarded), payment resubmission, workflow completion (Kafka)
- **High (4)**: Invoice listing (admin), PFI payment listing, payment by ID (unguarded), clarification request (unguarded), workflow task completion
- **Medium (4)**: Invoice document retrieval, invoice document listing, all payments listing
- **Low (2)**: Health check, hello endpoint

### Priority Distribution

| Priority | Count | % | Description |
|---|---|---|---|
| P0 | 6 | 35.3% | Payment submission, confirmation, resubmission, invoice creation, PDF generation, workflow completion |
| P1 | 4 | 23.5% | Admin invoice listing, PFI payments, payment by ID, clarification, workflow task |
| P2 | 5 | 29.4% | Document retrieval, document listing, all payments listing |
| P3 | 2 | 11.8% | Health, hello |

### Domain Events

11 domain events across 2 entity groups in centralized constants file (`src/constants/outbox.ts`):

| Entity Group | Events | Constants |
|---|---|---|
| Payment | 8 | SUBMITTED, CONFIRMED, REJECTED, CLARIFICATION_REQUESTED, RESUBMITTED, RECONCILED, WORKFLOW_STARTED, WORKFLOW_RESUMED |
| Invoice | 3 | CREATED, PDF_GENERATED, PDF_GENERATION_FAILED |

### Observability Architecture

| Component | Status | Notes |
|---|---|---|
| ObservabilityModule | ✅ `serviceName: 'payment-service'`, `prefix: 'payment'` | Full config: metrics, tracing, environment |
| setupTracing() | ✅ Called in main.ts | |
| setupProcessErrorHandlers() | ✅ Called in main.ts | |
| NestPinoLogger | ✅ Set as app logger | |
| bufferLogs | ✅ Passed to NestFactory.create | |
| ObservabilityLogger | ✅ Used across all services | Replaced old LoggerService + Winston |
| domainEvent() | ✅ Direct calls with entity_type/entity_id/actor_type/metadata | |
| @Span decorators | ✅ All service methods: submit-payment, get-payment-by-id, get-all-payments, confirm-payment, request-clarification, resubmit-payment, get-pfi-payments, complete-payment-plan-workflow (x2), get-workflow-schemas, start-workflow-instance, resume-workflow-instance, create-corporate-invoice, fetch-all-invoices, fetch-all-invoices-without-tin, fetch-one-invoice, generate-invoice | 17 spans total |
| HttpExceptionFilter | ✅ Wired with ObservabilityLogger + OpenTelemetry span enrichment | Marks active span as ERROR + records exception |
| createSequelizeLogging() | ✅ Slow query threshold: 500ms | |
| Context propagation | ✅ AxiosService injects OTEL context via `propagation.inject()` | |
| Old LoggerService | ✅ Deleted (`src/logger/logger.service.ts` removed) | |
| MorganMiddleware | ✅ Deleted | Replaced by SDK request logging |

### External Dependencies

| Dependency | Used By | Purpose |
|---|---|---|
| Workflow Service | PaymentService, ExternalIntegrationService | Start/resume/complete workflow instances |
| Profile Service | PaymentService | Get PFI representative (registration number) |
| Auth Service | InvoiceService | Get profile by role (signatory names/signatures) |
| Configuration Service | InvoiceService | Fetch invoice PDF templates |
| File Server | InvoiceService | Upload generated PDF invoices |
| Kafka | WorkflowEventsController, OutboxService | Workflow events (inbound), domain events (outbound) |

### Security Findings

| Finding | Endpoints | Severity |
|---|---|---|
| **3 unguarded payment mutation endpoints** | `POST /api/payments/:id/confirm`, `POST /api/payments/:id/request-clarification`, `GET /api/payments/:id` | **CRITICAL** |
| **Unguarded invoice creation** | `POST /api/invoices/corporates` | **CRITICAL** |

### Migration Status

All 17 endpoints have SDK integration. 15 of 17 have @Span decorators (missing on `fetchAllInvoiceDocuments`). 11 domain events defined in centralized constants. HttpExceptionFilter fully wired with OTEL span enrichment. Old LoggerService and MorganMiddleware deleted. `createSequelizeLogging()` wired for slow query detection. OTEL context propagation via AxiosService.

**Remaining work**:
- Add AccessGuard to `POST /api/payments/:id/confirm`, `POST /api/payments/:id/request-clarification`, `GET /api/payments/:id`
- Add AccessGuard to `POST /api/invoices/corporates`
- Add @Span to `fetchAllInvoiceDocuments` in InvoiceService
- Create Grafana dashboard
- Duplicate @Span name: `complete-payment-plan-workflow` used on both `completePaymentPlanWorkflow` and `completePaymentPlanWorkflowTask` — differentiate them
- WorkflowEventsController logs use debug-style string interpolation with emoji markers — should use structured logging

---

## API Gateway

### Service Overview

| Property | Value |
|---|---|
| Service | api-gateway |
| Framework | NestJS (pure BFF — no ORM, no database) |
| Database | None |
| Transport | HTTP + Kafka RPC (4 form/loan controllers) |
| Caching | Redis (via CacheModule) |
| Patterns | BFF proxy pattern — all requests forwarded to downstream microservices via AxiosService |
| Downstream Services | 14: USER, PROFILE, ACCESS_MANAGEMENT, APPLICATION (largest), PAYMENT, MEL, PROPERTIES, CREDIT_SCORE, CORE_BANKING, CRM, PRODUCT, CONFIGURATION, WORKFLOW, LOGGING |
| Total Endpoints | 500 (across 64 controllers + 1 empty stub) |
| SDK Branch | `ch-configure-sdk-clean` (WIP, 4 commits) |
| SDK Version | Not installed on main |
| SDK Status | No SDK. Winston + DailyRotateFile + Kafka transport for logging. Custom x-trace-id/x-span-id via UUID (NOT OTEL propagation) |

### Architecture

The API Gateway is a **pure Backend-For-Frontend (BFF)** — it contains:
- **No database** — zero ORM, zero models, zero migrations
- **No `@brdrwanda/observability` SDK** — no ObservabilityModule, no Pino, no setupTracing
- **No domain events** — no outbox, no event emission
- **No route-level auth guards** — zero `@UseGuards`, zero `AccessGuard`, zero `BasicAuthGuard`. Auth is entirely delegated to downstream services
- **TokenMiddleware** (global) — synthesizes `Authorization: Bearer <token>` from HttpOnly `token` cookie so downstream guards accept cookie-authenticated web clients
- **CustomThrottlerGuard** (global APP_GUARD) — rate limiting only, NOT authorization
- **MorganMiddleware** (global) — HTTP request logging in 'dev' format

### Endpoint Distribution by Domain

| Domain | Controllers | Endpoints | Critical | High | Medium | Low |
|---|---|---|---|---|---|---|
| Authentication & Access | Users, Access, Staff, Business, InternalBusinessDocs, BusinessFlags, Flags | 7 | 87 | 17 | 31 | 18 | 21 |
| Profile Management | Profile, Business (partial) | 2 | 24 | 0 | 8 | 8 | 8 |
| Access Management | RoleAccess, Route | 2 | 7 | 2 | 3 | 0 | 2 |
| ECGF Applications | Application, GuaranteeApp, GuaranteeFramework, GuaranteeLoans, LoanApp, Claims, Restructuring, IndividualReports, Simulation, ExternalAPI | 10 | 82 | 14 | 17 | 28 | 23 |
| Forms (Kafka RPC) | FormFields, FormCreation, FormOptions, LoanCalculator | 4 | 12 | 0 | 4 | 0 | 8 |
| Payments & Invoicing | Payment, Invoice | 2 | 11 | 3 | 3 | 4 | 1 |
| MEL (Monitoring & Evaluation) | Programs, Donors, Reports, Forms (MEL), KPIs, Templates, Surveys | 7 | 57 | 5 | 13 | 18 | 21 |
| Properties & Real Estate | Properties, Units, Applications, Requests, Dashboard | 5 | 33 | 0 | 6 | 6 | 21 |
| E-Procurement | Tenders, TendersPublic, InternalTenders, Requisitions, Clarifications, ClarificationsPublic, Evaluation, InternalProcurementTAT, ProcurementPlan, Bids | 10 | 89 | 9 | 33 | 26 | 21 |
| Credit Scoring | CreditScore | 1 | 6 | 1 | 1 | 4 | 0 |
| Core Banking | CoreBanking, Companies, Beneficiaries | 3 | 10 | 0 | 3 | 4 | 3 |
| Products | Product | 1 | 14 | 0 | 4 | 0 | 10 |
| Configuration | Configurations | 1 | 14 | 0 | 4 | 1 | 9 |
| Workflow | Workflow | 1 | 21 | 3 | 7 | 6 | 5 |
| CRM & Ticketing | Tickets, TicketAssignments, TicketCategories, MinuzaTickets, MinuzaUsers | 5 | 16 | 0 | 0 | 6 | 10 |
| Logging | Logging | 1 | 1 | 0 | 0 | 1 | 0 |
| Dynamic Forms | DynamicForm | 1 | 7 | 0 | 2 | 0 | 5 |
| Financial Institutions | FinancialInstitution | 1 | 10 | 1 | 2 | 4 | 3 |
| Core / Health | App | 1 | 2 | 0 | 0 | 0 | 2 |
| **Total** | **65 (64 + 1 empty stub)** | **500** | **53** | **121** | **172** | **154** |

### Criticality Distribution

| Criticality | Count | % |
|---|---|---|
| Critical | 53 | 10.6% |
| High | 121 | 24.2% |
| Medium | 172 | 34.4% |
| Low | 154 | 30.8% |

### Priority Distribution

| Priority | Count | % | Description |
|---|---|---|---|
| P0 | 53 | 10.6% | Auth flows, financial operations, bid submission, workflow start/resume, payment confirmation |
| P1 | 121 | 24.2% | State transitions, file uploads, RBAC operations, external validations |
| P2 | 172 | 34.4% | Admin listings, updates, deletes, draft operations |
| P3 | 154 | 30.8% | Read-only views, health checks, static data |

### 🔴 Key Findings

| Finding | Details | Severity |
|---|---|---|
| **ZERO route-level auth guards across 500 endpoints** | No `@UseGuards`, no `AccessGuard`, no `BasicAuthGuard` anywhere. TokenMiddleware only normalizes cookie→header; CustomThrottlerGuard is rate limiting only. Auth entirely delegated downstream — if downstream service has no guard, endpoint is fully open. | **CRITICAL** |
| **Custom trace propagation, not OTEL** | `x-trace-id` = UUID, `x-span-id` = `gw-span-${timestamp}`. NOT OpenTelemetry `propagation.inject()`. Traces break at gateway boundary. | **HIGH** |
| **No structured logging** | Winston + DailyRotateFile + Kafka transport. Morgan for HTTP. console.warn for slow requests. No Pino, no structured JSON with trace context. | **HIGH** |
| **~20 file upload endpoints** with varying size limits (5MB–50MB) | FileInterceptor, FilesInterceptor, FileFieldsInterceptor, AnyFilesInterceptor used. No upload metrics, no size tracking. | **MEDIUM** |
| **4 Kafka RPC controllers** (FormFields, FormCreation, FormOptions, LoanCalculator) use TokenInterceptor instead of gateway-wide TokenMiddleware | Different auth mechanism than rest of gateway. | **LOW** |

### 🐛 Bugs Discovered

| Bug | Location | Impact |
|---|---|---|
| **Dual `@Controller()` decorators** on ProcurementPlanController | procurement-plan.controller.ts | NestJS uses last decorator — first one silently ignored. Confusing but not breaking. |
| **Swapped handler names** in RouteController | route.controller.ts | GET handler named `create`, POST handler named `fetchAll`. Names misleading but routes work. |
| **Copy-paste method name** in RequestsController | requests.controller.ts | `searchUnitsByFields` — leftover from UnitsController copy. |
| **MinuzaTicketService posts to wrong downstream path** | minuza-ticket.service.ts | POSTs to `/api/tickets/create` instead of `/api/minuza-tickets/create`. Minuza tickets may be created as regular tickets downstream. |
| **Duplicate list endpoints** on BidController | bid.controller.ts | Both `/all` and `/list` do same thing (versioning cruft). |
| **Near-identical controllers** | TicketController vs MinuzaTicketController | Same structure, same methods. Should be unified or MinuzaTicket should have distinct downstream path. |
| **CompaniesController.create is a GET-like POST** | companies.controller.ts | Method named "create" but calls `getAllCompanies`. |

### Global Middleware Stack

| Layer | Component | Purpose |
|---|---|---|
| 1 | TokenMiddleware | Cookie-to-header auth synthesis. Handles junk headers (Bearer null/undefined). Validates JWT structure (3 segments). |
| 2 | MorganMiddleware | HTTP request logging in 'dev' format. |
| 3 | CustomThrottlerGuard | Global rate limiting (APP_GUARD). NOT authorization. |
| 4 | HttpExceptionFilter | Global error formatting (APP_FILTER). |
| 5 | AxiosService | Connection pooling (100 max sockets), custom x-trace-id/x-span-id headers, slow request logging (>5s), 30s timeout. |

### AxiosService Trace Propagation (Current)

```
Request → AxiosService.buildHeaders() → {
  'x-trace-id': UUID (generated or from req.headers['x-trace-id']),
  'x-span-id': `gw-span-${formatDate()}`,
  authorization: from req.headers.authorization (via TokenMiddleware),
  origin, device, x-forwarded-for, user-agent: forwarded from client
}
```

This custom trace propagation does NOT integrate with OpenTelemetry. Downstream services using OTEL (`propagation.extract()`) will NOT see gateway traces. The SDK branch (`ch-configure-sdk-clean`) has started work to replace this with proper OTEL context propagation via `propagation.inject()`.

### Existing Observability

| Component | Status |
|---|---|
| Winston logger | ⚠️ DailyRotateFile + Kafka transport to logging service. Unstructured. |
| Morgan middleware | ⚠️ HTTP request logging in 'dev' format (colorized, not JSON). |
| Custom x-trace-id | ⚠️ UUID-based, not OTEL. Breaks at service boundaries. |
| Custom x-span-id | ⚠️ `gw-span-${timestamp}`. Not OTEL spans. |
| Slow request detection | ⚠️ console.warn for requests >5s. No metrics. |
| Connection pooling metrics | ❌ 100 max sockets configured but no socket usage tracking. |
| SDK | ❌ Not installed on main. |
| Tracing | ❌ No OTEL. No @Trace/@Span. |
| Metrics | ❌ No Prometheus. No prom-client. |
| Domain events | ❌ N/A — pure BFF has no domain logic. |
| Structured logging | ❌ No Pino. No JSON logs with trace context. |

### Migration Recommendations

The API Gateway is uniquely important because it's the **single entry point for ALL client traffic**. Every request passes through it before reaching any downstream service. Observability here gives visibility into the entire system.

| Phase | Focus | Reason |
|---|---|---|
| 1 | Install SDK, replace Winston with Pino, wire ObservabilityModule | Foundation — structured logging + OTEL trace context on every request |
| 2 | Replace custom x-trace-id/x-span-id with OTEL `propagation.inject()` in AxiosService | End-to-end distributed tracing across all 14 downstream services |
| 3 | Add request duration histograms per downstream service | Identify which microservices are slow. Gateway sees ALL latency. |
| 4 | Add error rate counters per downstream service + status code | Alert on downstream failures before users notice |
| 5 | Add file upload metrics (size, duration, success/failure) | ~20 upload endpoints with no tracking |
| 6 | Add Grafana dashboard | Gateway dashboard is the single-pane-of-glass for all system traffic |

### Key Patterns to Instrument

1. **AxiosService request/response** — Duration histogram per downstream service URL, status code counter, error rate. This single instrumentation point covers ALL 500 endpoints.
2. **TokenMiddleware** — Cookie-to-header conversion success/failure, malformed header detection rate.
3. **File uploads** — Per-endpoint upload size histogram, upload duration, failure rate.
4. **Kafka RPC** — 4 controllers use Kafka instead of HTTP. Separate latency tracking.
5. **Connection pool** — Socket utilization, queue depth, exhaustion events.
6. **Throttler** — Rate limit hit rate per route/IP. Identifies abuse patterns.
