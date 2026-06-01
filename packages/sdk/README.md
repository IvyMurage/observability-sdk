# @ivymurage-rw/observability

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

Every log line automatically includes `trace_id`, `request_id`, `correlation_id`, and `span_id`.

---

## Quick start

### 1. Install

```bash
npm install @ivymurage-rw/observability

# Pretty logs for local development (recommended)
npm install -D pino-pretty
```

Your NestJS peer dependencies (`@nestjs/common`, `@nestjs/core`, `rxjs`, `reflect-metadata`) are already in your project.

### 2. Wire the module

**app.module.ts** — import `ObservabilityModule` and pick only the instrumentations your service uses:

```typescript
import {
  ObservabilityModule,
  ObservabilityHealthModule,
  httpInstrumentation,
  kafkaInstrumentation,
  redisInstrumentation,
} from '@ivymurage-rw/observability';

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

**main.ts** — add `setupProcessErrorHandlers` at the top to catch bootstrap crashes, then add `bufferLogs: true` and set the SDK logger:

```typescript
import { NestFactory } from '@nestjs/core';
import { setupProcessErrorHandlers, NestPinoLogger } from '@ivymurage-rw/observability';
import { AppModule } from './app.module';

setupProcessErrorHandlers({ serviceName: 'your-service-name' });

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(NestPinoLogger));
  await app.listen(3000);
}
bootstrap();
```

`setupProcessErrorHandlers` catches `uncaughtException` and `unhandledRejection` events that happen before or outside NestJS — like missing modules, database connection failures during import, or Kafka broker unreachable errors. These are output as structured JSON to stderr so your log aggregator can parse them.

### 3. Use in your services

Inject `ObservabilityLogger` anywhere — it's globally available, no extra providers needed:

```typescript
import { Injectable } from '@nestjs/common';
import { ObservabilityLogger, Span } from '@ivymurage-rw/observability';

@Injectable()
export class PaymentService {
  constructor(private logger: ObservabilityLogger) {}

  @Span('process-payment')
  async processPayment(orderId: string) {
    this.logger.info('processing payment', { orderId });
    const result = await this.gateway.charge(orderId);
    this.logger.info('payment completed', { orderId, status: result.status });
    return result;
  }
}
```

### 4. Verify

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

## Configuration reference

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

See traces in your terminal without running an OTel collector:

```typescript
tracing: {
  exporter: { type: 'console' },
}
```

---

## Available instrumentations

| Instrumentation | When to use | Optional dependency |
|----------------|-------------|-------------------|
| `httpInstrumentation()` | Always (traces HTTP requests) | built-in |
| `kafkaInstrumentation()` | Service uses KafkaJS | `@opentelemetry/instrumentation-kafkajs` |
| `redisInstrumentation()` | Service uses Redis/ioredis | `@opentelemetry/instrumentation-ioredis` |
| `mysqlInstrumentation()` | Service uses MySQL | `@opentelemetry/instrumentation-mysql2` |
| `pgInstrumentation()` | Service uses PostgreSQL | `@opentelemetry/instrumentation-pg` |
| `sequelizeInstrumentation()` | Service uses Sequelize (any dialect) | `opentelemetry-instrumentation-sequelize` |

The SDK logs a helpful message if an optional dependency is missing — it won't crash.

---

## Database query observability (Sequelize)

Structured logging and distributed tracing for all Sequelize queries — works with MSSQL (Tedious), PostgreSQL, MySQL, and SQLite. No driver-level patching.

### 1. Add the instrumentation

```typescript
import {
  ObservabilityModule,
  sequelizeInstrumentation,
  httpInstrumentation,
} from '@ivymurage-rw/observability';

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

### 2. Wire Sequelize logging

In your database module, pass `createSequelizeLogging` as Sequelize's `logging` option:

```typescript
import { ObservabilityLogger, createSequelizeLogging } from '@ivymurage-rw/observability';

// In your SequelizeModule.forRootAsync config:
useFactory: (logger: ObservabilityLogger) => ({
  dialect: 'mssql',  // or 'postgres', 'mysql', 'sqlite'
  // ... connection config
  logging: createSequelizeLogging(logger, { slowQueryThreshold: 500 }),
  benchmark: true,  // required — provides query timing
}),
inject: [ObservabilityLogger],
```

