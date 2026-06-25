# Migration Guide

Step-by-step guide for migrating any BRD NestJS service from the old logging stack (Winston + LoggerService + Morgan + Kafka logging) to `@brdrwanda/observability`.

## Table of Contents

- [Overview](#overview)
- [What you're replacing](#what-youre-replacing)
- [Step 1: Install the SDK](#step-1-install-the-sdk)
- [Step 2: Update main.ts](#step-2-update-maints)
- [Step 3: Update app.module.ts](#step-3-update-appmodulets)
- [Step 4: Update database.module.ts](#step-4-update-databasemodulets)
- [Step 5: Replace LoggerService in controllers](#step-5-replace-loggerservice-in-controllers)
- [Step 6: Replace LoggerService in services](#step-6-replace-loggerservice-in-services)
- [Step 7: Remove createLoggingContextWithId](#step-7-remove-createloggingcontextwithid)
- [Step 8: Replace console.log](#step-8-replace-consolelog)
- [Step 9: Add trace propagation to HTTP clients](#step-9-add-trace-propagation-to-http-clients)
- [Step 10: Clean up unused files](#step-10-clean-up-unused-files)
- [Step 11: Test and verify](#step-11-test-and-verify)
- [Method mapping reference](#method-mapping-reference)
- [FAQ](#faq)

---

## Overview

Every BRD service uses the same logging stack:

```
LoggerService (extends NestJS Logger)
  ├── Winston logger (JSON format, daily rotate files)
  ├── Kafka producer (sends logs to logging.info / logging.warn topics)
  └── Console transport
```

The SDK replaces all of this with:

```
ObservabilityLogger (Pino)
  ├── Structured JSON to stdout (infrastructure ships to Loki)
  ├── Auto trace context injection (trace_id, span_id, request_id)
  └── Auto error classification (4xx=warn, 5xx=error)
```

**What you gain:** Trace correlation, automatic error logging, Prometheus metrics, health checks, exemplars.

**What you remove:** Winston, Morgan, LoggerService, createLoggingContextWithId, custom HttpExceptionFilter, Kafka logging client.

---

## What you're replacing

| Old pattern | SDK replacement | Notes |
|-------------|----------------|-------|
| `LoggerService` (Winston + Kafka) | `ObservabilityLogger` | Inject via constructor, no Kafka dependency |
| `handleInfoLog(msg, context)` | `logger.info(msg, metadata)` | Context injected automatically |
| `handlErrorLog(msg, data)` | `logger.error(msg, metadata)` or `logger.logCaughtError(error)` | Stack traces auto-included for 5xx |
| `handleWarnLog(msg, context)` | `logger.warn(msg, metadata)` | Same pattern |
| `createLoggingContextWithId(traceId, spanId, ...)` | Not needed — SDK injects trace context automatically | Delete the utility |
| `MorganMiddleware` | Not needed — SDK logs requests automatically | Delete the middleware |
| Custom `HttpExceptionFilter` | SDK's `ObservabilityExceptionFilter` (auto-registered) | Delete the filter |
| `app.useGlobalFilters(new HttpExceptionFilter())` | Remove this line | SDK registers its own filter via APP_FILTER |
| `console.log(...)` | `logger.info(...)` or `logger.debug(...)` | Structured, searchable, traceable |
| Winston daily rotate files in `logs/` | stdout → Promtail/FluentBit → Loki | Infrastructure handles log shipping |

---

## Step 1: Install the SDK

```bash
npm install @brdrwanda/observability
npm install -D pino-pretty    # pretty logs for development

# Remove old logging deps (optional — can do later)
npm uninstall winston nest-winston winston-daily-rotate-file morgan
```

If migrating from `@ivymurage-rw/observability`:
```bash
npm uninstall @ivymurage-rw/observability
npm install @brdrwanda/observability
```

---

## Step 2: Update main.ts

### Before (typical BRD service)

```typescript
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import AppModule from './app.module';
import HttpExceptionFilter from './filters/http.exception.filter';
import ValidationPipe from './pipe/validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe());
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`App is running on port ${port}`);
  });
}
bootstrap();
```

### After

```typescript
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { setupProcessErrorHandlers, NestPinoLogger } from '@brdrwanda/observability';
import AppModule from './app.module';
import ValidationPipe from './pipe/validation.pipe';

setupProcessErrorHandlers({ serviceName: 'your-service-name' });

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(NestPinoLogger));
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe());

  // DO NOT add app.useGlobalFilters() — SDK registers its own exception filter

  const port = process.env.PORT || 3000;
  app.listen(port);
}
bootstrap();
```

### What changed

| Change | Why |
|--------|-----|
| Added `setupProcessErrorHandlers()` | Catches fatal errors before NestJS starts |
| Added `{ bufferLogs: true }` | Buffers logs until SDK logger is ready |
| Added `app.useLogger(app.get(NestPinoLogger))` | Routes all NestJS internal logs through Pino |
| Removed `HttpExceptionFilter` import and `useGlobalFilters` | SDK handles exception logging automatically |
| Removed `console.log` in listen callback | SDK logs startup automatically |

---

## Step 3: Update app.module.ts

### Before

```typescript
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import DatabaseModule from './database/database.module';
import MorganMiddleware from './middlewares/morgan.middleware';
import LoggerModule from './logger/logger.module';
import { APP_FILTER } from '@nestjs/core';
import HttpExceptionFilter from './filters/http.exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    LoggerModule,
    // ... feature modules
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MorganMiddleware).forRoutes('*');
  }
}
```

### After

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  ObservabilityModule,
  ObservabilityHealthModule,
  httpInstrumentation,
  kafkaInstrumentation,       // only if service uses Kafka
  redisInstrumentation,       // only if service uses Redis
  sequelizeInstrumentation,   // only if service uses Sequelize
} from '@brdrwanda/observability';
import DatabaseModule from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityModule.forRoot({
      serviceName: 'your-service-name',
      instrumentations: [
        httpInstrumentation({ ignoreIncomingPaths: ['/health', '/metrics'] }),
        kafkaInstrumentation(),         // only if needed
        redisInstrumentation(),         // only if needed
        sequelizeInstrumentation({ slowQueryThreshold: 500 }),
      ],
    }),
    ObservabilityHealthModule,
    DatabaseModule,
    // ... feature modules (remove LoggerModule)
  ],
  // Remove APP_FILTER provider — SDK registers its own
})
export class AppModule {}
// Remove NestModule and MorganMiddleware — SDK handles request logging
```

### What changed

| Change | Why |
|--------|-----|
| Added `ObservabilityModule.forRoot()` | Core SDK module — provides logger, tracer, metrics |
| Added `ObservabilityHealthModule` | Adds `/health` and `/metrics` endpoints |
| Removed `LoggerModule` | SDK provides logging globally |
| Removed `MorganMiddleware` | SDK logs all HTTP requests automatically |
| Removed `APP_FILTER` / `HttpExceptionFilter` | SDK registers its own exception filter |
| Removed `NestModule` / `configure()` | No middleware to configure |

### Choosing instrumentations

Only include what your service uses:

| Your service uses... | Add this instrumentation |
|---------------------|------------------------|
| HTTP (all services) | `httpInstrumentation()` |
| Kafka (producer or consumer) | `kafkaInstrumentation()` |
| Redis cache | `redisInstrumentation()` |
| Sequelize ORM | `sequelizeInstrumentation()` |
| PostgreSQL (direct) | `pgInstrumentation()` |
| MySQL (direct) | `mysqlInstrumentation()` |

---

## Step 4: Update database.module.ts

If your service uses Sequelize with the SDK's logging integration:

### Before

```typescript
useFactory: () => ({
  dialect: 'mssql',
  logging: console.log,  // or false
  // ...
}),
```

### After

```typescript
import { ObservabilityLogger, createSequelizeLogging } from '@brdrwanda/observability';

useFactory: (logger: ObservabilityLogger) => ({
  dialect: 'mssql',
  logging: createSequelizeLogging(logger, { slowQueryThreshold: 500 }),
  benchmark: true,
  // ...
}),
inject: [ObservabilityLogger],
```

This gives you structured query logging with slow query warnings, replacing raw SQL output on console.

---

## Step 5: Replace LoggerService in controllers

Controllers that inject `LoggerService` and call `handleInfoLog`/`handlErrorLog` need updating.

### Pattern A: Controllers using LoggerService via constructor with Kafka

**Before:**
```typescript
import LoggerService from 'src/logger/logger.service';
import { createLoggingContextWithId } from 'src/utils/logging.util';
import { consumerGroup } from 'src/common/constant.common';

@Controller('api/resources')
class ResourceController {
  private readonly logger: LoggerService;

  constructor(
    private readonly resourceService: ResourceService,
    @Inject(consumerGroup[0].name) private readonly loggingClient: ClientKafka,
  ) {
    this.logger = new LoggerService('Resource', loggingClient);
  }

  @Get()
  async getAll(@Res() res: Response, @Trace() traceId: string, @Span() spanId: string) {
    const result = await this.resourceService.getAll();
    const context = createLoggingContextWithId(traceId, spanId, result);
    this.logger.handleInfoLog('Resources fetched', context);
    return ResponseCommon.handleSuccess(HttpStatus.OK, 'Success', res, result);
  }
}
```

**After:**
```typescript
import { ObservabilityLogger } from '@brdrwanda/observability';

@Controller('api/resources')
class ResourceController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly logger: ObservabilityLogger,
    // Remove loggingClient — no more Kafka in the logger
  ) {}

  @Get()
  async getAll(@Res() res: Response) {
    const result = await this.resourceService.getAll();
    this.logger.info('resources fetched');
    // Remove @Trace(), @Span() params — SDK injects trace context automatically
    return ResponseCommon.handleSuccess(HttpStatus.OK, 'Success', res, result);
  }
}
```

### Pattern B: Controllers with try/catch error handling

**Before:**
```typescript
@Post()
async create(@Body() dto: CreateDto, @Res() res: Response) {
  try {
    const result = await this.service.create(dto);
    this.logger.handleInfoLog('Created');
    return ResponseCommon.handleSuccess(HttpStatus.CREATED, 'Created', res, result);
  } catch (error) {
    this.logger.handlErrorLog(error.message, error.stack, errorContext);
    return ResponseCommon.handleError(error?.getStatus() || 500, error?.message, res);
  }
}
```

**After:**
```typescript
@Post()
async create(@Body() dto: CreateDto, @Res() res: Response) {
  try {
    const result = await this.service.create(dto);
    this.logger.info('created');
    return ResponseCommon.handleSuccess(HttpStatus.CREATED, 'Created', res, result);
  } catch (error) {
    this.logger.logCaughtError(error);
    return ResponseCommon.handleError(error?.getStatus() || 500, error?.message, res);
  }
}
```

---

## Step 6: Replace LoggerService in services

Services that create their own `LoggerService` instance need updating.

### Pattern: Direct instantiation

**Before:**
```typescript
import LoggerService from 'src/logger/logger.service';

@Injectable()
class PaymentService {
  private readonly logger: LoggerService;

  constructor(@Inject('LOGGING_MICROSERVICE') loggingClient: ClientKafka) {
    this.logger = new LoggerService('Payment', loggingClient);
  }

  async process(data: any) {
    this.logger.handleInfoLog('Processing payment');
    // ...
    this.logger.handlErrorLog('Payment failed', error.stack, context);
  }
}
```

**After:**
```typescript
import { ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
class PaymentService {
  constructor(private readonly logger: ObservabilityLogger) {}

  async process(data: any) {
    this.logger.info('processing payment', { amount: data.amount });
    // ...
    this.logger.error('payment failed', { error: error.message, stack: error.stack });
  }
}
```

### Pattern: NestJS Logger (approval services)

Some services use `new Logger(ClassName.name)` (NestJS built-in). These already route through the SDK via `NestPinoLogger` — **no changes needed**.

```typescript
// This already works with the SDK — keep as-is
import { Logger } from '@nestjs/common';

@Injectable()
class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  async approve(id: number) {
    this.logger.log('Approving application');  // routed through NestPinoLogger → Pino
  }
}
```

---

## Step 7: Remove createLoggingContextWithId

Services with `src/utils/logging.util.ts` have a `createLoggingContextWithId` function that manually builds context objects with traceId/spanId. The SDK injects this automatically — delete all usage.

**Before:**
```typescript
import { createLoggingContextWithId } from 'src/utils/logging.util';

const context = createLoggingContextWithId(traceId, spanId, {
  applicationId,
  status: 'approved',
});
this.logger.handleInfoLog('Application approved', context);
```

**After:**
```typescript
this.logger.info('application approved', { applicationId, status: 'approved' });
```

The file `src/utils/logging.util.ts` can be deleted after all references are removed.

---

## Step 8: Replace console.log

Every service has `console.log` statements scattered in controllers, services, and filters. Replace with appropriate logger calls.

| console.log usage | Replacement |
|-------------------|-------------|
| `console.log(\`App running on port ${port}\`)` | Remove — SDK logs startup |
| `console.log('Exception from Microservice', error)` | Remove — SDK exception filter handles this |
| `console.log('Processing event', data)` | `this.logger.info('processing event', { data })` |
| `console.log('Debug:', value)` | `this.logger.debug('debug', { value })` |

---

## Step 9: Add trace propagation to HTTP clients

If your service calls other services via HTTP (most have `src/axios/axios.service.ts`), add trace propagation:

```typescript
import { propagation, context as otelContext } from '@opentelemetry/api';

// In your buildHeaders or request method:
buildHeaders(req: Request): Record<string, any> {
  const headers: Record<string, any> = {
    authorization: req.headers.authorization,
  };
  propagation.inject(otelContext.active(), headers);
  return headers;
}
```

See [Tracing Guide](tracing.md) for details.

---

## Step 10: Clean up unused files

After migration, delete these files (they're no longer needed):

| File | Why it's safe to delete |
|------|----------------------|
| `src/logger/logger.service.ts` | Replaced by `ObservabilityLogger` |
| `src/logger/logger.module.ts` | SDK provides logging globally |
| `src/filters/http.exception.filter.ts` | SDK registers its own exception filter |
| `src/middlewares/morgan.middleware.ts` | SDK logs HTTP requests automatically |
| `src/utils/logging.util.ts` | `createLoggingContextWithId` no longer needed |
| `logs/` directory | No more local log files — stdout to Loki |

Also remove from `package.json`:
- `winston`
- `nest-winston`
- `winston-daily-rotate-file`
- `morgan`
- `@types/morgan`

---

## Step 11: Test and verify

### Build

```bash
npx nest build
```

Fix any import errors — most will be leftover `LoggerService` or `createLoggingContextWithId` imports.

### Start the service

```bash
# Development (pretty logs)
node dist/main.js

# Production (pipe to log file for Promtail)
node dist/main.js 2>&1 | tee /tmp/observability-logs/your-service.log
```

### Verify

```bash
# Health check
curl http://localhost:3000/health

# Metrics
curl http://localhost:3000/metrics

# Send a request and check logs
curl -X POST http://localhost:3000/api/your-endpoint -H "Content-Type: application/json" -d '{}'
```

You should see structured JSON logs with `trace_id`, `request_id`, `service_name`.

### Check Grafana

1. **Loki** — query `{service_name="your-service-name"}` and verify logs appear
2. **Tempo** — search for traces from your service
3. **Prometheus** — check `http_requests_total{service="your-service-name"}`

---

## Method mapping reference

| Old (LoggerService) | New (ObservabilityLogger) |
|---------------------|--------------------------|
| `logger.handleInfoLog(msg)` | `logger.info(msg)` |
| `logger.handleInfoLog(msg, context)` | `logger.info(msg, { key: value })` |
| `logger.handlErrorLog(msg)` | `logger.error(msg)` |
| `logger.handlErrorLog(msg, stack, context)` | `logger.error(msg, { stack })` or `logger.logCaughtError(error)` |
| `logger.handleWarnLog(msg)` | `logger.warn(msg)` |
| `logger.handleWarning(msg, data)` | `logger.warn(msg, { ...data })` |
| `console.log(msg)` | `logger.info(msg)` or `logger.debug(msg)` |
| `new LoggerService('context')` | Inject `ObservabilityLogger` via constructor |
| `new LoggerService('context', kafkaClient)` | Inject `ObservabilityLogger` via constructor (no Kafka needed) |
| `createLoggingContextWithId(traceId, spanId, data)` | Just pass `data` as metadata — trace context is automatic |

---

## FAQ

### Do I still need the LoggerService?

No. Delete `src/logger/logger.service.ts` and `src/logger/logger.module.ts`. The SDK's `ObservabilityLogger` replaces everything.

### Do I still need the Kafka logging client?

No. The SDK writes to stdout. Infrastructure (Promtail) ships logs to Loki. Remove `@Inject('LOGGING_MICROSERVICE')` and the associated `ClientsModule.register()` for the logging consumer group.

### Do I still need @Trace() and @Span() decorator params?

The `@Trace()` and `@Span()` custom decorators that extract `x-trace-id` and `x-span-id` headers are no longer needed for logging. The SDK gets trace context from OpenTelemetry automatically. You can keep them if other logic depends on the header values, but they're not needed for observability.

### What about the logs/ directory?

The SDK doesn't write to local files. Winston's daily rotate files in `logs/` are no longer created. You can delete the `logs/` directory and add it to `.gitignore`.

### Can I migrate gradually?

Yes. The SDK's `NestPinoLogger` captures all NestJS internal logs immediately. You can migrate controllers and services one at a time — old `LoggerService` calls still work alongside the SDK, they just won't have trace context.

### What happens to errors I catch in try/catch?

Use `this.logger.logCaughtError(error)` — it extracts status/message, picks the right log level (warn for 4xx, error for 5xx), and includes stack traces for server errors. This replaces the old `handlErrorLog` pattern.

### What about services that use LoggerModule.register()?

Some services (e.g., profile-microservice) use a dynamic `LoggerModule.register('context')` pattern. Replace with the SDK — `ObservabilityLogger` is globally available without any module registration.
