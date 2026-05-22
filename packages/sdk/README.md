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

Use the `@Span` decorator for automatic span management, or `ObservabilityTracer` for manual control:

```typescript
import { ObservabilityTracer, Span } from '@ivymurage-rw/observability';

@Injectable()
export class OrderService {
  constructor(private tracer: ObservabilityTracer) {}

  // Decorator — creates and closes span automatically
  @Span('validate-order')
  async validateOrder(data: CreateOrderDto) {
    return this.validator.check(data);
  }

  // Manual — full control over span attributes
  async processOrder(orderId: string) {
    return this.tracer.startActiveSpan('process-order', async (span) => {
      span.setAttribute('order.id', orderId);
      const result = await this.process(orderId);
      span.setAttribute('order.status', result.status);
      return result;
    });
  }
}
```

---

## Kafka context propagation

Trace context flows automatically across Kafka when you add `kafkaInstrumentation()`.

For manual header control:

```typescript
import { injectKafkaHeaders, withKafkaContext } from '@ivymurage-rw/observability';

// Producer: inject trace context into headers
await producer.send({
  topic: 'events',
  messages: [{
    value: JSON.stringify(data),
    headers: injectKafkaHeaders(),
  }],
});

// Consumer: extract trace context from headers
await consumer.run({
  eachMessage: async ({ message }) => {
    await withKafkaContext(message.headers, 'process-event', async () => {
      await processEvent(message);
    });
  },
});
```

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