### What you get

Every DB query is logged as structured JSON, correlated with the current request:

```json
{
  "level": "debug",
  "msg": "query executed",
  "event": "db.query",
  "db.operation": "SELECT",
  "table": "users",
  "duration_ms": 12,
  "success": true,
  "trace_id": "abc123...",
  "request_id": "req-456...",
  "service_name": "authentication-service"
}
```

Slow queries are automatically logged as warnings:

```json
{
  "level": "warn",
  "msg": "slow query detected",
  "event": "db.slow_query",
  "db.operation": "SELECT",
  "table": "bookings",
  "duration_ms": 3200
}
```

### Configuration options

| Option | Default | Description |
|--------|---------|-------------|
| `logging` | `true` | Enable structured query logging |
| `tracing` | `true` | Enable OpenTelemetry span creation |
| `sanitizeQueries` | `true` | Replace literals with `?` in captured SQL |
| `captureSqlText` | `false` | Include sanitized SQL in logs (disabled for security) |
| `slowQueryThreshold` | `500` | Milliseconds — queries slower than this trigger a warning |

### Security

SQL values are **never** logged by default. When `captureSqlText` is enabled, queries are automatically sanitized:

```
-- Raw (never logged)
SELECT * FROM users WHERE email='ivy@test.com' AND id=123

-- Sanitized (logged when captureSqlText: true)
SELECT * FROM users WHERE email='?' AND id=?
```

### Optional dependency

For OpenTelemetry span tracing, install:

```bash
npm install opentelemetry-instrumentation-sequelize
```

Without it, structured logging still works — you just won't get OTel trace spans for individual queries.

---

## Custom spans

The SDK auto-creates spans for HTTP requests and database queries. Custom spans let you trace **business logic** that happens between those boundaries — the "why was this slow?" that doesn't show up in framework-level instrumentation.

### When to add custom spans

| Use case | Why | Example |
|----------|-----|---------|
| External API calls | Third-party latency is invisible without a span | Credit score API, payment gateway, SMS provider |
| Multi-step business logic | A single request handler that does several things | Loan approval: validate → score → decide → notify |
| Background/async work | Jobs that run outside HTTP request context | Kafka consumers, cron tasks, queue workers |
| Conditional branches | Different code paths with different performance | "fast path" cache hit vs "slow path" DB lookup |
| File/blob operations | I/O that can stall silently | PDF generation, S3 uploads, file parsing |

### `@Span` decorator (recommended for most cases)

Wraps a method in a span automatically. The span starts when the method is called and ends when it resolves (or rejects). Errors are recorded on the span.

```typescript
import { Span, ObservabilityLogger } from '@ivymurage-rw/observability';

@Injectable()
export class LoanService {
  constructor(private logger: ObservabilityLogger) {}

  @Span('validate-loan-application')
  async validateApplication(data: CreateLoanDto) {
    // This entire method is wrapped in a span.
    // If it throws, the span records the error automatically.
    return this.validator.check(data);
  }

  @Span('check-credit-score')
  async getCreditScore(nationalId: string): Promise<number> {
    // External API call — span captures the full round-trip time.
    // In Tempo you'll see: HTTP request → check-credit-score → external call
    const response = await this.httpService.get(`/api/credit/${nationalId}`);
    return response.data.score;
  }

  @Span('process-loan-decision')
  async processDecision(applicationId: string) {
    const app = await this.findApplication(applicationId);
    const score = await this.getCreditScore(app.nationalId);
    // Each @Span method becomes a child span in the trace.
    // Tempo shows the full chain: processDecision → getCreditScore → validateApplication
    if (score >= 700) {
      await this.approve(applicationId);
    } else {
      await this.reject(applicationId, 'Low credit score');
    }
  }
}
```

### Manual spans with `ObservabilityTracer`

Use when you need to attach attributes, track conditional paths, or wrap only part of a method:

