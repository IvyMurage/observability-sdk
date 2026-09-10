# Payment Microservice — Observability Analysis

**Service:** payment-microservice `:8800`  
**Domain:** ECGF (Export Credit Guarantee Fund) invoice payment management  
**SDK Status:** ❌ Not migrated — uses Winston daily-rotate files  
**Last analyzed:** September 2026

---

## Contents

1. [Service Architecture](#1-service-architecture)
2. [Entity Model](#2-entity-model)
3. [Payment Status Lifecycle](#3-payment-status-lifecycle)
4. [Domain Event Catalog](#4-domain-event-catalog)
5. [Prometheus Metrics](#5-prometheus-metrics)
6. [Technical Logging Gaps](#6-technical-logging-gaps)
7. [Security & Data Concerns](#7-security--data-concerns)
8. [Implementation Order](#8-implementation-order)

---

## 1. Service Architecture

This is **not** a general payment gateway. It manages **invoice payments for ECGF guarantee fees** — PFIs (Participating Financial Institutions) submit proof-of-payment against invoices, which go through a multi-step approval workflow.

### Core Components

| Component | Responsibility |
|---|---|
| `PaymentController` | Submit payment, confirm, request clarification, resubmit, list |
| `PaymentService` | Payment CRUD, validation, workflow orchestration |
| `PaymentApprovalService` | Handles Kafka workflow events (approve/reject/request-info) |
| `InvoiceController` | Create corporate invoices, fetch, generate PDF documents |
| `InvoiceService` | Invoice CRUD, PDF generation with dual signatories |
| `WorkflowEventsController` | Kafka consumer for workflow-service events |
| `ExternalIntegrationService` | HTTP calls to workflow-service (start/resume instances) |

### External Dependencies

| Service | Protocol | Purpose |
|---|---|---|
| workflow-service | HTTP + Kafka | Multi-step payment approval workflow |
| profile-service | HTTP | Fetch PFI business registration number |
| authentication-service | HTTP | Fetch signatory profiles and signatures for invoice PDF |
| configuration-service | HTTP | Fetch invoice PDF templates |
| file-server | HTTP | Upload generated invoice PDFs |
| Kafka | Pub/Sub | Outbox events (PaymentSubmitted, PaymentApproved) + workflow events |

### Endpoints

| Method | Path | Description | Guard |
|---|---|---|---|
| `POST` | `/api/payments/submit` | Submit payment proof against invoice | AccessGuard |
| `POST` | `/api/payments` | List all payments (paginated) | AccessGuard |
| `POST` | `/api/payments/pfi/list` | List payments for authenticated PFI | AccessGuard |
| `GET` | `/api/payments/:id` | Get payment by ID | None |
| `POST` | `/api/payments/:id/confirm` | Confirm/approve payment | None |
| `POST` | `/api/payments/:id/request-clarification` | Return payment for clarification | None |
| `POST` | `/api/payments/:id/resubmit` | Resubmit after clarification | AccessGuard |
| `POST` | `/api/invoices/corporates` | Create corporate invoice | None |
| `POST` | `/api/invoices/all` | Fetch invoices by TIN | AccessGuard |
| `POST` | `/api/invoices/list` | Fetch all invoices | AccessGuard |
| `GET` | `/api/invoices/documents/:id` | Fetch one invoice document | AccessGuard |
| `POST` | `/api/invoices/documents/all` | Fetch all invoice documents | AccessGuard |
| `GET` | `/api/invoices/generate` | Generate invoice PDF | BasicAuthGuard |

### Kafka Topics

| Direction | Topic | Trigger |
|---|---|---|
| **Produces** | `{PRODUCER}.PaymentSubmitted` | Payment submitted → outbox enqueue |
| **Produces** | `{PRODUCER}.PaymentApproved` | Payment approved via workflow → outbox enqueue |
| **Consumes** | `{WF_PRODUCER}.WorkflowCompleted` | Workflow final decision (APPROVE/REJECT) |
| **Consumes** | `{WF_PRODUCER}.WorkflowTaskCompleted` | Workflow step completed (REQUEST_INFO) |

---

## 2. Entity Model

### Invoice

| Field | Type | Notes |
|---|---|---|
| `id` | BIGINT (PK) | Auto-increment |
| `invoiceNumber` | STRING | Unique identifier |
| `institutionName` | STRING | PFI name |
| `tinNumber` | STRING | PFI tax identification number |
| `settlementAccount` | STRING | Bank account |
| `amount` | DECIMAL(20,5) | Total invoice amount |
| `loanAmount` | DECIMAL(20,5) | Underlying loan amount |
| `guaranteeAmount` | DECIMAL(20,5) | ECGF guarantee amount |
| `feeRate` | DOUBLE | Fee percentage |
| `feeAmount` | DECIMAL(20,5) | Calculated fee |
| `paidAmount` | DECIMAL(20,5) | Running total of confirmed payments |
| `tenor` | STRING | Loan tenor |
| `clientName` | STRING | End borrower name |
| `status` | STRING | `Pending` / `Paid` |
| `isPicked` | BOOLEAN | Whether invoice PDF has been generated |
| `createdBy` | STRING | Creator name |

### Payment

| Field | Type | Notes |
|---|---|---|
| `id` | BIGINT (PK) | Auto-increment |
| `invoiceId` | BIGINT (FK) | References Invoice |
| `settlementAccount` | STRING | Settlement account |
| `fromAccount` | STRING | Source account |
| `toAccount` | STRING | Destination account |
| `amount` | DECIMAL(20,5) | Payment amount |
| `status` | ENUM | See [Status Lifecycle](#3-payment-status-lifecycle) |
| `paymentType` | ENUM | `FULL` / `PARTIAL` / `EXCESS` |
| `proofOfPayment` | TEXT | Base64-encoded file (**⚠️ must never be logged**) |
| `name` | STRING | Proof file name |
| `size` | INTEGER | Proof file size |
| `mimetype` | STRING | Proof file MIME type |
| `paymentDate` | DATE | Date of payment |
| `createdById` | BIGINT | Submitter user ID |
| `createdBy` | STRING | Submitter name |
| `reviewedById` | BIGINT | Reviewer user ID |
| `reviewedAt` | DATE | Review timestamp |
| `reviewComments` | TEXT | Reviewer notes |

### PaymentStatusHistory

Audit trail of every status change with `deltaJson` capturing before/after state.

| Field | Type | Notes |
|---|---|---|
| `paymentId` | BIGINT (FK) | References Payment |
| `status` | STRING | Status at this point |
| `action` | STRING | Description of action |
| `createdById` | BIGINT | Actor user ID |
| `createdBy` | STRING | Actor name |
| `reviewComments` | TEXT | Comments |
| `deltaJson` | TEXT | JSON diff of changed fields |

### InvoiceDocument

Generated PDF records with reference numbers and file URLs.

---

## 3. Payment Status Lifecycle

```
                          ┌──────────────────────────┐
                          │     PENDING_REVIEW        │ ← Payment submitted
                          └────────┬─────────────┬────┘
                                   │             │
                    ┌──────────────▼──┐    ┌─────▼────────────────────┐
                    │    APPROVED     │    │ RETURNED_FOR_CLARIFICATION│
                    └──────┬─────────┘    └────────────┬──────────────┘
                           │                           │
                    ┌──────▼─────────┐          ┌──────▼──────┐
                    │   RECONCILED   │          │  RESUBMITTED │
                    └────────────────┘          └──────┬───────┘
                                                       │
                                               ┌──────▼──────────┐
                                               │  PENDING_REVIEW  │ (cycle back)
                                               └─────────────────┘

    Alternative terminal states:
    ┌────────────┐  ┌──────────────────────┐  ┌───────────┐  ┌───────────────┐
    │  REJECTED  │  │ RECONCILIATION_FAILED │  │ CANCELLED │  │  SUPERSEDED   │
    └────────────┘  └──────────────────────┘  └───────────┘  └───────────────┘

    Payment type flags (not status):
    ┌────────────────┐  ┌──────────────┐
    │ EXCESS_PAYMENT  │  │ PARTIALLY_PAID│
    └────────────────┘  └──────────────┘
```

### Status Definitions

| Status | Meaning | Set By |
|---|---|---|
| `PENDING_REVIEW` | Payment submitted, awaiting reviewer | `submitPayment()` |
| `APPROVED` | Reviewer confirmed, workflow approved | `completePaymentPlanWorkflow()` |
| `REJECTED` | Workflow rejected payment | `completePaymentPlanWorkflow()` |
| `RECONCILED` | Payment matched with bank records | `confirmPayment()` |
| `RETURNED_FOR_CLARIFICATION` | Reviewer needs more information | `requestClarification()` or workflow `REQUEST_INFO` |
| `RESUBMITTED` | Payer responded to clarification request | `resubmitPayment()` |
| `PENDING_RECONCILIATION` | Approved, awaiting bank reconciliation | (not yet implemented) |
| `RECONCILIATION_FAILED` | Bank reconciliation failed | (not yet implemented) |
| `SUPERSEDED` | Replaced by a newer payment | (not yet implemented) |
| `CANCELLED` | Payment cancelled | (not yet implemented) |
| `EXCESS_PAYMENT` | Amount exceeds invoice fee | (not yet implemented) |
| `PARTIALLY_PAID` | Partial payment applied | (not yet implemented) |

---

## 4. Domain Event Catalog

### Payment Events

| Event | Description | Source Method | Level | Log/Metric | Priority | Metadata |
|---|---|---|---|---|---|---|
| `payment.submitted` | Payment proof submitted against invoice | `PaymentService.submitPayment()` | INFO | Both | **Required** | payment_type, invoice_id, actor_id |
| `payment.submission_failed` | Submission rejected by validation | `PaymentService.submitPayment()` error paths | WARN | Both | **Required** | failure_reason (`PAYMENT_CONFLICT` / `INVOICE_NOT_FOUND` / `OVERPAYMENT` / `INVOICE_FULLY_PAID`), invoice_id |
| `payment.confirmed` | Reviewer confirmed payment amount matches | `PaymentService.confirmPayment()` | INFO | Both | **Required** | previous_status, new_status (`APPROVED`), reviewer_id |
| `payment.confirm_failed` | Confirmation rejected | `PaymentService.confirmPayment()` error paths | WARN | Both | **Required** | failure_reason (`INVALID_PAYMENT_STATUS` / `AMOUNT_MISMATCH` / `PAYMENT_NOT_FOUND`) |
| `payment.reconciled` | Payment reconciled with bank records | `PaymentService.confirmPayment()` post-approval | INFO | Both | **Required** | previous_status (`APPROVED`), new_status (`RECONCILED`) |
| `payment.clarification_requested` | Reviewer returned payment for more info | `PaymentService.requestClarification()` | WARN | Both | **Required** | previous_status, new_status (`RETURNED_FOR_CLARIFICATION`), reason |
| `payment.resubmitted` | Payer responded to clarification | `PaymentService.resubmitPayment()` | INFO | Both | **Required** | previous_status, new_status (`RESUBMITTED` / `PENDING_REVIEW`), original_payment_id |
| `payment.resubmit_failed` | Resubmission rejected (wrong status) | `PaymentService.resubmitPayment()` error paths | WARN | Both | **Required** | failure_reason (`PAYMENT_CONFLICT`), current_status |
| `payment.approved` | Workflow completed → APPROVE | `PaymentApprovalService.completePaymentPlanWorkflow()` | INFO | Both | **Required** | actor_type (`workflow`), workflow_instance_id, workflow_schema_id |
| `payment.rejected` | Workflow completed → REJECT | `PaymentApprovalService.completePaymentPlanWorkflow()` | WARN | Both | **Required** | actor_type (`workflow`), workflow_instance_id |
| `payment.workflow_clarification` | Workflow task action REQUEST_INFO | `PaymentApprovalService.completePaymentPlanWorkflowTask()` | WARN | Log | **Required** | workflow_task_id, step_id, actor, comment |

### Invoice Events

| Event | Description | Source Method | Level | Log/Metric | Priority | Metadata |
|---|---|---|---|---|---|---|
| `invoice.created` | Corporate invoice created | `InvoiceService.createCorporateInvoice()` | INFO | Both | **Required** | institution_name, invoice_number |
| `invoice.creation_failed` | Invoice creation failed (duplicate) | `InvoiceService.createCorporateInvoice()` conflict | WARN | Both | **Required** | failure_reason (`DUPLICATE_INVOICE_NUMBER`), invoice_number |
| `invoice.paid` | Invoice fully paid (paidAmount ≥ feeAmount) | `PaymentApprovalService.completePaymentPlanWorkflow()` | INFO | Both | **Required** | previous_status (`Pending`), new_status (`Paid`), payment_id |
| `invoice.document_generated` | Invoice PDF generated from template | `InvoiceService.generateInvoice()` | INFO | Both | **Required** | reference_number, institution_name, duration_ms |
| `invoice.document_generation_failed` | PDF generation failed | `InvoiceService.generateInvoice()` catch paths | ERROR | Both | **Required** | failure_reason (`MISSING_PROFILE` / `MISSING_SIGNATURE` / `TEMPLATE_FETCH_ERROR` / `PDF_RENDER_ERROR`), invoice_id |

### Workflow Integration Events

| Event | Description | Source Method | Level | Log/Metric | Priority | Metadata |
|---|---|---|---|---|---|---|
| `payment.workflow_started` | Approval workflow kicked off | `PaymentService.submitPayment()` | INFO | Log | **Required** | workflow_namespace (`payment`), entity_type (`INVOICE_PAYMENT`), payment_id |
| `payment.workflow_start_failed` | Couldn't start workflow | `PaymentService.submitPayment()` catch | ERROR | Both | **Required** | failure_reason, payment_id |
| `payment.workflow_resumed` | Workflow resumed after resubmission | `PaymentService.resubmitPayment()` | INFO | Log | **Recommended** | payment_id |

### Kafka Message Events

| Event | Description | Source | Level | Log/Metric | Priority | Metadata |
|---|---|---|---|---|---|---|
| `kafka.message_received` | Workflow event consumed | `WorkflowEventsController` handlers | INFO | Metric only | **Recommended** | topic, entity_type, entity_ref |
| `kafka.message_processing_failed` | Error processing workflow event | `WorkflowEventsController` catch blocks | ERROR | Both | **Required** | topic, entity_type, entity_ref, error_code |
| `kafka.outbox_enqueued` | Outbox event emitted | `PaymentService` / `PaymentApprovalService` | DEBUG | Metric only | **Recommended** | topic, entity_type, entity_id |

---

## 5. Prometheus Metrics

### Payment Metrics

```promql
# Submission
payment_submissions_total{payment_type, status}
# Labels: payment_type=FULL|PARTIAL|EXCESS, status=submitted|failed
# Incremented on: submitPayment() success/failure

payment_submission_duration_seconds{payment_type}
# Histogram: end-to-end submitPayment() duration including workflow start

# Review cycle
payment_reviews_total{action}
# Labels: action=confirmed|clarification_requested|rejected|approved
# Incremented on: confirmPayment(), requestClarification(), workflow outcomes

payment_review_cycle_duration_seconds{outcome}
# Histogram: time from PENDING_REVIEW to terminal status (RECONCILED/REJECTED)
# Calculated from payment.createdAt to status change timestamp

# Reconciliation
payment_reconciliations_total{status}
# Labels: status=reconciled|failed
# Incremented on: confirmPayment() reconciliation step

# Queue depth (gauge)
payment_pending_review_count
# Gauge: current count of payments in PENDING_REVIEW + RESUBMITTED status
# Updated on: submit, confirm, reject, clarify, resubmit

# Clarification cycle
payment_clarification_rounds_total
# Counter: how many times payments go through clarification cycle
# Indicates process friction — high count = unclear requirements
```

### Invoice Metrics

```promql
# Creation
invoice_creations_total{status}
# Labels: status=created|duplicate_rejected

# Payment completion
invoice_paid_total
# Counter: invoices reaching Paid status

# Document generation
invoice_document_generations_total{status}
# Labels: status=generated|failed

invoice_document_generation_duration_seconds
# Histogram: PDF generation time (template fetch + render + upload)
```

### Workflow Integration Metrics

```promql
# Workflow lifecycle
payment_workflow_starts_total{status}
# Labels: status=started|failed

payment_workflow_duration_seconds{outcome}
# Histogram: time from workflow start to completion
# Labels: outcome=approved|rejected

payment_workflow_resumes_total{status}
# Labels: status=resumed|failed
```

### External Service Metrics

```promql
# HTTP calls to dependent services
external_service_requests_total{target_service, method, status}
# Labels: target_service=workflow-service|profile-service|auth-service|
#          configuration-service|file-server
#          method=GET|POST, status=success|error

external_service_request_duration_seconds{target_service, method}
# Histogram: latency of each external call
```

### Kafka Metrics

```promql
# Consumer
kafka_messages_consumed_total{topic, status}
# Labels: topic=WorkflowCompleted|WorkflowTaskCompleted
#          status=processed|failed

# Producer (outbox)
kafka_outbox_events_total{topic}
# Labels: topic=PaymentSubmitted|PaymentApproved
```

---

## 6. Technical Logging Gaps

### Current State

| Issue | Location | Severity | Fix |
|---|---|---|---|
| **Winston logger, not SDK** | `src/logger/logger.service.ts` | 🔴 Critical | Migrate to `@brdrwanda/observability`. Without this, nothing reaches Loki/Prometheus/Tempo. |
| `console.error` (6 instances) | `payment.service.ts` lines 186, 237, 302, 370, 413, 519 | 🔴 Critical | Replace with `logger.error()` — structured, correlated |
| `console.log('rows', rows)` | `payment.service.ts` line 593 | 🔴 Critical | **Leaks payment data to stdout.** Remove immediately. |
| `console.log` in bootstrap | `main.ts` line 48 | 🟡 Medium | Replace with SDK logger |
| No catch block in `confirmPayment` controller | `payment.controller.ts` line 257 | 🟡 Medium | Unhandled errors crash without logging |
| No catch block in `requestClarification` controller | `payment.controller.ts` line 289 | 🟡 Medium | Same — silent crash |
| No catch block in `resubmitPayment` controller | `payment.controller.ts` line 329 | 🟡 Medium | Same — silent crash |
| No request correlation | Entire service | 🔴 Critical | No `request_id`, `correlation_id`, or `trace_id` on any log line. Cannot trace cross-service flows. |
| External call errors swallowed | `ExternalIntegrationService` | 🟡 Medium | Errors thrown but no structured context (duration_ms, target URL, response code) |
| Transaction rollbacks silent | `submitPayment`, `confirmPayment`, `resubmitPayment`, `requestClarification` | 🟡 Medium | Rollback happens but no log captures what rolled back or why |
| Kafka consumer errors generic | `WorkflowEventsController` | 🟡 Medium | Only logs `error.message` — no topic, partition, offset, entity context |

### What Should Be Logged (Technical, Non-Domain)

| Category | What to Log | Level | Notes |
|---|---|---|---|
| **Transaction lifecycle** | Every `transaction.commit()` and `transaction.rollback()` | DEBUG / ERROR | Currently invisible when rollbacks happen |
| **External HTTP calls** | Request to workflow-service, profile-service, auth-service, config-service, file-server | INFO (success) / ERROR (fail) | Include: target_service, method, path, status_code, duration_ms |
| **Kafka consumption** | Message received from each topic | DEBUG | Include: topic, partition, offset, entity_type, entity_ref |
| **Kafka production** | Outbox event enqueued | DEBUG | Include: topic, entity_type, entity_id |
| **Database slow queries** | Queries exceeding 500ms | WARN | OTEL DB instrumentation handles via trace spans |
| **Guard decisions** | `AccessGuard` and `BasicAuthGuard` allow/deny | WARN (deny) | Who tried to access what, with which role |
| **Validation failures** | DTO validation pipe rejections | WARN | Which fields failed, which endpoint |

---

## 7. Security & Data Concerns

### Fields That Must NEVER Be Logged

| Field | Entity | Reason |
|---|---|---|
| `proofOfPayment` | Payment | Base64-encoded file. Could contain sensitive bank documents. |
| `fromAccount` | Payment | Source bank account number |
| `toAccount` | Payment | Destination bank account number |
| `settlementAccount` | Payment / Invoice | Bank account number |
| `tinNumber` | Invoice | Tax identification number (PII) |
| `amount` (exact) | Payment / Invoice | Log `amount_range` bucket instead |
| `loanAmount`, `guaranteeAmount`, `feeAmount` (exact) | Invoice | Financial amounts — use buckets |
| `renderedContent` | InvoiceDocument | Full HTML of rendered invoice |
| Signatory names/emails/signatures | Invoice generation | Fetched from auth-service — never log |

### Safe to Log

| Field | Reason |
|---|---|
| `payment.id`, `invoice.id` | System identifiers |
| `invoiceNumber` | Reference number, not PII |
| `institutionName` | Organization name (public entity) |
| `status`, `paymentType` | Enum values, low cardinality |
| `paymentDate`, `reviewedAt` | Timestamps |
| `createdById`, `reviewedById` | User IDs (not PII themselves) |

### Missing Security Controls

| Issue | Risk | Recommendation |
|---|---|---|
| `GET /api/payments/:id` has no auth guard | Any unauthenticated user can fetch payment details | Add `AccessGuard` |
| `POST /api/payments/:id/confirm` has no auth guard | Anyone can confirm payments | Add `AccessGuard` with reviewer role check |
| `POST /api/payments/:id/request-clarification` has no auth guard | Anyone can return payments for clarification | Add `AccessGuard` with reviewer role check |
| `POST /api/invoices/corporates` has no auth guard | Anyone can create invoices | Add `AccessGuard` or `BasicAuthGuard` |

---

## 8. Implementation Order

### Phase 0: Prerequisites (Do First)

1. **Migrate LoggerService from Winston to `@brdrwanda/observability` SDK**
   - Current Winston logger writes to daily-rotate files, bypasses Loki/Prometheus/Tempo entirely
   - Without this, no domain events or metrics reach the observability stack
   - Replace `src/logger/logger.service.ts` with SDK import

2. **Kill all `console.error` and `console.log`**
   - 6× `console.error` in payment.service.ts
   - 1× `console.log('rows', rows)` in getPfiPayments — **leaks payment data**
   - 1× `console.log` in main.ts

3. **Add missing `try/catch` blocks in controllers**
   - `confirmPayment`, `requestClarification`, `resubmitPayment` controllers have no error handling

### Phase 1: Core Payment Events (Week 1)

| Priority | Event | Where |
|---|---|---|
| 1 | `payment.submitted` | `PaymentService.submitPayment()` after `paymentModel.create()` |
| 2 | `payment.submission_failed` | `PaymentService.submitPayment()` all error returns |
| 3 | `payment.approved` + `payment.rejected` | `PaymentApprovalService.completePaymentPlanWorkflow()` |
| 4 | `payment.clarification_requested` | `PaymentService.requestClarification()` |
| 5 | `payment.resubmitted` + `payment.resubmit_failed` | `PaymentService.resubmitPayment()` |

### Phase 2: Invoice Events + Workflow (Week 2)

| Priority | Event | Where |
|---|---|---|
| 6 | `invoice.created` + `invoice.creation_failed` | `InvoiceService.createCorporateInvoice()` |
| 7 | `invoice.paid` | `PaymentApprovalService.completePaymentPlanWorkflow()` when invoice status → Paid |
| 8 | `invoice.document_generated` + `invoice.document_generation_failed` | `InvoiceService.generateInvoice()` |
| 9 | `payment.workflow_started` + `payment.workflow_start_failed` | `PaymentService.submitPayment()` workflow section |
| 10 | `payment.confirmed` + `payment.reconciled` | `PaymentService.confirmPayment()` |

### Phase 3: Metrics (Week 2-3)

| Priority | Metric | Type |
|---|---|---|
| 1 | `payment_submissions_total` | Counter |
| 2 | `payment_reviews_total` | Counter |
| 3 | `payment_pending_review_count` | Gauge |
| 4 | `invoice_creations_total` | Counter |
| 5 | `invoice_document_generations_total` + `_duration_seconds` | Counter + Histogram |
| 6 | `external_service_requests_total` + `_duration_seconds` | Counter + Histogram |
| 7 | `payment_workflow_starts_total` | Counter |
| 8 | `kafka_messages_consumed_total` | Counter |

### Phase 4: Security Hardening (Week 3)

- Add `AccessGuard` to unprotected endpoints
- Add SDK redaction paths for `proofOfPayment`, account numbers, TIN
- Add `access.permission_denied` domain event to `AccessGuard`

---

*Payment Microservice Observability Analysis v1.0 · @brdrwanda/observability · September 2026*
