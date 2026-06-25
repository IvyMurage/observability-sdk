# Service Migration Reference

Per-service migration status, files to change, and specific patterns found in each BRD microservice.

For step-by-step instructions, see the [Migration Guide](migration.md).

## Table of Contents

- [Migration status overview](#migration-status-overview)
- [api-gateway](#api-gateway)
- [application-service](#application-service)
- [authentication-service](#authentication-service)
- [access-management-microservice](#access-management-microservice)
- [uno-job-scheduler](#uno-job-scheduler)
- [configuration-microservice](#configuration-microservice)
- [mel-service](#mel-service)
- [payment-microservice](#payment-microservice)
- [product-microservice](#product-microservice)
- [profile-microservice](#profile-microservice)
- [workflow-service](#workflow-service)

---

## Migration status overview

| Service | SDK installed | main.ts done | app.module done | Controllers done | Services done | Complexity |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| api-gateway | `@brdrwanda` | Yes | Partial | No | No | Medium |
| application-service | `@brdrwanda` | Yes | Yes | Yes | Yes | Done |
| authentication-service | `@ivymurage-rw` | Partial | Partial | No | No | **High** |
| access-management-microservice | `@ivymurage-rw` | Partial | Yes | No | No | Low |
| uno-job-scheduler | `@ivymurage-rw` | Partial | Partial | No | No | Low |
| configuration-microservice | None | No | No | No | No | Medium |
| mel-service | None | No | No | No | No | Medium |
| payment-microservice | None | No | No | No | No | Medium |
| product-microservice | None | No | No | No | No | **High** |
| profile-microservice | None | No | No | No | No | **High** |
| workflow-service | None | No | No | No | No | Low |

### Complexity ratings

- **Low** — Few files, simple LoggerService usage, no createLoggingContextWithId
- **Medium** — Multiple controllers/services, Kafka logging client, some console.log
- **High** — Many files with handleInfoLog/handlErrorLog, createLoggingContextWithId usage, heavy console.log, Kafka event handlers

---

## api-gateway

**Status:** SDK installed (`@brdrwanda/observability`), main.ts and imports updated. LoggerService and createLoggingContextWithId still in use.

### What's done
- `package.json` — `@brdrwanda/observability` installed
- `src/main.ts` — `setupProcessErrorHandlers`, `bufferLogs`, `NestPinoLogger` configured
- `src/app.module.ts` — `ObservabilityModule.forRoot()` and `ObservabilityHealthModule` imported

### What's left

| File | Pattern | Change needed |
|------|---------|---------------|
| `src/app.module.ts` | `APP_FILTER` with `HttpExceptionFilter` | Remove provider |
| `src/app.module.ts` | `MorganMiddleware` in configure() | Remove middleware, remove `NestModule` |
| `src/applications/apply/application.controller.ts` | `LoggerService` + `handleInfoLog` + `createLoggingContextWithId` | Replace with `ObservabilityLogger` |
| `src/utils/logging.util.ts` | `createLoggingContextWithId` utility | Delete file |
| `src/filters/http.exception.filter.ts` | Custom exception filter | Delete file |
| `src/middlewares/morgan.middleware.ts` | Morgan HTTP logging | Delete file |
| `src/logger/logger.service.ts` | Winston LoggerService | Delete file |
| `src/axios/axios.service.ts` | HTTP client | Add `propagation.inject()` for trace propagation |

### Service details
- **Database:** Sequelize (MSSQL/Tedious)
- **Kafka:** Yes (ClientKafka for logging)
- **External APIs:** Yes (AxiosService)
- **Redis:** Yes (cache-manager)

---

## application-service

**Status: Migration complete.** All LoggerService references replaced, HttpExceptionFilter removed, SDK fully integrated.

### What was done
- `@brdrwanda/observability` installed, `@ivymurage-rw/observability` removed
- `main.ts` — `setupProcessErrorHandlers`, `bufferLogs`, `NestPinoLogger`
- `app.module.ts` — `ObservabilityModule.forRoot()`, removed `APP_FILTER` + `HttpExceptionFilter`
- 6 controllers — `LoggerService` → `ObservabilityLogger`, `handleInfoLog` → `logger.info()`
- 5 approval services — `LoggerService` → `new Logger(ClassName.name)` (NestJS built-in)
- `guarantee.service.ts` — 7 `createLoggingContextWithId` blocks + 2 `handlErrorLog` calls replaced manually
- All `handleInfoLog`/`handlErrorLog`/`handleWarnLog`/`createLoggingContextWithId` references eliminated

### Pending
- Build verification (requires `sudo rm -rf dist` due to root-owned dist directory)

---

## authentication-service

**Status:** Has `@ivymurage-rw/observability` v0.1.17. ObservabilityModule already configured. Needs package swap and LoggerService replacement.

### Current state
- `main.ts` — Already has `setupProcessErrorHandlers` and `bufferLogs` from `@ivymurage-rw/observability`
- `app.module.ts` — Already has `ObservabilityModule.forRoot()` with HTTP, Redis, Kafka, Sequelize instrumentations
- `database.module.ts` — Already uses `createSequelizeLogging` from `@ivymurage-rw/observability`
- **But:** LoggerService (Winston + Kafka) still used in all controllers and services

### What needs to change

| File | Current pattern | Change needed |
|------|----------------|---------------|
| `package.json` | `@ivymurage-rw/observability` | Swap to `@brdrwanda/observability` |
| `src/main.ts` | Import from `@ivymurage-rw/observability` | Change import to `@brdrwanda/observability` |
| `src/app.module.ts` | Import from `@ivymurage-rw/observability` | Change import to `@brdrwanda/observability` |
| `src/database/database.module.ts` | Import `createSequelizeLogging` from `@ivymurage-rw` | Change import |
| `src/users/users.service.ts` | **49 calls** to `handleInfoLog`/`handlErrorLog` | Replace with `ObservabilityLogger` |
| `src/access/access.service.ts` | **42 calls** to `handleInfoLog`/`handlErrorLog` | Replace with `ObservabilityLogger` |
| `src/access/access.controller.ts` | 4 calls to `handleInfoLog` | Replace with `ObservabilityLogger` |
| `src/filters/http.exception.filter.ts` | Custom filter with `LoggerService('catch')` | Delete file |
| `src/logger/logger.service.ts` | Winston + Kafka logger | Delete file |
| `src/utils/logging.util.ts` | `createLoggingContextWithId` (defined but unused) | Delete file |
| `src/middlewares/morgan.middleware.ts` | Morgan HTTP logging | Delete file |
| Multiple files | 18 `console.log` statements | Replace with `logger.info/debug` |

### Key details
- **Highest effort:** `users.service.ts` (49 logger calls) and `access.service.ts` (42 logger calls)
- **Typo:** Service uses `handlErrorLog` (missing 'e') — watch for this during grep/replace
- **Service name discrepancy:** `main.ts` uses `'authentication-service'` in `setupProcessErrorHandlers`, but also references `'application-gateway'` — use `'authentication-service'`
- **External APIs:** Calls NID/TIN lookup APIs via `src/utils/external.apis.call.ts` — add `@Span` decorators
- **Database:** Already uses `createSequelizeLogging` from observability package

### Migration approach
1. Swap npm package (`@ivymurage-rw` → `@brdrwanda`)
2. Update all import paths (sed batch)
3. Replace LoggerService in `users.service.ts` (biggest file — do carefully)
4. Replace LoggerService in `access.service.ts`
5. Replace remaining controllers
6. Delete old files
7. Build and test

---

## access-management-microservice

**Status:** Has `@ivymurage-rw/observability` v0.1.19. ObservabilityModule fully configured with all instrumentations. Minimal LoggerService usage.

### Current state
- `main.ts` — Has `setupProcessErrorHandlers` and `NestPinoLogger` from `@ivymurage-rw`
- `app.module.ts` — Full `ObservabilityModule.forRoot()` with HTTP, Kafka, Redis, Sequelize instrumentations
- LoggerService usage is minimal (2 controllers, 1 filter)

### What needs to change

| File | Current pattern | Change needed |
|------|----------------|---------------|
| `package.json` | `@ivymurage-rw/observability` | Swap to `@brdrwanda/observability` |
| `src/main.ts` | Import from `@ivymurage-rw/observability` | Change import |
| `src/app.module.ts` | Import from `@ivymurage-rw/observability` | Change import |
| `src/role-access/role-access.controller.ts` | `new LoggerService('role-access')` + `handleInfoLog` | Replace with `ObservabilityLogger` |
| `src/routes/route.controller.ts` | `new LoggerService('route')` + `handleInfoLog` | Replace with `ObservabilityLogger` |
| `src/filters/http.exception.filter.ts` | `new LoggerService('catch')` + `handlErrorLog` | Delete file |
| `src/logger/logger.service.ts` | Winston logger | Delete file |
| `src/main.ts` | `console.log` in listen callback | Remove |

### Key details
- **Low complexity** — only 2 controllers use LoggerService
- **Direct instantiation:** Controllers use `const loggerService = new LoggerService('role-access')` at module scope (not injected)
- **No createLoggingContextWithId**
- **Service name:** `'access-management-service'` in app.module, `'application-gateway'` in main.ts error handler — fix to `'access-management-service'`

---

## uno-job-scheduler

**Status:** Has `@ivymurage-rw/observability` v0.1.5. Old SDK version. Minimal LoggerService usage.

### What needs to change

| File | Current pattern | Change needed |
|------|----------------|---------------|
| `package.json` | `@ivymurage-rw/observability` v0.1.5 | Swap to `@brdrwanda/observability` |
| `src/main.ts` | Import from `@ivymurage-rw` | Change import |
| `src/app.module.ts` | Import from `@ivymurage-rw` | Change import + verify config |
| `src/filters/http.exception.filter.ts` | Custom filter | Delete file |
| `src/logger/logger.service.ts` | Winston logger | Delete file |

### Key details
- **Low complexity** — scheduler service with few API endpoints
- **No Kafka** in this service
- **External APIs:** AxiosService for guarantee-framework and invoice operations
- **Add `@Span` decorators** to scheduled job methods for cron job tracing

---

## configuration-microservice

**Status:** No observability package installed. Full migration needed.

### What needs to change

| File | Current pattern | Change needed |
|------|----------------|---------------|
| `package.json` | No observability package | Install `@brdrwanda/observability` |
| `src/main.ts` | No setupProcessErrorHandlers, no bufferLogs | Full main.ts update |
| `src/app.module.ts` | `MorganMiddleware`, `ScheduleModule` | Add ObservabilityModule, remove Morgan |
| `src/configuration/configuration.controller.ts` | `new LoggerService('Configurations', loggingClient)` + `handleInfoLog` + `handlErrorLog` | Replace with `ObservabilityLogger` |
| `src/configuration/configuration.service.ts` | `console.log` (2 instances) | Replace with logger |
| `src/filters/http.exception.filter.ts` | Logger calls commented out, uses `console.log` | Delete file |
| `src/logger/logger.service.ts` | Winston + Kafka (full version with 3 methods) | Delete file |
| `src/utils/logging.util.ts` | `createLoggingContextWithId` | Delete file |
| `src/middlewares/morgan.middleware.ts` | Morgan HTTP logging | Delete file |

### Key details
- **Has ScheduleModule** — cron jobs need `@Span` for tracing
- **Has KafkaOutboxPublisher** — outbox pattern for Kafka, may need trace injection
- **Swagger configured** at `/api-docs`
- **Body parser:** Custom 50MB limit configuration — preserve during migration
- **Kafka topics:** Uses `logging.info` and `logging.warn` for log shipping — remove after migration

---

## mel-service

**Status:** No observability package installed. Full migration needed.

### What needs to change

| File | Current pattern | Change needed |
|------|----------------|---------------|
| `package.json` | No observability package | Install `@brdrwanda/observability` |
| `src/main.ts` | `app.useGlobalFilters(new HttpExceptionFilter())`, Kafka microservice | Full main.ts update |
| `src/app.module.ts` | `MorganMiddleware`, `ScheduleModule`, `EventEmitterModule` | Add ObservabilityModule, remove Morgan |
| `src/logger/logger.service.ts` | Winston + Kafka (full version, 256 lines) | Delete file |
| `src/filters/http.exception.filter.ts` | `LoggerService('catch')` + `handlErrorLog` + `console.log` | Delete file |
| `src/app.controller.ts` | `new LoggerService('app')` | Replace with `ObservabilityLogger` |
| `src/middlewares/morgan.middleware.ts` | Morgan | Delete file |

### Key details
- **Has Kafka microservice** — runs both HTTP and Kafka transport in main.ts
- **Has ScheduleModule** — cron jobs
- **External APIs:** AxiosService in kpis and programs modules
- **Winston version:** ^3.19.0 (newer than other services)

---

## payment-microservice

**Status:** No observability package installed. Full migration needed.

### What needs to change

| File | Current pattern | Change needed |
|------|----------------|---------------|
| `package.json` | No observability package | Install `@brdrwanda/observability` |
| `src/main.ts` | `app.useGlobalFilters(new HttpExceptionFilter())`, Kafka microservice | Full main.ts update |
| `src/app.module.ts` | `MorganMiddleware`, `EventEmitterModule` | Add ObservabilityModule, remove Morgan |
| `src/payment/payment.service.ts` | `new LoggerService('Payment')` + `handleInfoLog` | Replace with `ObservabilityLogger` |
| `src/workflow-events/workflow-events.controller.ts` | `LoggerService` + `handleInfoLog` | Replace with `ObservabilityLogger` |
| `src/payment/payment-approval.service.ts` | `LoggerService` | Replace |
| `src/external-integration/external-integration.service.ts` | `LoggerService` | Replace + add `@Span` |
| `src/filters/http.exception.filter.ts` | `LoggerService('catch')` + `console.log` | Delete file |
| `src/logger/logger.service.ts` | Winston (simple version, 72 lines, no Kafka) | Delete file |
| `src/middlewares/morgan.middleware.ts` | Morgan | Delete file |

### Key details
- **Simpler LoggerService** — no Kafka integration in the logger itself
- **Has Kafka microservice** — transport in main.ts
- **External APIs:** AxiosService for payment integrations
- **5+ files** need LoggerService replacement

---

## product-microservice

**Status:** No observability package installed. Full migration needed. **High complexity.**

### What needs to change

| File | Current pattern | Change needed |
|------|----------------|---------------|
| `package.json` | No observability package | Install `@brdrwanda/observability` |
| `src/main.ts` | `app.useGlobalFilters(new HttpExceptionFilter())` | Full main.ts update |
| `src/app.module.ts` | `MorganMiddleware` | Add ObservabilityModule, remove Morgan |
| `src/products/products.product.controller.ts` | `LoggerService` + Kafka + `handleInfoLog` + `createLoggingContextWithId` | Replace with `ObservabilityLogger` |
| `src/products/products.product.service.ts` | `LoggerService` + `createLoggingContextWithId` + `console.log` | Replace carefully |
| `src/bundles/bundle.controller.ts` | `LoggerService` + `handleInfoLog` | Replace |
| `src/categories/category.service.ts` | `LoggerService` | Replace |
| `src/projects/project.controller.ts` | `LoggerService` + `handleInfoLog` | Replace |
| `src/projects/project.service.ts` | `LoggerService` | Replace |
| `src/utils/logging.util.ts` | `createLoggingContextWithId` | Delete file |
| `src/filters/http.exception.filter.ts` | `LoggerService('catch')` + `console.log` | Delete file |
| `src/logger/logger.service.ts` | Winston + Kafka (full version, 276 lines) | Delete file |
| `src/middlewares/morgan.middleware.ts` | Morgan | Delete file |

### Key details
- **High complexity** — most extensive LoggerService usage with `createLoggingContextWithId`
- **ProductService** has `console.log` for cache invalidation (line 479) — replace
- **Kafka:** ClientKafka in product controller for log shipping
- **Redis cache** — preserve cache configuration
- **No external APIs**

---

## profile-microservice

**Status:** No observability package installed. Full migration needed. **High complexity due to console.log volume.**

### What needs to change

| File | Current pattern | Change needed |
|------|----------------|---------------|
| `package.json` | No observability package | Install `@brdrwanda/observability` |
| `src/main.ts` | `app.useGlobalFilters(new HttpExceptionFilter())`, Kafka microservice | Full main.ts update |
| `src/app.module.ts` | `MorganMiddleware`, `LoggerModule`, `ClientsModule` (Kafka) | Add ObservabilityModule, remove Morgan + LoggerModule |
| `src/customer/customer-kafka.controller.ts` | **8 `console.log` statements** in Kafka event handlers | Replace with `ObservabilityLogger` |
| `src/business/business-kafka.controller.ts` | **2 `console.log` statements** | Replace |
| `src/customer/customer.service.ts` | **3 `console.log` statements** | Replace |
| `src/business/business.service.ts` | **6 `console.log` statements** | Replace |
| `src/filters/http.exception.filter.ts` | `LoggerService('catch')` + `console.log` | Delete file |
| `src/logger/logger.service.ts` | Winston (simple, 72 lines) | Delete file |
| `src/logger/logger.module.ts` | DynamicModule `LoggerModule.register()` | Delete file |
| `src/middlewares/morgan.middleware.ts` | Morgan | Delete file |

### Key details
- **High complexity** — 15+ `console.log` statements across Kafka controllers and services
- **Unique:** Uses `LoggerModule.register('App')` dynamic module pattern — delete and replace with SDK
- **Kafka controllers:** `CustomerKafkaController` and `BusinessKafkaController` handle events with raw console.log
- **External APIs:** AxiosService for customer and business lookups
- **Redis cache** — preserve cache configuration

---

## workflow-service

**Status:** No observability package installed. Full migration needed. **Low complexity.**

### What needs to change

| File | Current pattern | Change needed |
|------|----------------|---------------|
| `package.json` | No observability package | Install `@brdrwanda/observability` |
| `src/main.ts` | No exception filter registered (unique among services) | Full main.ts update |
| `src/app.module.ts` | `MorganMiddleware`, `ScheduleModule`, `EventEmitterModule` | Add ObservabilityModule, remove Morgan |
| `src/app.controller.ts` | `const logger = new LoggerService('app')` + `handleInfoLog` | Replace with `ObservabilityLogger` |
| `src/outbox/producer/kafka-producer.service.ts` | Direct KafkaJS usage | Add trace injection to Kafka headers |
| `src/filters/http.exception.filter.ts` | `LoggerService('catch')` + `console.log` | Delete file |
| `src/logger/logger.service.ts` | Winston (simple, 72 lines, no Kafka) | Delete file |
| `src/middlewares/morgan.middleware.ts` | Morgan | Delete file |

### Key details
- **Low complexity** — minimal LoggerService usage (only app.controller.ts)
- **Unique:** No `useGlobalFilters` in main.ts — exception filter was never registered
- **Has KafkaJS producer** (not NestJS ClientKafka) — add trace propagation to outbox messages
- **Has ScheduleModule** — cron jobs need `@Span`
- **External APIs:** AxiosService for workflow operations

---

## Migration priority order

Recommended order based on complexity, risk, and business impact:

| Priority | Service | Reason |
|----------|---------|--------|
| 1 | **application-service** | Already done ✅ |
| 2 | **access-management-microservice** | Low complexity, already has SDK (swap package) |
| 3 | **uno-job-scheduler** | Low complexity, already has SDK (swap package) |
| 4 | **authentication-service** | Already has SDK, but high file count — needs careful migration |
| 5 | **workflow-service** | Low complexity, no SDK yet but minimal LoggerService usage |
| 6 | **api-gateway** | Already has SDK, remaining LoggerService usage to clean up |
| 7 | **configuration-microservice** | Medium complexity, no SDK yet |
| 8 | **payment-microservice** | Medium complexity, multiple services to update |
| 9 | **mel-service** | Medium complexity, has cron jobs |
| 10 | **product-microservice** | High complexity, extensive createLoggingContextWithId |
| 11 | **profile-microservice** | High complexity, 15+ console.log statements to replace |