```typescript
import { ObservabilityTracer, ObservabilityLogger } from '@ivymurage-rw/observability';

@Injectable()
export class PaymentService {
  constructor(
    private tracer: ObservabilityTracer,
    private logger: ObservabilityLogger,
  ) {}

  async processPayment(orderId: string, amount: number) {
    // Manual span with custom attributes
    return this.tracer.startActiveSpan('process-payment', async (span) => {
      span.setAttribute('order.id', orderId);
      span.setAttribute('payment.amount', amount);
      span.setAttribute('payment.currency', 'RWF');

      try {
        const gateway = await this.selectGateway(amount);
        span.setAttribute('payment.gateway', gateway.name);

        const result = await gateway.charge(orderId, amount);
        span.setAttribute('payment.status', result.status);
        span.setAttribute('payment.transaction_id', result.transactionId);

        this.logger.info('Payment processed', {
          orderId,
          amount,
          gateway: gateway.name,
          transactionId: result.transactionId,
        });

        return result;
      } catch (err) {
        // Error is recorded on span AND logged
        this.logger.error('Payment failed', {
          orderId,
          amount,
          error: err.message,
        });
        throw err; // tracer.startActiveSpan auto-records the error on the span
      }
    });
  }
}
```

### What it looks like in Tempo

Without custom spans:
```
HTTP POST /api/loans/apply  ─────────────────────────── 850ms
  └─ SELECT * FROM applications ...  ── 12ms
  └─ INSERT INTO applications ...  ─── 8ms
```

With custom spans:
```
HTTP POST /api/loans/apply  ─────────────────────────── 850ms
  └─ validate-loan-application  ──────── 15ms
  │   └─ SELECT * FROM applications ... ── 12ms
  └─ check-credit-score  ──────────────── 620ms   ← found the bottleneck
  └─ process-loan-decision  ─────────── 200ms
      └─ INSERT INTO applications ...  ─── 8ms
```

---

## External API observability

Services that call external systems (GIS, payment gateways, government APIs, workflow engines) are the hardest to debug without observability. These calls are often slow, flaky, and outside your control.

### Integration pattern

1. **Swap `Logger` → `ObservabilityLogger`** — logs get `trace_id`, `span_id`, `service_name` automatically
2. **Add `@Span()` to each method** — external call latency becomes visible in Tempo
3. **Use structured metadata** — replace string interpolation with key-value pairs

```typescript
import { ObservabilityLogger, Span } from '@ivymurage-rw/observability';

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

### Recommended span names by integration type

| Integration | Span name | Why trace it |
|-------------|-----------|-------------|
| Access control login | `access-control-login` | Auth token fetch, can timeout |
| ESRI / GIS lookup | `esri-lookup` | External GIS service, 15s timeout |
| Land center lookup | `land-center-lookup` | Government land registry |
| Credit score submission | `credit-score-submit` | Cross-service, affects loan decisions |
| iBank budget lookup | `ibank-budget-lookup` | Core banking integration |
| Minecofin loan submit | `minecofin-loan-submit` | Government system, slow and flaky |
| Workflow start/resume | `workflow-start`, `workflow-resume` | Workflow engine, multi-step |
| Workflow audit history | `workflow-audit-history` | Can return large payloads |
| Auth get departments | `auth-get-departments` | Cross-service lookup |
| Config TAT defaults | `config-tat-defaults` | Configuration service |

### What you see in Tempo

Without spans — one long HTTP request, no breakdown:
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

### Key rules

- **Always `@Span` external calls** — they're the most common source of latency
- **Use `this.logger.error()` in catch blocks** — errors get trace context automatically
- **Use structured metadata** — `{ upi, error: error.message }` not string concatenation
- **Keep span names short and consistent** — `service-action` pattern (e.g., `esri-lookup`, `workflow-start`)

---

## Distributed tracing across services (HTTP)

When Service A calls Service B via HTTP, trace context must be propagated so both services share the same `trace_id`. The SDK uses W3C `traceparent` headers for this.

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

### Peer dependency

Each service that participates in distributed tracing must have `@opentelemetry/api` installed:

```bash
npm install @opentelemetry/api
```

The SDK already includes it as a dependency, but if your service imports from `@opentelemetry/api` directly (for `propagation.inject`), it must be in your `package.json` too.

---

## Microservice setup checklist

Quick reference for adding observability to a new or existing NestJS service.

### Required steps

- [ ] Install SDK: `npm install @ivymurage-rw/observability`
- [ ] Install OTel API: `npm install @opentelemetry/api`
- [ ] **app.module.ts** — add `ObservabilityModule.forRoot({ ... })` and `ObservabilityHealthModule`
- [ ] **main.ts** — add `setupProcessErrorHandlers()`, `bufferLogs: true`, and `app.useLogger(app.get(NestPinoLogger))`
- [ ] Set `serviceName` consistently in both `app.module.ts` and `main.ts`
- [ ] Set tracing exporter to `otlp-http` with your collector endpoint for non-local environments

### For services that call other services (HTTP)

- [ ] Add `propagation.inject(otelContext.active(), headers)` in your HTTP client's header builder
- [ ] Import `{ propagation, context as otelContext } from '@opentelemetry/api'`

### For services with database queries (Sequelize)

- [ ] Add `sequelizeInstrumentation()` to instrumentations array
- [ ] Wire `createSequelizeLogging(logger)` as Sequelize's `logging` option
- [ ] Set `benchmark: true` in Sequelize config

### Common mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| `sampling: { ratio: 0.1 }` in dev | 90% of traces missing in Tempo | Remove sampling config for local dev |
| `exporter: { type: 'console' }` | Traces print to stdout, not sent to collector | Change to `otlp-http` with endpoint |
| Different `serviceName` in `main.ts` vs `app.module.ts` | Health logs show wrong service name | Use same name in both files |
| Missing `propagation.inject()` in HTTP client | Each service generates its own `trace_id` | Add inject call (see distributed tracing section above) |
| Missing `benchmark: true` in Sequelize | Query duration always `0` | Add `benchmark: true` to Sequelize config |

---

## Kafka context propagation

Kafka messages are fire-and-forget — without trace propagation, the consumer has no idea which request triggered the message. The SDK bridges this gap by injecting/extracting W3C trace context in Kafka headers.

### How it works

```
Producer (api-gateway)                    Consumer (notification-service)
─────────────────────                     ──────────────────────────────
HTTP request arrives                      Kafka message received
  └─ trace_id: abc123                       └─ headers contain traceparent
  └─ producer.send()                        └─ withKafkaContext() extracts it
     └─ injectKafkaHeaders()                └─ trace_id: abc123 (same!)
        └─ adds traceparent to headers      └─ child span created
