# @brdrwanda/observability

Structured logging, distributed tracing, and Prometheus metrics for NestJS services. Drop-in module — takes about 10 minutes to integrate.

## What you get

| Feature | How | Endpoint |
|---------|-----|----------|
| Structured JSON logs | Pino with trace correlation | stdout |
| Distributed tracing | OpenTelemetry with W3C propagation | configurable exporter |
| Prometheus metrics | Auto-registered process + HTTP metrics | `GET /metrics` |
| Health checks | Liveness, readiness, and startup probes | `GET /health` |
| Sensitive data redaction | Passwords, tokens, keys auto-censored | automatic |
| Request context | Request ID, correlation ID via AsyncLocalStorage | automatic |
| Error classification | Smart extraction with log levels (4xx=warn, 5xx=error) | automatic |
| Metric exemplars | Histogram observations carry `trace_id` for metrics→traces correlation | automatic |

Every log line automatically includes `trace_id`, `request_id`, `correlation_id`, and `span_id`.

---

# Part 1: Setup

## 1. Install

```bash
npm install @brdrwanda/observability

# Pretty logs for local development (recommended)
npm install -D pino-pretty
```

Your NestJS peer dependencies (`@nestjs/common`, `@nestjs/core`, `rxjs`, `reflect-metadata`) are already in your project.

## 2. Wire the module

**app.module.ts** — import `ObservabilityModule` and pick only the instrumentations your service uses:

```typescript
import {
  ObservabilityModule,
  ObservabilityHealthModule,
  httpInstrumentation,
  kafkaInstrumentation,
  redisInstrumentation,
} from '@brdrwanda/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'your-service-name',
      instrumentations: [
        httpInstrumentation({ ignoreIncomingPaths: ['/health', '/metrics'] }),
        kafkaInstrumentation(),
        redisInstrumentation(),
      ],
    }),
    ObservabilityHealthModule,
    // ... your other modules
  ],
})
export class AppModule {}
```

**main.ts** — add `setupProcessErrorHandlers` at the top, `bufferLogs: true`, set the SDK logger, and **remove any custom exception filters**:

```typescript
import { NestFactory } from '@nestjs/core';
import { setupProcessErrorHandlers, NestPinoLogger } from '@brdrwanda/observability';
import { AppModule } from './app.module';

setupProcessErrorHandlers({ serviceName: 'your-service-name' });

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(NestPinoLogger));

  // IMPORTANT: Do NOT add app.useGlobalFilters(new HttpExceptionFilter())
  // The SDK registers its own exception filter via APP_FILTER automatically.
  // Custom exception filters override the SDK and break error logging.

  await app.listen(3000);
}
bootstrap();
```

`setupProcessErrorHandlers` catches `uncaughtException` and `unhandledRejection` events that happen before or outside NestJS — like missing modules, database connection failures during import, or Kafka broker unreachable errors.

## 3. Use in your services

Inject `ObservabilityLogger` anywhere — it's globally available, no extra providers needed:

```typescript
import { Injectable } from '@nestjs/common';
import { ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class PaymentService {
  constructor(private logger: ObservabilityLogger) {}

  async processPayment(orderId: string) {
    this.logger.info('processing payment', { orderId });
    const result = await this.gateway.charge(orderId);
    this.logger.info('payment completed', { orderId, status: result.status });
    return result;
  }
}
```

## 4. Verify

```bash
curl http://localhost:3000/health    # health check
curl http://localhost:3000/metrics   # prometheus metrics
```

You should see structured logs in your terminal:

```
[15:58:07.768] INFO (your-service/12345): request completed
    service_name: "your-service"
    environment: "development"
    trace_id: "abc123..."
    request_id: "req-456..."
```

---

# Part 2: What the SDK does automatically

Once set up, the SDK handles these without any extra code:

## Auto request logging

Every HTTP request produces two log entries:

```json
{"level":"info","msg":"request started","method":"POST","url":"/api/users/login","trace_id":"abc..."}
{"level":"info","msg":"request completed","method":"POST","url":"/api/users/login","statusCode":200,"duration_ms":142.5}
```

## Auto error classification

The SDK's exception filter catches all thrown exceptions and logs them with smart message extraction and proper log levels:

