# Internal Observability Platform

Observability SDK and infrastructure for BRD NestJS microservices. One package gives every service structured logging, distributed tracing, Prometheus metrics, and health checks.

## Repository structure

```
├── packages/sdk/          # @ivymurage-rw/observability npm package
│   ├── src/               # SDK source code
│   ├── README.md          # Full developer guide (setup, configuration, examples)
│   └── package.json
└── sandbox/               # Local observability stack (docker-compose)
    ├── grafana/            # Dashboards + datasource provisioning
    ├── otel-collector/     # OpenTelemetry Collector config
    ├── promtail/           # Log shipping to Loki
    ├── docker-compose.yml
    ├── prometheus.yml
    └── tempo.yaml
```

## What the SDK provides

| Capability | What happens | Your effort |
|------------|-------------|-------------|
| Structured JSON logs | Every log has `trace_id`, `request_id`, `span_id`, `service_name` | Zero — automatic |
| Request lifecycle | `request_started` / `request_completed` with duration | Zero — automatic |
| Error classification | 401→`authentication_failed`, 400→`validation_failed`, 500→`server_error` | Zero — automatic |
| HTTP metrics | `http_requests_total`, `http_request_duration_seconds` | Zero — automatic |
| Node.js metrics | CPU, memory, event loop, GC | Zero — automatic |
| Health checks | `/health` endpoint | Zero — automatic |
| Distributed tracing | W3C `traceparent` propagation across services | One line: `propagation.inject()` |
| Custom spans | Trace business logic and external API calls | One decorator: `@Span('name')` |
| Database tracing | Sequelize query logging with slow query alerts | One config line |
| Kafka tracing | Trace context across Kafka produce/consume | `kafkaInstrumentation()` |
| Sensitive data redaction | Passwords, tokens, keys auto-censored | Zero — automatic |

## Quick start

```bash
npm install @ivymurage-rw/observability
```

```typescript
// app.module.ts
import { ObservabilityModule, ObservabilityHealthModule, httpInstrumentation } from '@ivymurage-rw/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'my-service',
      tracing: { exporter: { type: 'otlp-http', endpoint: 'http://localhost:4318' } },
      instrumentations: [httpInstrumentation()],
    }),
    ObservabilityHealthModule,
  ],
})
export class AppModule {}
```

```typescript
// main.ts
import { setupProcessErrorHandlers, NestPinoLogger } from '@ivymurage-rw/observability';

setupProcessErrorHandlers({ serviceName: 'my-service' });

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(NestPinoLogger));
// Do NOT add app.useGlobalFilters() — SDK handles this automatically
```

**Full setup guide, configuration reference, and examples:** [packages/sdk/README.md](packages/sdk/README.md)

## Architecture

<img width="1536" height="1024" alt="ChatGPT Image Jun 4, 2026, 12_59_03 PM" src="https://github.com/user-attachments/assets/58945a58-7781-4b79-9f89-7d2900d38ce7" />


## Sandbox (local observability stack)

Run the full Grafana + Prometheus + Loki + Tempo stack locally:

```bash
cd sandbox
docker compose up -d
```

| Tool | URL | Purpose |
|------|-----|---------|
| Grafana | http://localhost:3000 | Dashboards, log search, trace viewer |
| Prometheus | http://localhost:9090 | Metrics queries |
| Tempo | http://localhost:3200 | Trace storage |
| Loki | http://localhost:3100 | Log storage |

### Pre-built Grafana dashboards

| Dashboard | What it shows |
|-----------|--------------|
| **Service Overview (RED)** | Request rate, error rate, response time percentiles, status codes, slowest routes |
| **Node.js Runtime** | Heap memory, CPU usage, event loop lag, GC duration, active handles |
| **Logs & Traces** | Log volume by level, warnings/errors, recent traces, all logs |

### Piping service logs to Loki

Promtail watches `/tmp/observability-logs/*.log`. Start services with:

```bash
NODE_ENV=production npm start 2>&1 | tee /tmp/observability-logs/my-service.log
```

## Integrated services

| Service | Port | Status |
|---------|------|--------|
| api-gateway | 7070 | SDK integrated |
| authentication-service | 9001 | SDK integrated |
| application-service | 9004 | SDK integrated + external API spans |
| access-management-service | 9000 | SDK integrated |

## Developer setup (GitHub Packages)

The SDK is published to GitHub Packages:

```bash
# 1. Add .npmrc to your service root
echo "@ivymurage-rw:registry=https://npm.pkg.github.com" > .npmrc
echo "//npm.pkg.github.com/:_authToken=\${GITHUB_TOKEN}" >> .npmrc

# 2. Set your token
export GITHUB_TOKEN=ghp_your_token_here

# 3. Install
npm install @ivymurage-rw/observability
```

## Documentation

| Document | What's in it |
|----------|-------------|
| [SDK README](packages/sdk/README.md) | Full developer guide: setup, configuration, logging, tracing, spans, Kafka, migration, reference |
| [SDK CHANGELOG](packages/sdk/CHANGELOG.md) | Version history |

## Contributing

```bash
# Install dependencies
pnpm install

# Build SDK
cd packages/sdk && pnpm build

# Run tests
pnpm test

# Start sandbox
cd sandbox && docker compose up -d
```
