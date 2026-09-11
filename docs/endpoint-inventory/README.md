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
| Domains | ECGF (~113 endpoints), E-Procurement (~90 est.), Cross-cutting (~40 est.) |
| Total Endpoints | ~237 (estimated) |
| SDK Branch | `ch-add-logger-sdk` |
| SDK Version | v1.0.1 |
| SDK Status | Installed, ObservabilityModule wired |

## Domain Progress

| Domain | CSV File | Endpoints | Status | Reviewed |
|---|---|---|---|---|
| ECGF (Export Credit Guarantee Fund) | [application-ecgf.csv](application-ecgf.csv) | 113 | ✅ Complete | ⏳ Pending |
| E-Procurement | — | ~90 est. | ❌ Not Started | — |
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