```

In Tempo, you see the full chain: `HTTP request → kafka-produce → kafka-consume → process-event` all under one trace.

### Step 1: Add instrumentation (app.module.ts)

```typescript
import {
  ObservabilityModule,
  httpInstrumentation,
  kafkaInstrumentation,
} from '@ivymurage-rw/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'api-gateway',
      instrumentations: [
        httpInstrumentation(),
        kafkaInstrumentation(),  // Auto-instruments kafkajs produce/consume
      ],
    }),
  ],
})
export class AppModule {}
```

This auto-instruments `kafkajs` — every `producer.send()` and `consumer.run()` gets traced automatically with zero code changes.

### Step 2: Manual header injection (for custom producers)

If you build Kafka messages manually or use a wrapper, inject headers explicitly:

```typescript
import { injectKafkaHeaders, ObservabilityLogger } from '@ivymurage-rw/observability';

@Injectable()
export class NotificationProducer {
  constructor(private logger: ObservabilityLogger) {}

  async sendLoanApprovalNotification(loanId: string, userId: string) {
    const payload = { loanId, userId, type: 'LOAN_APPROVED' };

    await this.producer.send({
      topic: 'notifications',
      messages: [{
        key: userId,
        value: JSON.stringify(payload),
        // injectKafkaHeaders() reads the active trace context
        // and adds traceparent + tracestate to headers
        headers: injectKafkaHeaders({
          'x-event-type': 'LOAN_APPROVED',
        }),
      }],
    });

    this.logger.info('Notification event published', { loanId, userId, topic: 'notifications' });
  }
}
```

### Step 3: Consumer — extract context and continue the trace

```typescript
import { withKafkaContext, ObservabilityLogger } from '@ivymurage-rw/observability';

@Injectable()
export class NotificationConsumer {
  constructor(private logger: ObservabilityLogger) {}

