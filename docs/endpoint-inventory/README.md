# Application Service — Endpoint Inventory & Observability Tracking

> Domain-by-domain endpoint inventory for application-service observability migration.
> Each domain produces a separate CSV sheet. This README tracks progress, summarizes findings, and defines migration order.

## Service Overview

| Property | Value |
|---|---|
| Service | application-service |
| Framework | NestJS + Sequelize ORM |
| Database | PostgreSQL (6 schemas: Application, Form, Simulation, Guarantee, Tender, Loan) |
| Transport | HTTP + Kafka (dual) |
| Caching | Redis |
| Patterns | Transactional outbox, SELECT FOR UPDATE, SKIP LOCKED |
| Domains | ECGF (113 endpoints), E-Procurement (99 endpoints), Cross-cutting (~40 est.) |
| Total Endpoints | ~252 (212 confirmed + ~40 est. cross-cutting) |
| SDK Branch | `ch-add-logger-sdk` |
| SDK Version | v1.0.1 |
| SDK Status | Installed, ObservabilityModule wired |

## Domain Progress

| Domain | CSV File | Endpoints | Status | Reviewed |
|---|---|---|---|---|
| ECGF (Export Credit Guarantee Fund) | [application-ecgf.csv](application-ecgf.csv) | 113 | ✅ Complete | ⏳ Pending |
| E-Procurement | [application-eproc.csv](application-eproc.csv) | 99 | ✅ Complete | ⏳ Pending |
| Cross-cutting (health, common) | — | ~40 est. | ❌ Not Started | — |

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

## SDK Installation Status

| Service | Branch | SDK Version | Status |
|---|---|---|---|
| access-management | `ch-add-logger-sdk` | v1.0.1 | Installed, ObservabilityModule wired |
| configuration | `ch-add-logger-sdk` | v1.0.1 | Installed, ObservabilityModule wired |
| workflow | `ch-add-observability-logger-sdk` | v1.0.6 ⚠️ | Installed, ObservabilityModule wired. **v1.0.6 unstable — downgrade to v1.0.1** |
| product | `ch-add-logger-sdk` | v1.0.1 | Installed, ObservabilityModule wired |
| profile | `ch-add-logger-sdk` | v1.0.1 | Installed, ObservabilityModule wired |
| application | `ch-add-logger-sdk` | v1.0.1 | Installed, ObservabilityModule wired |

> ⚠️ v1.0.6+ is unstable — OTEL log transport fails in production mode. All services should use v1.0.1 until v2.0.0 stable release.

## Other Service Inventories

Previous service inventories (access-management, configuration, workflow, product, profile) are tracked on the `chore/endpoint-observability-tracking` branch. See that branch's README for cross-service summaries.
