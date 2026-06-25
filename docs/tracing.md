# Distributed Tracing Guide

This guide covers how to set up, configure, and use distributed tracing with the `@brdrwanda/observability` SDK.

## Table of Contents

- [What is distributed tracing?](#what-is-distributed-tracing)
- [How the SDK implements tracing](#how-the-sdk-implements-tracing)
- [Configuration](#configuration)
- [HTTP trace propagation](#http-trace-propagation)
- [Kafka trace propagation](#kafka-trace-propagation)
- [Custom spans](#custom-spans)
- [External API tracing](#external-api-tracing)
- [Sampling strategies](#sampling-strategies)
- [Early tracing init](#early-tracing-init)
- [Viewing traces in Grafana Tempo](#viewing-traces-in-grafana-tempo)
- [Troubleshooting](#troubleshooting)

---

## What is distributed tracing?

When a user request hits `api-gateway`, it may call `authentication-service`, which calls `application-service`, which queries a database and calls an external API. Without tracing, each service logs independently — there is no way to follow a single request across services.

Distributed tracing assigns a single `trace_id` to the entire request chain. Each unit of work within that chain is a **span** (with its own `span_id`). Spans have parent-child relationships, forming a tree:

```
HTTP POST /api/loans/apply                        ─── 3200ms   (api-gateway)
  ├─ POST /api/auth/validate-token                ─── 120ms    (authentication-service)
  ├─ POST /api/applications/create                ─── 2800ms   (application-service)
  │   ├─ SELECT FROM applications                 ─── 15ms     (database)
  │   ├─ esri-lookup                              ─── 1800ms   (external API)
  │   └─ credit-score-submit                      ─── 320ms    (external API)
  └─ kafka: notifications send                    ─── 5ms      (kafka produce)
      └─ kafka: process-notifications             ─── 120ms    (notification-service)
```

Every log line in every service carries the same `trace_id`, so you can query Loki with `{trace_id="abc123"}` and see all logs from all services for that one request.

---

## How the SDK implements tracing

The SDK uses [OpenTelemetry](https://opentelemetry.io/) with the W3C TraceContext standard:

1. **TracingInterceptor** — creates a span for each incoming HTTP request, extracts `traceparent` header from upstream callers
2. **AsyncLocalStorage** — propagates trace context through async boundaries automatically
3. **Pino mixin** — injects `trace_id` and `span_id` into every log entry
4. **Metric exemplars** — attaches `trace_id` to Prometheus histogram observations
5. **Auto-instrumentations** — HTTP, Kafka, database drivers create spans automatically

### Propagation header

The SDK uses the W3C `traceparent` header:

```
traceparent: 00-<trace_id>-<span_id>-<flags>
Example:    00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

This replaces the custom `x-trace-id` header used by services before the SDK. The SDK still reads `x-trace-id` for backwards compatibility, but `traceparent` is the source of truth.

---

## Configuration

### Basic (use defaults)

```typescript
// app.module.ts
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  // tracing enabled by default with sensible defaults
})
```

### Full configuration

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  tracing: {
    enabled: true,                    // default: true

    exporter: {
      type: 'otlp-http',             // otlp-http | otlp-grpc | console | none
      endpoint: 'http://otel-collector:4318',
      headers: {                      // optional auth headers
        'Authorization': 'Bearer <token>',
      },
    },

    sampling: {
      type: 'parent-based',           // always | never | probabilistic | parent-based
      ratio: 0.1,                     // 10% of root spans sampled
    },
  },
})
```

### Environment-aware defaults

The SDK picks sensible defaults based on `NODE_ENV`:

| Setting | Development (`NODE_ENV` != production) | Production |
|---------|---------------------------------------|------------|
| `exporter.type` | `console` (print to terminal) | `otlp-http` |
| `sampling.ratio` | `1.0` (100% — all traces) | `0.1` (10%) |
| `exporter.endpoint` | `http://localhost:4318` | `OTEL_EXPORTER_OTLP_ENDPOINT` env var |

### Exporter types

| Type | Use case | Notes |
|------|----------|-------|
| `otlp-http` | **Production.** Send to OTEL Collector, Tempo, or any OTLP backend | Default in production. Bundled with the SDK |
| `otlp-grpc` | Production, when collector only accepts gRPC | Install `@opentelemetry/exporter-trace-otlp-grpc` separately |
| `console` | **Local development.** Spans print to terminal | No collector needed |
| `none` | Disable trace export entirely | Spans still created (for context propagation) but not shipped |

### Environment variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector endpoint | `http://otel-collector:4318` |
| `NODE_ENV` | Controls default exporter and sampling | `production` |

---

## HTTP trace propagation

When Service A calls Service B via HTTP, trace context must be propagated so both services share the same `trace_id`.

### Automatic (incoming requests)

The SDK automatically extracts `traceparent` from incoming HTTP requests. No code needed.

### Manual (outgoing requests)

When your service calls another service, inject the current trace context:

```typescript
import { propagation, context as otelContext } from '@opentelemetry/api';

// In your HTTP client / AxiosService / buildHeaders:
const headers: Record<string, any> = {
  authorization: req.headers.authorization,
  'content-type': 'application/json',
};

// This one line propagates the trace
propagation.inject(otelContext.active(), headers);

// Now headers contains: { ..., traceparent: '00-<trace_id>-<span_id>-01' }
const response = await axios.post(url, body, { headers });
```

### Where to add this in BRD services

Most services have an `AxiosService` at `src/axios/axios.service.ts` with a `buildHeaders()` or similar method. Add the `propagation.inject()` call there — it covers all outgoing HTTP requests in one place.

```typescript
// src/axios/axios.service.ts
import { propagation, context as otelContext } from '@opentelemetry/api';

buildHeaders(req: Request): Record<string, any> {
  const headers: Record<string, any> = {
    authorization: req.headers.authorization,
    'x-trace-id': req.headers['x-trace-id'],
  };

  // Inject W3C traceparent for distributed tracing
  propagation.inject(otelContext.active(), headers);

  return headers;
}
```

### Verify propagation works

1. Send a request that crosses services (e.g., api-gateway → authentication-service)
2. Check logs — both services should show the **same** `trace_id`:
   ```
   # api-gateway log
   trace_id: "8cf631b00df8e35a403e57823ac58eee"

   # authentication-service log
   trace_id: "8cf631b00df8e35a403e57823ac58eee"
   ```
3. In Grafana Tempo, search for that `trace_id` — spans from both services appear in one trace

---

## Kafka trace propagation

Kafka messages are fire-and-forget. Without trace propagation, the consumer has no idea which HTTP request triggered the message.

### Producer side

```typescript
import { injectKafkaHeaders, ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class NotificationProducer {
  constructor(private logger: ObservabilityLogger) {}

  async publishEvent(topic: string, payload: any) {
    await this.producer.send({
      topic,
      messages: [{
        key: payload.id,
        value: JSON.stringify(payload),
        headers: injectKafkaHeaders({ 'x-event-type': payload.type }),
      }],
    });

    this.logger.info('Event published', { topic, eventType: payload.type });
  }
}
```

### Consumer side

```typescript
import { withKafkaContext, ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class EventConsumer {
  constructor(private logger: ObservabilityLogger) {}

  async onModuleInit() {
    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        await withKafkaContext(message.headers, `process-${topic}`, async () => {
          const payload = JSON.parse(message.value.toString());
          this.logger.info('Processing event', { topic, type: payload.type });
          await this.handle(payload);
        });
      },
    });
  }
}
```

### Auto-instrumentation alternative

If you use `kafkaInstrumentation()` in your module config, KafkaJS is instrumented automatically — spans are created for every `producer.send()` and `consumer.run()`. Use `injectKafkaHeaders`/`withKafkaContext` only for custom Kafka clients or `@nestjs/microservices` `ClientKafka`.

---

## Custom spans

The SDK auto-creates spans for HTTP requests, database queries, and Kafka operations. Custom spans let you trace **business logic**.

### When to add custom spans

| Scenario | Why | Example |
|----------|-----|---------|
| External API calls | Third-party latency is invisible without a span | ESRI lookup, credit score API, iBank |
| Multi-step business logic | One handler does several things | Validate → score → decide → notify |
| Background/async work | No HTTP context to auto-trace | Cron jobs, queue workers |
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
}
```

### Manual spans with `ObservabilityTracer`

Use when you need custom attributes:

```typescript
import { ObservabilityTracer, ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class PaymentService {
  constructor(
    private tracer: ObservabilityTracer,
    private logger: ObservabilityLogger,
  ) {}

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

---

## External API tracing

BRD services call several external systems. Each external call should be a separate span.

### Pattern

```typescript
import { Span, ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class ExternalIntegrationService {
  constructor(
    private readonly axiosService: AxiosService,
    private readonly logger: ObservabilityLogger,
  ) {}

  @Span('esri-lookup')
  async getESRIInfo(upi: string) {
    try {
      this.logger.info('fetching ESRI data', { upi });
      const result = await this.axiosService.request('GET', `${url}/api/external/esri/upi`, ...);
      this.logger.info('ESRI data received', { upi });
      return result;
    } catch (error) {
      this.logger.logCaughtError(error);
      return null;
    }
  }
}
```

### Recommended span names for BRD integrations

| Integration | Span name | Why trace it |
|-------------|-----------|-------------|
| Access control login | `access-control-login` | Auth token fetch, can timeout |
| ESRI / GIS lookup | `esri-lookup` | External GIS service, 15s timeout |
| Land center lookup | `land-center-lookup` | Government land registry |
| Credit score submission | `credit-score-submit` | Cross-service, affects loan decisions |
| iBank budget lookup | `ibank-budget-lookup` | Core banking integration |
| Minecofin loan submit | `minecofin-loan-submit` | Government system, slow and flaky |
| Workflow start/resume | `workflow-start`, `workflow-resume` | Workflow engine, multi-step |
| NID/TIN lookup | `nid-lookup`, `tin-lookup` | Identity verification, external service |

### What you see in Tempo

Without spans:
```
HTTP POST /api/loans/apply  ─────────────────────── 3200ms
```

With `@Span` on each external call:
```
HTTP POST /api/loans/apply  ─────────────────────── 3200ms
  ├─ access-control-login  ────── 450ms
  ├─ esri-lookup  ─────────────── 1800ms   ← bottleneck
  ├─ credit-score-submit  ─────── 320ms
  └─ workflow-start  ──────────── 180ms
```

---

## Sampling strategies

In production, tracing 100% of requests generates too much data. Sampling controls which traces are recorded.

### Types

| Strategy | Behavior | Config |
|----------|----------|--------|
| `always` | Every request traced | `{ type: 'always' }` |
| `never` | No traces recorded | `{ type: 'never' }` |
| `probabilistic` | Random sampling at `ratio` | `{ type: 'probabilistic', ratio: 0.1 }` |
| `parent-based` | Follow parent's decision; for root spans use `ratio` | `{ type: 'parent-based', ratio: 0.1 }` |

### Recommended settings

| Environment | Strategy | Ratio | Why |
|-------------|----------|-------|-----|
| Development | `always` (default) | 1.0 | See every trace while debugging |
| Staging | `parent-based` | 0.5 | Balanced coverage for testing |
| Production | `parent-based` | 0.1 | 10% sampling keeps costs manageable |

### Parent-based sampling explained

When Service B receives a request from Service A:
- If Service A **sampled** the trace → Service B also samples it (preserves the full chain)
- If Service A **dropped** the trace → Service B also drops it
- If there's no parent (root span) → Service B uses its `ratio` to decide

This ensures you always get complete traces — never a partial chain where some services sampled and others didn't.

---

## Early tracing init

OpenTelemetry instruments Node.js modules by monkey-patching `require()`. If NestJS imports `http`, `sequelize`, or `kafkajs` **before** tracing starts, those modules won't be instrumented.

In most cases, the SDK's `onModuleInit` starts tracing early enough. But if you notice missing spans on startup requests, add `setupTracing()` at the top of `main.ts`:

```typescript
import { setupTracing, setupProcessErrorHandlers, NestPinoLogger } from '@brdrwanda/observability';

// These run BEFORE NestJS bootstraps
setupProcessErrorHandlers({ serviceName: 'my-service' });
setupTracing({
  serviceName: 'my-service',
  tracing: {
    exporter: { type: 'otlp-http', endpoint: 'http://otel-collector:4318' },
    sampling: { ratio: 0.1 },
  },
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(NestPinoLogger));
  await app.listen(3000);
}
bootstrap();
```

---

## Viewing traces in Grafana Tempo

### From logs → trace

1. In Grafana, go to **Explore** → select **Loki**
2. Query: `{service_name="api-gateway"} |= "error"`
3. Expand a log line → click the `trace_id` value
4. Grafana jumps to **Tempo** showing the full trace

### From metrics → trace

1. In a Grafana dashboard, view a histogram panel (e.g., request duration)
2. Click an **exemplar dot** on the graph
3. Grafana jumps to the specific trace that caused that data point

### Direct trace search

1. Go to **Explore** → select **Tempo**
2. Search by:
   - `trace_id` — exact trace
   - Service name + operation — e.g., `api-gateway` + `POST /api/loans/apply`
   - Duration — e.g., traces longer than 2 seconds
   - Status — error traces only

---

## Troubleshooting

### No traces appearing in Tempo

| Symptom | Cause | Fix |
|---------|-------|-----|
| Zero traces | Exporter type is `console` or `none` | Change to `otlp-http` |
| Zero traces | Collector endpoint wrong or unreachable | Check `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Partial traces | Sampling ratio too low | Increase ratio or use `always` for debugging |
| Missing spans for HTTP calls | `propagation.inject()` not called in outgoing requests | Add to `AxiosService.buildHeaders()` |
| Missing DB spans | Instrumentation not registered | Add `sequelizeInstrumentation()` to config |
| Missing spans on first request | Tracing started after module import | Use `setupTracing()` in main.ts |

### trace_id in logs but not in Tempo

Logs use Pino's mixin to inject `trace_id` — this works even if tracing export is disabled. If logs show `trace_id` but Tempo has no trace:
1. Check exporter config: `tracing.exporter.type` must not be `console` or `none`
2. Check collector is running: `curl http://otel-collector:4318/v1/traces` should not timeout
3. Check Tempo datasource in Grafana is configured correctly