| Status | Level | Event | Example message |
|--------|-------|-------|-----------------|
| 400 | `warn` | `bad_request` | `Invalid token provided` |
| 400 (validation) | `warn` | `validation_failed` | `email must be valid, name required` |
| 401 | `warn` | `authentication_failed` | `jwt malformed` |
| 403 | `warn` | `authorization_failed` | `Insufficient permissions` |
| 404 | `warn` | `not_found` | `Cannot GET /api/nonexistent` |
| 500 | `error` | `server_error` | `Connection refused` (includes stack trace) |

Example log output for a validation error:

```json
{
  "level": "warn",
  "msg": "validation_failed",
  "event": "validation_failed",
  "statusCode": 400,
  "message": "email must be valid, name should not be empty",
  "validationErrors": ["email must be valid", "name should not be empty"],
  "method": "POST",
  "url": "/api/users/login",
  "trace_id": "abc123...",
  "span_id": "def456..."
}
```

**Important:** The exception filter only catches exceptions that **propagate** — if your controller catches errors in a `try/catch` and returns a manual response, the SDK never sees them. See [Logging errors in catch blocks](#logging-errors-in-catch-blocks) for how to handle this.

## Auto HTTP metrics

Every request records:
- `http_requests_total` — Counter with `method`, `route`, `status_code` labels
- `http_request_duration_seconds` — Histogram with p50/p95/p99 percentiles

### Exemplars (metrics → traces correlation)

The histogram automatically attaches the current `trace_id` as an **exemplar** on every observation. In Grafana, this shows as clickable dots on metric graphs — click one to jump directly to the trace that caused a latency spike or error.

Requires:
- Prometheus with `--enable-feature=exemplar-storage` (already configured in sandbox)
- Grafana Prometheus datasource with exemplar-to-Tempo link (already provisioned)

No code changes needed in your service — the SDK handles it.

## Auto trace context

All log entries include `trace_id`, `span_id`, `service_name`, `environment` from OpenTelemetry context. No manual passing needed.

---

# Part 3: Adding business logic logging

The SDK handles request lifecycle and exceptions automatically. For business-specific events, you add logging in your code.

## When to add manual logging

| Situation | What to log | Level |
|-----------|------------|-------|
| Business decision | Loan approved/rejected, payment processed | `info` |
| Expected failure | Wrong password, insufficient balance | `warn` |
| External call | Before/after calling third-party API | `info` |
| Unexpected error | Unhandled exception in catch block | `error` |

## Logging errors in catch blocks

Many controllers use `try/catch` with `ResponseCommon.handleError()`. The SDK's exception filter never sees these errors because they're caught before propagating. Add logging in the catch block:

### Option A: Inline (simple, for a few catch blocks)

```typescript
import { ObservabilityLogger } from '@brdrwanda/observability';

@Controller('api/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly logger: ObservabilityLogger,
  ) {}

  @Post('login')
  async login(@Body() dto: UserLoginDto, @Res() res: Response) {
    try {
      const user = await this.usersService.login(dto);
      return ResponseCommon.handleSuccess(HttpStatus.OK, 'Login successful', res, user);
    } catch (error) {
      this.logger.warn('Login failed', {
        statusCode: error?.getStatus?.() || 500,
        message: error?.message,
      });
      return ResponseCommon.handleError(error?.getStatus() || 500, error?.message, res);
    }
  }
}
```

### Option B: Helper method (recommended for controllers with many catch blocks)

```typescript
import { ObservabilityLogger } from '@brdrwanda/observability';

@Controller('api/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly logger: ObservabilityLogger,
  ) {}

  private logCaughtError(error: any): void {
    const status = error?.getStatus?.() || error?.statusCode || 500;
    const message = error?.response?.message || error?.message || 'Unknown error';
    if (status >= 500) {
      this.logger.error('request_error', { statusCode: status, message, stack: error?.stack });
    } else {
      this.logger.warn('request_error', { statusCode: status, message });
    }
  }

  @Post('login')
  async login(@Body() dto: UserLoginDto, @Res() res: Response) {
    try {
      const user = await this.usersService.login(dto);
      return ResponseCommon.handleSuccess(HttpStatus.OK, 'Login successful', res, user);
    } catch (error) {
      this.logCaughtError(error);
      return ResponseCommon.handleError(error?.getStatus() || 500, error?.message, res);
    }
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Res() res: Response) {
    try {
      const result = await this.usersService.forgotPassword(dto);
      return ResponseCommon.handleSuccess(HttpStatus.OK, 'Reset link sent', res, result);
    } catch (error) {
      this.logCaughtError(error);
      return ResponseCommon.handleError(error?.getStatus() || 500, error?.message, res);
    }
  }
}
```

The helper extracts the real message from NestJS exception shapes, picks the right log level, and includes stack traces only for 5xx. All entries automatically get `trace_id` and `span_id` from the SDK's pino mixin.

### Output examples

Wrong password (401):
```json
{"level":"warn","msg":"request_error","statusCode":401,"message":"Username or password is incorrect","trace_id":"abc...","service_name":"authentication-service"}
```

Database timeout (500):
```json
{"level":"error","msg":"request_error","statusCode":500,"message":"Connection acquire timeout","stack":"Error: ...","trace_id":"abc..."}
```

## Structured metadata instead of string concatenation

```typescript
// Bad — not searchable, not filterable
this.logger.info(`Order ${orderId} created by user ${userId}`);

// Good — searchable in Loki: {msg="order created"} | json | orderId="123"
this.logger.info('order created', { orderId, userId });
```

---

# Part 4: Distributed tracing

## HTTP trace propagation

When Service A calls Service B via HTTP, trace context must be propagated so both services share the same `trace_id`.

### How it works

1. **Incoming request** — the SDK's `TracingInterceptor` extracts the `traceparent` header and creates a child span
2. **Outgoing request** — you inject the current trace context into outgoing HTTP headers using `propagation.inject()`
3. **Result** — both services log the same `trace_id`, and Tempo shows the full request chain

### Setup in your HTTP client (AxiosService / fetch wrapper)

Add two imports and one line where you build outgoing headers:

```typescript
import { propagation, context as otelContext } from '@opentelemetry/api';

// In your buildHeaders() or wherever you construct outgoing request headers:
const headers: Record<string, any> = {
  authorization: req.headers.authorization,
  'x-trace-id': traceId,
  // ... other headers
};

// Inject W3C traceparent header for distributed tracing
propagation.inject(otelContext.active(), headers);

return headers;
```

`propagation.inject()` adds the `traceparent` header (e.g., `00-<trace_id>-<span_id>-01`) to the headers object. The receiving service's SDK automatically extracts it.

### Verify it works

1. Send a request that crosses services (e.g., api-gateway → auth-service)
2. Check logs — both services should show the **same** `trace_id`
3. Search that `trace_id` in Tempo — you should see spans from both services in one trace

```
# api-gateway log
trace_id: "8cf631b00df8e35a403e57823ac58eee"
service_name: "api-gateway"

# auth-service log
trace_id: "8cf631b00df8e35a403e57823ac58eee"
service_name: "authentication-service"
```

## Kafka context propagation

Kafka messages are fire-and-forget — without trace propagation, the consumer has no idea which request triggered the message.

### Step 1: Add instrumentation (app.module.ts)

```typescript
import {
  ObservabilityModule,
  httpInstrumentation,
  kafkaInstrumentation,
} from '@brdrwanda/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'api-gateway',
      instrumentations: [
        httpInstrumentation(),
        kafkaInstrumentation(),
      ],
    }),
  ],
})
export class AppModule {}
```

This auto-instruments `kafkajs` — every `producer.send()` and `consumer.run()` gets traced automatically.

### Step 2: Manual header injection (for custom producers)

```typescript
import { injectKafkaHeaders, ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class NotificationProducer {
  constructor(private logger: ObservabilityLogger) {}

  async sendLoanApprovalNotification(loanId: string, userId: string) {
    await this.producer.send({
      topic: 'notifications',
      messages: [{
        key: userId,
        value: JSON.stringify({ loanId, userId, type: 'LOAN_APPROVED' }),
        headers: injectKafkaHeaders({ 'x-event-type': 'LOAN_APPROVED' }),
      }],
    });

    this.logger.info('Notification event published', { loanId, userId, topic: 'notifications' });
  }
}
```

### Step 3: Consumer — extract context and continue the trace

```typescript
import { withKafkaContext, ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class NotificationConsumer {
  constructor(private logger: ObservabilityLogger) {}

  async onModuleInit() {
    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        await withKafkaContext(
          message.headers,
          `process-${topic}`,
          async () => {
            const payload = JSON.parse(message.value.toString());
            this.logger.info('Processing notification', { topic, eventType: payload.type });

            switch (payload.type) {
              case 'LOAN_APPROVED':
                await this.sendApprovalEmail(payload);
                break;
              case 'LOAN_REJECTED':
                await this.sendRejectionEmail(payload);
                break;
              default:
                this.logger.warn('Unknown event type', { eventType: payload.type });
            }
          },
        );
      },
    });
  }
}
```

### What you see in Tempo

```
HTTP POST /api/loans/apply  ──────────────────── 850ms   (api-gateway)
  └─ process-loan-decision  ────────── 200ms
  └─ notifications send  ──────────── 5ms               (kafka produce)
      └─ process-notifications  ────── 120ms             (notification-service)
          └─ send-approval-email  ──── 95ms
```

All under one `trace_id`, across services, across Kafka.

---

# Part 5: Custom spans and external API tracing

## Custom spans

The SDK auto-creates spans for HTTP requests and database queries. Custom spans let you trace **business logic** — the "why was this slow?" that framework-level instrumentation doesn't show.

### When to add custom spans

| Use case | Why | Example |
|----------|-----|---------|
| External API calls | Third-party latency is invisible without a span | Credit score API, payment gateway, SMS provider |
| Multi-step business logic | A single handler that does several things | Loan approval: validate → score → decide → notify |
| Background/async work | Jobs outside HTTP request context | Kafka consumers, cron tasks, queue workers |
| Conditional branches | Different code paths with different performance | Cache hit vs DB lookup |

### `@Span` decorator (recommended)

```typescript
import { Span, ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class LoanService {
  constructor(private logger: ObservabilityLogger) {}

  @Span('validate-loan-application')
  async validateApplication(data: CreateLoanDto) {
    return this.validator.check(data);
  }

  @Span('check-credit-score')
  async getCreditScore(nationalId: string): Promise<number> {
    const response = await this.httpService.get(`/api/credit/${nationalId}`);
    return response.data.score;
  }

  @Span('process-loan-decision')
  async processDecision(applicationId: string) {
    const app = await this.findApplication(applicationId);
    const score = await this.getCreditScore(app.nationalId);
    if (score >= 700) {
      await this.approve(applicationId);
    } else {
      await this.reject(applicationId, 'Low credit score');
    }
  }
}
```

### Manual spans with `ObservabilityTracer`

Use when you need custom attributes on the span:

```typescript
import { ObservabilityTracer, ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class PaymentService {
  constructor(private tracer: ObservabilityTracer, private logger: ObservabilityLogger) {}

  async processPayment(orderId: string, amount: number) {
    return this.tracer.startActiveSpan('process-payment', async (span) => {
      span.setAttribute('order.id', orderId);
      span.setAttribute('payment.amount', amount);

      const result = await this.gateway.charge(orderId, amount);
      span.setAttribute('payment.status', result.status);
      return result;
    });
  }
}
```

## External API observability

Services that call external systems are the hardest to debug without observability. Add `@Span` + `ObservabilityLogger` to trace every external call.

### Pattern

1. Inject `ObservabilityLogger` in constructor
2. Add `@Span('service-action')` to each external call method
3. Use structured metadata in logs

```typescript
import { ObservabilityLogger, Span } from '@brdrwanda/observability';

@Injectable()
export class ExternalIntegrationService {
  constructor(
    private readonly axiosService: AxiosService,
    private readonly logger: ObservabilityLogger,
  ) {}

  @Span('esri-lookup')
  async getESRIInfo(upi: string) {
    try {
      this.logger.info('Fetching ESRI data', { upi });
      const result = await this.axiosService.request('GET', `${url}/api/external/esri/upi`, ...);
      this.logger.info('ESRI data received', { upi });
      return result;
    } catch (error) {
      this.logger.error('ESRI lookup failed', { upi, error: error.message });
      return null;
    }
  }
}
```

### Recommended span names

| Integration | Span name | Why trace it |
|-------------|-----------|-------------|
| Access control login | `access-control-login` | Auth token fetch, can timeout |
| ESRI / GIS lookup | `esri-lookup` | External GIS service, 15s timeout |
| Land center lookup | `land-center-lookup` | Government land registry |
| Credit score submission | `credit-score-submit` | Cross-service, affects loan decisions |
| iBank budget lookup | `ibank-budget-lookup` | Core banking integration |
| Minecofin loan submit | `minecofin-loan-submit` | Government system, slow and flaky |
| Workflow start/resume | `workflow-start`, `workflow-resume` | Workflow engine, multi-step |
| Auth get departments | `auth-get-departments` | Cross-service lookup |

### What you see in Tempo

Without spans:
```
HTTP POST /api/loans/apply  ─────────────────────── 3200ms
```

With `@Span` on each external call:
```
HTTP POST /api/loans/apply  ─────────────────────── 3200ms
  └─ access-control-login  ────── 450ms
  └─ esri-lookup  ─────────────── 1800ms   ← bottleneck found
  └─ credit-score-submit  ─────── 320ms
  └─ workflow-start  ──────────── 180ms
```

---

# Part 6: Database observability (Sequelize)

Structured logging and distributed tracing for all Sequelize queries — works with MSSQL (Tedious), PostgreSQL, MySQL, and SQLite.

## 1. Add the instrumentation

```typescript
import {
  ObservabilityModule,
  sequelizeInstrumentation,
  httpInstrumentation,
} from '@brdrwanda/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'my-service',
      instrumentations: [
        httpInstrumentation(),
        sequelizeInstrumentation({ slowQueryThreshold: 500 }),
      ],
    }),
  ],
})
export class AppModule {}
```

## 2. Wire Sequelize logging

```typescript
import { ObservabilityLogger, createSequelizeLogging } from '@brdrwanda/observability';

useFactory: (logger: ObservabilityLogger) => ({
  dialect: 'mssql',
  logging: createSequelizeLogging(logger, { slowQueryThreshold: 500 }),
  benchmark: true,  // required — provides query timing
}),
inject: [ObservabilityLogger],
```

## What you get

```json
{"level":"debug","msg":"query executed","event":"db.query","db.operation":"SELECT","table":"users","duration_ms":12,"trace_id":"abc..."}
{"level":"warn","msg":"slow query detected","event":"db.slow_query","db.operation":"SELECT","table":"bookings","duration_ms":3200}
```

## Configuration options

| Option | Default | Description |
|--------|---------|-------------|
| `slowQueryThreshold` | `500` | Milliseconds — queries slower than this trigger a warning |
| `sanitizeQueries` | `true` | Replace literals with `?` in captured SQL |
| `captureSqlText` | `false` | Include sanitized SQL in logs |

---

# Part 7: Migration guide

## Migrating from Winston / Morgan / custom loggers

Migration touches 3 files: `app.module.ts`, `main.ts`, and any service that injects your old logger.

### 1. app.module.ts — comment out old logging

```typescript
// Before
import LoggerModule from './logger/logger.module';
import MorganMiddleware from './middlewares/morgan.middleware';

// After
// import LoggerModule from './logger/logger.module';
// import MorganMiddleware from './middlewares/morgan.middleware';
import { ObservabilityModule, ObservabilityHealthModule, httpInstrumentation } from '@brdrwanda/observability';
```

### 2. main.ts — swap logger, remove custom exception filter

```typescript
import { setupProcessErrorHandlers, NestPinoLogger } from '@brdrwanda/observability';

setupProcessErrorHandlers({ serviceName: 'my-service' });

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(NestPinoLogger));

// REMOVE these lines:
// import HttpExceptionFilter from './filters/http.exception.filter';
// app.useGlobalFilters(new HttpExceptionFilter());
```

### 3. Services — replace logger injection

```typescript
// Before
import LoggerService from './logger/logger.service';
constructor(private loggerService: LoggerService) {}
this.loggerService.handleInfoLog('doing work');

// After
import { ObservabilityLogger } from '@brdrwanda/observability';
constructor(private logger: ObservabilityLogger) {}
this.logger.info('doing work');
```

### Logger method mapping

| Winston / custom | SDK equivalent |
|-----------------|----------------|
| `logger.log(msg)` | `logger.info(msg)` |
| `logger.handleInfoLog(msg)` | `logger.info(msg)` |
| `logger.handleErrorLog(msg)` | `logger.error(msg)` |
| `logger.warn(msg)` | `logger.warn(msg)` |
| `console.log(msg)` | `logger.info(msg)` |

---

# Part 8: Configuration reference

## Full configuration

All fields except `serviceName` are optional with sensible defaults.

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',        // required
  environment: 'production',        // defaults to NODE_ENV
  version: '1.2.3',                 // defaults to npm_package_version

  logger: {
    level: 'info',                  // debug | info | warn | error | fatal
    prettyPrint: false,             // auto: true in dev, false in prod
    redaction: {
      paths: ['*.password', '*.ssn'],
      censor: '[REDACTED]',
    },
  },

  tracing: {
    enabled: true,
    exporter: {
      type: 'otlp-http',           // otlp-http | otlp-grpc | console | none
      endpoint: 'http://otel-collector:4318',
    },
    sampling: {
      ratio: 0.1,                  // 10% in prod (auto: 100% in dev)
    },
  },

  metrics: {
    enabled: true,
    prefix: 'myservice',           // metric name prefix
    defaultMetrics: true,           // Node.js process metrics
    labels: { team: 'platform' },
  },

  instrumentations: [ /* ... */ ],
})
```

### Local development tip

```typescript
tracing: {
  exporter: { type: 'console' },  // traces print to terminal, no collector needed
}
```

## Available instrumentations

| Instrumentation | When to use | Optional dependency |
|----------------|-------------|-------------------|
| `httpInstrumentation()` | Always | built-in |
| `kafkaInstrumentation()` | KafkaJS | `@opentelemetry/instrumentation-kafkajs` |
| `redisInstrumentation()` | Redis/ioredis | `@opentelemetry/instrumentation-ioredis` |
| `mysqlInstrumentation()` | MySQL | `@opentelemetry/instrumentation-mysql2` |
| `pgInstrumentation()` | PostgreSQL | `@opentelemetry/instrumentation-pg` |
| `sequelizeInstrumentation()` | Sequelize | `opentelemetry-instrumentation-sequelize` |

## Microservice setup checklist

### Required steps

- [ ] Install SDK: `npm install @brdrwanda/observability`
- [ ] **app.module.ts** — add `ObservabilityModule.forRoot({ ... })` and `ObservabilityHealthModule`
- [ ] **main.ts** — add `setupProcessErrorHandlers()`, `bufferLogs: true`, `app.useLogger(app.get(NestPinoLogger))`
- [ ] **main.ts** — remove `app.useGlobalFilters(new HttpExceptionFilter())`
- [ ] Set tracing exporter to `otlp-http` with your collector endpoint

### For services that call other services (HTTP)

- [ ] Add `propagation.inject(otelContext.active(), headers)` in your HTTP client
- [ ] Import `{ propagation, context as otelContext } from '@opentelemetry/api'`

### For services with database queries (Sequelize)

- [ ] Add `sequelizeInstrumentation()` to instrumentations array
- [ ] Wire `createSequelizeLogging(logger)` as Sequelize's `logging` option
- [ ] Set `benchmark: true` in Sequelize config

### Common mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Custom `HttpExceptionFilter` in `main.ts` | Errors not logged by SDK | Remove `app.useGlobalFilters(...)` |
| `try/catch` swallows exceptions | SDK filter never sees errors | Add `this.logCaughtError(error)` or `this.logger.warn(...)` in catch |
| `sampling: { ratio: 0.1 }` in dev | 90% of traces missing | Remove sampling config for local dev |
| `exporter: { type: 'console' }` | Traces not sent to collector | Change to `otlp-http` |
| Different `serviceName` in `main.ts` vs `app.module.ts` | Wrong service name in logs | Use same name in both files |

---

# Part 9: Reference

## Exports

| Export | Type | Purpose |
|--------|------|---------|
| `ObservabilityModule` | NestJS Module | Main module — use `.forRoot(config)` |
| `ObservabilityHealthModule` | NestJS Module | Health check endpoints |
| `ObservabilityLogger` | Injectable Service | Structured logging |
| `NestPinoLogger` | Logger | NestJS logger replacement |
| `ObservabilityTracer` | Injectable Service | Manual span management |
| `ObservabilityMetrics` | Injectable Service | Custom Prometheus metrics |
| `Span` | Decorator | Automatic span creation on methods |
| `DiagnosticsService` | Injectable Service | Runtime diagnostics report |
| `httpInstrumentation` | Factory | HTTP request tracing |
| `kafkaInstrumentation` | Factory | Kafka producer/consumer tracing |
| `redisInstrumentation` | Factory | Redis/ioredis tracing |
| `mysqlInstrumentation` | Factory | MySQL tracing |
| `pgInstrumentation` | Factory | PostgreSQL tracing |
| `sequelizeInstrumentation` | Factory | Sequelize query tracing (all dialects) |
| `createSequelizeLogging` | Function | Structured DB query logging for Sequelize |
| `createSequelizeErrorLogging` | Function | Structured DB error logging for Sequelize |
| `sanitizeQuery` | Function | Remove literals from SQL strings |
| `parseQuery` | Function | Extract operation, table, and sanitized SQL |
| `injectKafkaHeaders` | Function | Inject trace context into Kafka headers |
| `withKafkaContext` | Function | Extract trace context from Kafka headers |
| `getContext` | Function | Get current request context |
| `runWithContext` | Function | Run code within a request context |
| `setupProcessErrorHandlers` | Function | Catch bootstrap crashes as structured JSON |
| `setupTracing` | Function | Early tracing init (before NestJS bootstrap) |
| `sanitizeHeaders` | Function | Redact sensitive header values |

## Installation

Published on npm under the `@brdrwanda` org. No token or `.npmrc` needed.

```bash
npm install @brdrwanda/observability
```

### Publishing (maintainers only)

```bash
# One-time: login to npm with an account that belongs to the @brdrwanda org
npm login

