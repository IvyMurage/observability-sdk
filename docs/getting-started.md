# Getting Started

Add structured logging, distributed tracing, and Prometheus metrics to any NestJS service in 3 steps. Takes about 10 minutes.

---

## Step 1: Install

```bash
npm install @company/observability

# Pretty logs for development (recommended)
npm install -D pino-pretty
```

Your NestJS peer dependencies (`@nestjs/common`, `@nestjs/core`, `rxjs`, `reflect-metadata`) are already in your project. No extra setup needed.

---

## Step 2: Wire the module

### app.module.ts

Import `ObservabilityModule` and add it to your imports. Pick only the instrumentations your service uses.

```typescript
import {
  ObservabilityModule,
  ObservabilityHealthModule,
  httpInstrumentation,
  kafkaInstrumentation,
  redisInstrumentation,
} from '@company/observability';

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

### main.ts

Add `setupProcessErrorHandlers` at the top to catch bootstrap crashes (missing modules, connection failures, bad config) as structured JSON. Then add `bufferLogs: true` and set the SDK logger.

```typescript
import { NestFactory } from '@nestjs/core';
import { setupProcessErrorHandlers, NestPinoLogger } from '@company/observability';
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

That's it. Start your service and you'll see structured logs with `service_name`, `environment`, and `version` on every line.

---

## Step 3: Use in your services

Inject `ObservabilityLogger` anywhere you need logging. It's globally available from the module — no extra providers needed.

```typescript
import { Injectable } from '@nestjs/common';
import { ObservabilityLogger, Span } from '@company/observability';

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

Every log line automatically includes `trace_id`, `request_id`, `correlation_id`, and `span_id`. No manual wiring.

---

## What you get

| Feature | How | Endpoint |
|---------|-----|----------|
| Structured JSON logs | Pino with trace correlation | stdout |
| Distributed tracing | OpenTelemetry with W3C propagation | configurable exporter |
| Prometheus metrics | Auto-registered process + HTTP metrics | `GET /metrics` |
| Health checks | Liveness, readiness, and startup probes | `GET /health` |
| Sensitive data redaction | Passwords, tokens, keys auto-censored | automatic |
| Request context | Request ID, correlation ID via AsyncLocalStorage | automatic |

---

## Available instrumentations

Install only what your service uses:

| Instrumentation | When to use | Optional dependency |
|----------------|-------------|-------------------|
| `httpInstrumentation()` | Always (traces HTTP requests) | built-in |
| `kafkaInstrumentation()` | Service uses KafkaJS | `@opentelemetry/instrumentation-kafkajs` |
| `redisInstrumentation()` | Service uses Redis/ioredis | `@opentelemetry/instrumentation-ioredis` |
| `mysqlInstrumentation()` | Service uses MySQL | `@opentelemetry/instrumentation-mysql2` |
| `pgInstrumentation()` | Service uses PostgreSQL | `@opentelemetry/instrumentation-pg` |

The SDK logs a helpful message if an optional dependency is missing — it won't crash.

---

## Configuration reference

All fields except `serviceName` are optional with sensible defaults.

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',        // required — identifies your service
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

Use `console` exporter to see traces in your terminal without running an OTel collector:

```typescript
tracing: {
  exporter: { type: 'console' },
}
```

---

## Migrating from Winston / Morgan / custom loggers

### What to change

Migration touches 3 files: `app.module.ts`, `main.ts`, and any service that injects your old logger.

#### 1. app.module.ts — comment out old logging

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
import { ObservabilityModule, ObservabilityHealthModule, httpInstrumentation } from '@company/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: 'my-service', instrumentations: [httpInstrumentation()] }),
    ObservabilityHealthModule,
    // LoggerModule.register('App'),   <-- commented out
    ...
  ],
})
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // consumer.apply(MorganMiddleware).forRoutes('*');   <-- commented out
  }
}
```

#### 2. main.ts — swap the logger and add process error handling

```typescript
// Before
const app = await NestFactory.create(AppModule);

// After
import { setupProcessErrorHandlers, NestPinoLogger } from '@company/observability';

setupProcessErrorHandlers({ serviceName: 'my-service' });

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(NestPinoLogger));
```

#### 3. Services — replace logger injection

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
import { ObservabilityLogger } from '@company/observability';

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

### Adding context to logs

```typescript
// Before — manual string concatenation
console.log(`Order ${orderId} created by user ${userId}`);

// After — structured context (searchable, filterable)
this.logger.info('order created', { orderId, userId });
```

---

## Kafka context propagation

Trace context flows automatically across Kafka when you add `kafkaInstrumentation()`.

For manual control over headers:

```typescript
import { injectKafkaHeaders, withKafkaContext } from '@company/observability';

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

## Custom spans

Use the `@Span` decorator for automatic span management, or `ObservabilityTracer` for manual control.

```typescript
import { ObservabilityTracer, Span } from '@company/observability';

@Injectable()
export class OrderService {
  constructor(private tracer: ObservabilityTracer) {}

  // Automatic: decorator creates and closes span
  @Span('validate-order')
  async validateOrder(data: CreateOrderDto) {
    return this.validator.check(data);
  }

  // Manual: full control over span attributes and lifecycle
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

## Verify it works

Start your service and hit any endpoint:

```bash
# Health check
curl http://localhost:3000/health

# Prometheus metrics
curl http://localhost:3000/metrics

# Your own endpoints — check terminal for structured logs and trace spans
curl http://localhost:3000/api/your-endpoint
```

You should see in your terminal:

```
[15:58:07.768] INFO (your-service/12345): request completed
    service_name: "your-service"
    environment: "development"
    version: "0.0.1"
    trace_id: "abc123..."
    request_id: "req-456..."
    duration: 12
```

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
| Prometheus | http://localhost:9090 | - |
| Traces | Grafana > Explore > Tempo | - |
| Logs | Grafana > Explore > Loki | - |