  async onModuleInit() {
    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        // withKafkaContext extracts the traceparent from message headers,
        // creates a consumer span, and runs your handler inside that context.
        // All logs inside the callback get the original trace_id.
        await withKafkaContext(
          message.headers,
          `process-${topic}`,
          async () => {
            const payload = JSON.parse(message.value.toString());

            this.logger.info('Processing notification', {
              topic,
              partition,
              eventType: payload.type,
              userId: payload.userId,
            });

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

### Peer dependencies

```bash
npm install kafkajs
npm install @opentelemetry/instrumentation-kafkajs
```

Both are optional — the SDK skips Kafka instrumentation if they're not installed.

---

## Migrating from Winston / Morgan / custom loggers

Migration touches 3 files: `app.module.ts`, `main.ts`, and any service that injects your old logger.

### 1. app.module.ts — comment out old logging

```typescript
// Before
import LoggerModule from './logger/logger.module';
import MorganMiddleware from './middlewares/morgan.middleware';

@Module({
  imports: [LoggerModule.register('App'), ...],
})
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MorganMiddleware).forRoutes('*');
  }
}

// After
// import LoggerModule from './logger/logger.module';
// import MorganMiddleware from './middlewares/morgan.middleware';
import { ObservabilityModule, ObservabilityHealthModule, httpInstrumentation } from '@ivymurage-rw/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: 'my-service', instrumentations: [httpInstrumentation()] }),
    ObservabilityHealthModule,
    // LoggerModule.register('App'),
    ...
  ],
})
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // consumer.apply(MorganMiddleware).forRoutes('*');
  }
}
```

### 2. main.ts — swap the logger and add process error handling

```typescript
// Before
const app = await NestFactory.create(AppModule);

// After
import { setupProcessErrorHandlers, NestPinoLogger } from '@ivymurage-rw/observability';

setupProcessErrorHandlers({ serviceName: 'my-service' });

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(NestPinoLogger));
```

### 3. Services — replace logger injection

```typescript
// Before
import LoggerService from './logger/logger.service';

@Injectable()
export class MyService {
  constructor(private loggerService: LoggerService) {}

  doWork() {
    this.loggerService.handleInfoLog('doing work');
  }
}

// After
import { ObservabilityLogger } from '@ivymurage-rw/observability';

@Injectable()
export class MyService {
  constructor(private logger: ObservabilityLogger) {}

  doWork() {
    this.logger.info('doing work');
  }
}
```

### Logger method mapping

| Winston / custom | SDK equivalent |
|-----------------|----------------|
| `logger.log(msg)` | `logger.info(msg)` |
| `logger.handleInfoLog(msg)` | `logger.info(msg)` |
| `logger.handleErrorLog(msg)` | `logger.error(msg)` |
| `logger.warn(msg)` | `logger.warn(msg)` |
| `logger.debug(msg)` | `logger.debug(msg)` |
| `console.log(msg)` | `logger.info(msg)` |

### Structured context instead of string concatenation

```typescript
// Before
console.log(`Order ${orderId} created by user ${userId}`);

// After — searchable and filterable
this.logger.info('order created', { orderId, userId });
```

---

## Developer setup (GitHub Packages)

The SDK is published to GitHub Packages. To install it in your service:

### 1. Create a GitHub personal access token

You need a token with `read:packages` scope:

1. Go to **GitHub > Settings > Developer settings > Personal access tokens > Tokens (classic)**
2. Generate a new token with the `read:packages` scope
3. Copy the token

### 2. Add `.npmrc` to your service

Create a `.npmrc` file in your service root (next to `package.json`):

```
@ivymurage-rw:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

### 3. Set the token

Add `GITHUB_TOKEN` to your environment. Choose one:

**Option A — shell export (quick)**
```bash
export GITHUB_TOKEN=ghp_your_token_here
```

**Option B — project `.env` file**
```bash
# .env (git-ignored)
GITHUB_TOKEN=ghp_your_token_here
```

**Option C — global `~/.npmrc` (set once, works everywhere)**
```
//npm.pkg.github.com/:_authToken=ghp_your_token_here
```

### 4. Install

```bash
npm install @ivymurage-rw/observability
```

### 5. CI/CD

In your CI pipeline, set `GITHUB_TOKEN` as a secret:

```yaml
# GitHub Actions example
- run: npm install
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

> **Note:** The built-in `GITHUB_TOKEN` in GitHub Actions already has `read:packages` for packages in the same org. No extra secrets needed.

---

## Exports reference

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

---

## Local development sandbox

For a full observability stack (Grafana, Prometheus, Loki, Tempo):

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