# Publish
cd packages/sdk
npm run build
npm publish --access public
```

## Standalone mode (pure Node.js / Express / Fastify)

No NestJS required. Import from `@brdrwanda/observability/standalone`:

```typescript
import { createObservability } from '@brdrwanda/observability/standalone';
import { httpInstrumentation } from '@brdrwanda/observability';
import express from 'express';

const obs = createObservability({
  serviceName: 'my-worker',
  tracing: { exporter: { type: 'otlp-http', endpoint: 'http://localhost:4318' } },
  instrumentations: [httpInstrumentation({ ignoreIncomingPaths: ['/health', '/metrics'] })],
});

const app = express();

// Request context + logging middleware
app.use(obs.middleware());

// Health + metrics endpoints
app.get('/health', obs.healthHandler);
app.get('/metrics', obs.metricsHandler);

// Your routes
app.get('/api/data', (req, res) => {
  obs.logger.info('fetching data', { userId: req.query.userId });
  res.json({ ok: true });
});

// Custom metrics
const jobsCounter = obs.metrics.createCounter('jobs_processed_total', 'Jobs processed', ['type']);
jobsCounter.inc({ type: 'email' });

// Custom spans
const result = await obs.tracer.startActiveSpan('process-job', async () => {
  return doWork();
});

// Graceful shutdown
process.on('SIGTERM', () => obs.shutdown());

