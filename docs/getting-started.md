# Getting Started

## Installation

```bash
# Install the SDK
npm install @company/observability

# Required peer dependencies (you likely already have these)
npm install @nestjs/common @nestjs/core rxjs reflect-metadata

# Optional: install instrumentations for your stack
npm install @opentelemetry/instrumentation-mysql2    # MySQL
npm install @opentelemetry/instrumentation-ioredis   # Redis
npm install @opentelemetry/instrumentation-kafkajs   # Kafka
npm install @opentelemetry/instrumentation-pg        # PostgreSQL

# Development: pretty logs
npm install -D pino-pretty
```

## Quick Start

### 1. Import the module

```typescript
// app.module.ts
import {
  ObservabilityModule,
  ObservabilityHealthModule,
  httpInstrumentation,
  mysqlInstrumentation,
  kafkaInstrumentation,
} from '@company/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'my-service',
      instrumentations: [
        httpInstrumentation(),
        mysqlInstrumentation(),
        kafkaInstrumentation(),
      ],
    }),
    ObservabilityHealthModule, // optional: /health, /health/ready, /health/live
  ],
})
export class AppModule {}
```

### 2. Replace the NestJS logger

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { NestPinoLogger } from '@company/observability';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(NestPinoLogger));
  await app.listen(3000);
}
bootstrap();
```

### 3. Use in services

```typescript
import { Injectable } from '@nestjs/common';
import { ObservabilityLogger, ObservabilityTracer, Span } from '@company/observability';

@Injectable()
export class OrderService {
  constructor(
    private logger: ObservabilityLogger,
    private tracer: ObservabilityTracer,
  ) {}

  @Span('create-order')
  async createOrder(data: CreateOrderDto) {
    this.logger.info('creating order', { customerId: data.customerId });

    // Logs automatically include trace_id, request_id, correlation_id
    // Span automatically created and closed

    return this.orderRepo.save(data);
  }

  async processPayment(orderId: string) {
    // Manual span for fine-grained control
    return this.tracer.startActiveSpan('process-payment', async (span) => {
      span.setAttribute('order.id', orderId);
      const result = await this.paymentGateway.charge(orderId);
      this.logger.info('payment processed', { orderId, status: result.status });
      return result;
    });
  }
}
```

## What you get automatically

- Structured JSON logs with trace correlation (stdout)
- Distributed tracing with W3C context propagation
- Prometheus metrics at `/metrics`
- Request context propagation via AsyncLocalStorage
- Sensitive data redaction (passwords, tokens, keys)
- Request/response logging
- Error logging with stack traces on spans
- Health endpoints (with ObservabilityHealthModule)

## What you DON'T need to do

- Manually pass trace IDs between services
- Manually structure log output
- Manually create request context
- Manually redact sensitive fields
- Manually set up Prometheus metrics boilerplate

## Configuration

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',          // required
  environment: 'production',          // defaults to NODE_ENV
  version: '1.2.3',                   // defaults to npm_package_version

  logger: {
    level: 'info',                    // debug | info | warn | error | fatal
    prettyPrint: false,               // true in dev, false in prod (auto)
    redaction: {
      paths: ['*.password', '*.ssn'], // extends defaults, doesn't replace
      censor: '[REDACTED]',
    },
  },

  tracing: {
    enabled: true,
    exporter: {
      type: 'otlp-http',             // otlp-http | otlp-grpc | console | none
      endpoint: 'http://otel-collector:4318',
      headers: { 'x-api-key': '...' },
    },
    sampling: {
      type: 'parent-based',          // always | never | probabilistic | parent-based
      ratio: 0.1,                    // 10% in prod, 100% in dev (auto)
    },
  },

  metrics: {
    enabled: true,
    prefix: 'myservice',             // metric name prefix
    defaultMetrics: true,             // Node.js process metrics
    labels: { team: 'platform' },     // extra default labels
  },

  instrumentations: [
    httpInstrumentation({ ignoreIncomingPaths: ['/health', '/metrics'] }),
    mysqlInstrumentation(),
    redisInstrumentation(),
    kafkaInstrumentation(),
  ],
})
```

## Kafka Context Propagation

For automatic propagation, install `@opentelemetry/instrumentation-kafkajs` and add `kafkaInstrumentation()`.

For manual control:

```typescript
import { injectKafkaHeaders, withKafkaContext } from '@company/observability';

// Producer: inject trace context into message headers
await producer.send({
  topic: 'events',
  messages: [{
    value: JSON.stringify(data),
    headers: injectKafkaHeaders(),
  }],
});

// Consumer: extract trace context from message headers
await consumer.run({
  eachMessage: async ({ message }) => {
    await withKafkaContext(message.headers, 'process-event', async () => {
      // trace context active here, logs include trace_id
      await processEvent(message);
    });
  },
});
```

## Migration from console.log / Winston

Replace:

```typescript
// Before
console.log('order created', orderId);
this.logger.log('Processing payment');
```

With:

```typescript
// After
this.logger.info('order created', { orderId });
this.logger.info('processing payment');
```

The SDK logger automatically adds all context fields. No manual structuring needed.

## Local Development

Start the observability sandbox:

```bash
pnpm sandbox:up    # Starts Grafana, Prometheus, Loki, Tempo, OTel Collector
```

- Grafana: http://localhost:3000 (admin/admin)
- Prometheus: http://localhost:9090
- Traces: Grafana → Explore → Tempo
- Logs: Grafana → Explore → Loki

Stop:

```bash
pnpm sandbox:down
```