app.listen(3000);
```

What you get — same as NestJS mode:
- Structured JSON logs with `trace_id`, `request_id`
- Distributed tracing (OpenTelemetry)
- Prometheus metrics at `/metrics`
- Health check at `/health`
- All instrumentations (HTTP, Redis, Kafka, etc.)

## Signal correlation (metrics ↔ logs ↔ traces)

The SDK and sandbox Grafana datasources are pre-configured so all three signals link together:

```
         exemplars (trace_id on metric points)
Metrics ─────────────────────────────────────→ Traces
                                                  │
   Derived field (trace_id regex → Tempo link)    │
Logs ←────────────────────────────────────────────┘
  ↑          Trace-to-logs query
  └──────────────────────────────────────── Traces
```

- **Dashboard graph** → click exemplar dot → **exact trace** in Tempo
- **Trace view** → "Logs for this trace" → **all log lines** for that request
- **Log line** → click `trace_id` → **full trace** in Tempo
- **Trace view** → "Request rate" / "Error rate" → **metrics** at that timestamp

No code changes needed — the SDK attaches `trace_id` exemplars automatically.

## Local development sandbox

```bash
pnpm sandbox:up    # start
pnpm sandbox:down  # stop
```

| Tool | URL | Credentials |
|------|-----|-------------|
| Grafana | http://localhost:3000 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| Traces | Grafana > Explore > Tempo | — |
| Logs | Grafana > Explore > Loki | — |
