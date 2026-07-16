# Infrastructure & Deployment Guide

How to deploy services using `@ivymurage/observability` and get logs, traces, and metrics flowing to your observability platform — whether you run on PM2 or Kubernetes.

## Table of Contents

- [How the SDK outputs signals](#how-the-sdk-outputs-signals)
- [PM2 deployment](#pm2-deployment)
  - [PM2 setup](#pm2-setup)
  - [How logs flow with PM2](#how-logs-flow-with-pm2)
  - [Shipping PM2 logs to Loki](#shipping-pm2-logs-to-loki)
  - [Metrics with PM2](#metrics-with-pm2)
  - [Traces with PM2](#traces-with-pm2)
- [Kubernetes deployment](#kubernetes-deployment)
  - [Observability stack overview](#observability-stack-overview)
  - [Architecture diagram](#architecture-diagram)
  - [Component reference](#component-reference)
  - [Installing the stack](#installing-the-stack)
  - [How logs flow with Kubernetes](#how-logs-flow-with-kubernetes)
  - [How traces flow with Kubernetes](#how-traces-flow-with-kubernetes)
  - [How metrics flow with Kubernetes](#how-metrics-flow-with-kubernetes)
  - [Connecting datasources in Grafana](#connecting-datasources-in-grafana)
  - [Correlating logs and traces](#correlating-logs-and-traces)
- [SDK configuration per environment](#sdk-configuration-per-environment)
- [Verifying the pipeline](#verifying-the-pipeline)
- [Troubleshooting](#troubleshooting)

---

## How the SDK outputs signals

The SDK is infrastructure-agnostic. It outputs three signal types, and your infrastructure decides where they go:

| Signal | How the SDK emits it | What collects it |
|--------|---------------------|-----------------|
| **Logs** | Structured JSON to **stdout** via Pino | PM2 log files, or Kubernetes container log pipeline (Promtail/Fluentd) |
| **Traces** | OTLP HTTP/gRPC to a **configurable endpoint** | Grafana Tempo, Jaeger, or any OTLP-compatible backend |
| **Metrics** | Prometheus text format on **`/metrics` endpoint** | Prometheus scrapes this endpoint on an interval |

The SDK does not care whether it runs on PM2, Kubernetes, Docker, or bare metal. It writes to stdout and exposes HTTP endpoints. Your infrastructure handles collection and storage.

---

## PM2 deployment

### PM2 setup

Create an `ecosystem.config.js` in your project root:

```javascript
module.exports = {
  apps: [
    {
      name: 'api-gateway',
      cwd: '../api-gateway',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      },
    },
    {
      name: 'auth-service',
      cwd: '../authentication-service',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      },
    },
  ],
};
```

Start services:

```bash
# Build first
cd ../api-gateway && npm run build
cd ../authentication-service && npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Check status
pm2 list
pm2 logs api-gateway --lines 20
```

### How logs flow with PM2

```
┌──────────────────┐
│  NestJS Service   │
│                   │
│  ObservabilityLogger (Pino)
│       │
│       ▼
│  stdout (JSON)   │
└───────┬──────────┘
        │
        ▼
┌──────────────────┐
│  PM2 Process     │
│  Manager         │
│       │
│       ▼
│  ~/.pm2/logs/    │
│  ├── api-gateway-out.log    ◄── structured JSON logs
│  └── api-gateway-error.log  ◄── stderr (errors/crashes)
└───────┬──────────┘
        │
        ▼  (pick one)
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  View directly   │     │  Promtail agent   │     │  Grafana Alloy   │
│  pm2 logs        │     │  tail log files   │     │  tail log files  │
│                  │     │  → push to Loki   │     │  → push to Loki  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

**What each log line looks like** (PM2 `NODE_ENV=production`):

```json
{
  "level": "info",
  "time": 1721123456789,
  "msg": "request_complete",
  "trace_id": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "span_id": "1a2b3c4d5e6f7a8b",
  "request_id": "req-uuid-1234",
  "correlation_id": "corr-uuid-5678",
  "method": "POST",
  "route": "/api/users/login",
  "statusCode": 200,
  "duration_ms": 142.35,
  "controller": "UsersController",
  "handler": "login",
  "service": "auth-service"
}
```

In development (`NODE_ENV=development`), Pino pretty-prints with colors instead of JSON.

### Shipping PM2 logs to Loki

To get PM2 logs into Grafana/Loki for querying, install Promtail on the same server:

**1. Install Promtail:**

```bash
# Download Promtail binary
curl -LO https://github.com/grafana/loki/releases/latest/download/promtail-linux-amd64.zip
unzip promtail-linux-amd64.zip
sudo mv promtail-linux-amd64 /usr/local/bin/promtail
```

**2. Configure Promtail** (`/etc/promtail/config.yaml`):

```yaml
server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://localhost:3100/loki/api/v1/push  # Loki endpoint

scrape_configs:
  - job_name: pm2-logs
    static_configs:
      - targets: [localhost]
        labels:
          job: pm2
          __path__: /home/<user>/.pm2/logs/*-out.log

    pipeline_stages:
      - json:
          expressions:
            level: level
            service: service
            trace_id: trace_id
            msg: msg
      - labels:
          level:
          service:
      - timestamp:
          source: time
          format: Unix
```

**3. Run Promtail:**

```bash
promtail -config.file=/etc/promtail/config.yaml
```

Now PM2 logs are searchable in Grafana via LogQL:

```logql
{job="pm2", service="api-gateway"} | json | level = "error"
{job="pm2"} | json | trace_id = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
```

### Metrics with PM2

The SDK exposes `/metrics` on each service's HTTP port. Set up Prometheus to scrape them:

**`/etc/prometheus/prometheus.yml`:**

```yaml
scrape_configs:
  - job_name: 'nestjs-services'
    scrape_interval: 15s
    static_configs:
      - targets:
          - 'localhost:3000'  # api-gateway
          - 'localhost:3001'  # auth-service
        labels:
          environment: 'production'
    metrics_path: '/metrics'
```

### Traces with PM2

For traces, you need an OTLP-compatible collector running locally. The simplest options:

**Option A: Grafana Tempo (standalone)**

```bash
# Download Tempo
curl -LO https://github.com/grafana/tempo/releases/latest/download/tempo_2.7.0_linux_amd64.tar.gz
tar xzf tempo_2.7.0_linux_amd64.tar.gz
```

Create `/etc/tempo/config.yaml`:

```yaml
server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        http:
          endpoint: "0.0.0.0:4318"
        grpc:
          endpoint: "0.0.0.0:4317"

storage:
  trace:
    backend: local
    local:
      path: /var/lib/tempo/traces
    wal:
      path: /var/lib/tempo/wal

metrics_generator:
  registry:
    external_labels:
      source: tempo
  storage:
    path: /var/lib/tempo/generator/wal
```

Run Tempo:

```bash
./tempo -config.file=/etc/tempo/config.yaml
```

**Option B: OpenTelemetry Collector → Tempo/Jaeger**

If you already have a collector in the sandbox (`sandbox/otel-collector/`), point services to it:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

The SDK sends traces to this endpoint. The collector forwards them to Tempo/Jaeger.

---

## Kubernetes deployment

### Observability stack overview

On Kubernetes, the observability stack typically runs in a dedicated namespace. Each component handles one signal type:

| Signal | Collector | Storage & Query | Visualization |
|--------|-----------|----------------|---------------|
| **Metrics** | Prometheus (pull — scrapes `/metrics`) | Prometheus TSDB | Grafana (PromQL) |
| **Logs** | Promtail DaemonSet (tail container stdout) | Loki | Grafana (LogQL) |
| **Traces** | SDK pushes OTLP directly | Tempo | Grafana (TraceQL) |

Grafana is the single pane of glass — it queries all three backends and can correlate between them.

### Architecture diagram

```
┌───────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster                                           │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ api-gateway   │  │ auth-service  │  │ other-svc    │       │
│  │               │  │               │  │              │       │
│  │  stdout ──────┼──┼───────────────┼──┼──► Promtail ──► Loki │
│  │  /metrics ────┼──┼───────────────┼──┼──► Prometheus │       │
│  │  OTLP ────────┼──┼───────────────┼──┼──► Tempo      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                               │
│                      ┌────────────┐                           │
│                      │  Grafana   │                           │
│                      │            │                           │
│                      │  Loki    ──┼── LogQL   (logs)          │
│                      │  Prom    ──┼── PromQL  (metrics)       │
│                      │  Tempo   ──┼── TraceQL (traces)        │
│                      └────────────┘                           │
│                                                               │
│  Namespace: observability                                     │
└───────────────────────────────────────────────────────────────┘
```

### Component reference

#### Prometheus

Scrapes metrics endpoints from all services at regular intervals and stores time-series data.

| What | Details |
|------|---------|
| Helm chart | `kube-prometheus-stack` (bundles Prometheus, Grafana, node-exporter, kube-state-metrics) |
| Query port | `9090` |
| How SDK connects | SDK exposes `/metrics` → Prometheus scrapes it via `ServiceMonitor` CRD |

**Add a new service to Prometheus** via `ServiceMonitor`:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api-gateway
  namespace: observability
  labels:
    release: prometheus    # must match your Helm release name
spec:
  namespaceSelector:
    matchNames: [default]  # namespace where your service runs
  selector:
    matchLabels:
      app: api-gateway
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
```

#### Loki

Log aggregation. Receives logs from Promtail, indexes by labels, and serves LogQL queries.

| What | Details |
|------|---------|
| Helm chart | `grafana/loki` |
| Query port | `3100` (direct) or `80` (via loki-gateway) |
| How SDK connects | SDK writes JSON to stdout → Promtail tails container logs → pushes to Loki |

#### Promtail

DaemonSet agent on every node. Tails container log files from `/var/log/pods`, attaches Kubernetes labels, ships to Loki.

| What | Details |
|------|---------|
| Helm chart | `grafana/promtail` |
| How it works | Automatically picks up any container stdout — no per-service config needed |

The SDK's `ObservabilityLogger` writes structured JSON to stdout. Promtail picks it up, preserves all JSON fields (`trace_id`, `span_id`, `request_id`, `level`, `msg`), and makes them queryable in Loki:

```logql
{namespace="default", app="api-gateway"} | json | trace_id != "" | level = "error"
```

#### Tempo

Distributed tracing backend. Receives OTLP from services, stores traces, serves trace queries.

| What | Details |
|------|---------|
| Helm chart | `grafana/tempo` |
| OTLP HTTP port | `4318` (services send traces here) |
| OTLP gRPC port | `4317` (alternative protocol) |
| Query port | `3100` (Grafana datasource uses this) |
| How SDK connects | SDK sends traces via OTLP HTTP to `http://tempo.<namespace>.svc.cluster.local:4318` |

#### Grafana

Visualization. Queries all three backends from a single UI.

| What | Details |
|------|---------|
| Helm chart | Bundled with `kube-prometheus-stack` |
| Port | `80` |
| Access | `kubectl port-forward svc/prometheus-grafana -n observability 3000:80` |

### Installing the stack

Install each component via Helm in the `observability` namespace:

```bash
# Create namespace
kubectl create namespace observability

# Add Helm repos
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
```

**1. Prometheus + Grafana (kube-prometheus-stack):**

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace observability \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false
```

The `serviceMonitorSelectorNilUsesHelmValues=false` flag lets Prometheus discover ServiceMonitors from any namespace, not just its own.

**2. Loki:**

```bash
helm install loki grafana/loki \
  --namespace observability \
  --set loki.auth_enabled=false
```

**3. Promtail:**

```bash
helm install promtail grafana/promtail \
  --namespace observability \
  --set config.clients[0].url=http://loki-gateway.observability.svc.cluster.local/loki/api/v1/push
```

**4. Tempo:**

```bash
helm install tempo grafana/tempo \
  --namespace observability \
  --set tempo.receivers.otlp.protocols.http.endpoint="0.0.0.0:4318" \
  --set tempo.receivers.otlp.protocols.grpc.endpoint="0.0.0.0:4317"
```

If `helm repo update` fails (e.g., corporate firewall), download the chart `.tgz` manually from https://github.com/grafana/helm-charts/releases and install from file:

```bash
helm install tempo ./tempo-1.18.0.tgz --namespace observability \
  --set tempo.receivers.otlp.protocols.http.endpoint="0.0.0.0:4318" \
  --set tempo.receivers.otlp.protocols.grpc.endpoint="0.0.0.0:4317"
```

**Verify everything is running:**

```bash
kubectl get pods -n observability
kubectl get svc -n observability
```

### How logs flow with Kubernetes

```
┌──────────────────┐
│  NestJS Container │
│                   │
│  ObservabilityLogger (Pino)
│       │
│       ▼
│  stdout (JSON)   │
└───────┬──────────┘
        │  (container runtime captures stdout)
        ▼
┌──────────────────┐
│  /var/log/pods/  │   ← node filesystem
│  <namespace>_    │
│  <pod>_<uid>/    │
│  <container>/    │
│  0.log           │
└───────┬──────────┘
        │  (Promtail DaemonSet tails this file)
        ▼
┌──────────────────┐
│  Promtail        │
│  - parses JSON   │
│  - adds labels:  │
│    namespace,    │
│    pod, container│
│  - pushes to Loki│
└───────┬──────────┘
        │
        ▼
┌──────────────────┐
│  Loki            │
│  - indexes by    │
│    labels        │
│  - stores chunks │
│  - serves LogQL  │
└───────┬──────────┘
        │
        ▼
┌──────────────────┐
│  Grafana         │
│  Explore → Loki  │
│  LogQL queries   │
└──────────────────┘
```

No per-service configuration needed. As long as the service writes structured JSON to stdout (which the SDK does automatically), the logs flow through the pipeline end-to-end.

### How traces flow with Kubernetes

```
┌──────────────────┐
│  NestJS Container │
│                   │
│  TracingInterceptor creates spans
│  BatchSpanProcessor buffers them
│       │
│       ▼
│  OTLP HTTP POST  │
│  to Tempo:4318   │
└───────┬──────────┘
        │  (HTTP call within cluster network)
        ▼
┌──────────────────┐
│  Tempo           │
│  - receives OTLP │
│  - stores traces │
│  - serves TraceQL│
└───────┬──────────┘
        │
        ▼
┌──────────────────┐
│  Grafana         │
│  Explore → Tempo │
│  TraceQL queries │
└──────────────────┘
```

Unlike logs, traces are **pushed** directly from the service to Tempo — there is no DaemonSet intermediary. The SDK's `BatchSpanProcessor` buffers spans and sends them in batches every 5 seconds (configurable).

### How metrics flow with Kubernetes

```
┌──────────────────┐
│  NestJS Container │
│                   │
│  MetricsInterceptor records
│  http_requests_total,
│  http_request_duration_seconds
│       │
│       ▼
│  GET /metrics    │  ← Prometheus scrapes this
│  (text/plain)    │
└───────┬──────────┘
        │  (Prometheus pulls every 15-30s)
        ▼
┌──────────────────┐
│  Prometheus      │
│  - scrapes       │
│  - stores TSDB   │
│  - serves PromQL │
│  - evaluates     │
│    alert rules   │
└───────┬──────────┘
        │
        ▼
┌──────────────────┐
│  Grafana         │
│  Dashboards +    │
│  Explore → Prom  │
│  PromQL queries  │
└──────────────────┘
```

Metrics are **pulled** — Prometheus discovers services via `ServiceMonitor` CRDs and scrapes their `/metrics` endpoint. The SDK registers this endpoint automatically.

### Connecting datasources in Grafana

After the stack is running, port-forward Grafana and add the datasources:

```bash
kubectl port-forward svc/prometheus-grafana -n observability 3000:80
```

Open `http://localhost:3000` → Configuration → Data Sources:

| Datasource | Type | URL |
|------------|------|-----|
| Prometheus | Prometheus | `http://prometheus-kube-prometheus-prometheus.observability.svc.cluster.local:9090` |
| Loki | Loki | `http://loki-gateway.observability.svc.cluster.local:80` |
| Tempo | Tempo | `http://tempo.observability.svc.cluster.local:3100` |

Prometheus is usually pre-configured since Grafana ships with `kube-prometheus-stack`. You only need to add Loki and Tempo manually.

### Correlating logs and traces

This lets you click between logs and traces in Grafana.

**Tempo → Loki (click a trace, see its logs):**

In the Tempo datasource settings → **Trace to logs**:

| Setting | Value |
|---------|-------|
| Data source | Loki |
| Tags | `service.name` → `app` |
| Filter by trace ID | Enabled |
| Filter by span ID | Enabled |

**Loki → Tempo (click a log line, see its trace):**

In the Loki datasource settings → **Derived fields**:

| Setting | Value |
|---------|-------|
| Name | `TraceID` |
| Regex | `"trace_id":"([a-f0-9]+)"` |
| Internal link | Enabled → select Tempo |

Now `trace_id` values in log lines become clickable links that open the full distributed trace.

---

## SDK configuration per environment

The SDK should be configured differently per environment. Use environment variables so the same Docker image works everywhere:

```typescript
import { ObservabilityModule, httpInstrumentation, kafkaInstrumentation } from '@ivymurage/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'api-gateway',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      tracing: {
        exporter: {
          type: process.env.NODE_ENV === 'development' ? 'console' : 'otlp-http',
          endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
            || 'http://tempo.observability.svc.cluster.local:4318',
        },
        sampling: {
          ratio: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        },
      },
      instrumentations: [
        httpInstrumentation({ ignoreIncomingPaths: ['/health', '/metrics'] }),
        kafkaInstrumentation(),
      ],
    }),
  ],
})
export class AppModule {}
```

**Environment variable reference:**

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Controls log format (JSON vs pretty), sampling ratio, exporter type |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://tempo...svc:4318` | Where traces are sent. Override per environment. |
| `PORT` | `3000` | Service HTTP port (where `/metrics` and `/health` are served) |

**Kubernetes Deployment manifest example:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: api-gateway
          image: your-registry/api-gateway:latest
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: "production"
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://tempo.observability.svc.cluster.local:4318"
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
```

**PM2 ecosystem.config.js:**

```javascript
module.exports = {
  apps: [{
    name: 'api-gateway',
    script: 'dist/main.js',
    env: {
      NODE_ENV: 'production',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    },
  }],
};
```

**Important:** Add `app.enableShutdownHooks()` in your `main.ts` so buffered spans flush on process termination:

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();  // Required — without this, spans are lost on restart
  app.useLogger(app.get(NestPinoLogger));
  await app.listen(process.env.PORT || 3000);
}
```

---

## Verifying the pipeline

### Logs

**PM2:**
```bash
pm2 logs api-gateway --lines 5
# Should see structured JSON with trace_id, span_id, etc.
```

**Kubernetes:**
```bash
kubectl logs -l app=api-gateway --tail=5
# Should see structured JSON
```

**Grafana (Loki):**
```logql
{app="api-gateway"} | json | trace_id != ""
```

### Traces

**Send a test trace to Tempo (Kubernetes):**
```bash
kubectl run test-trace --rm -it --restart=Never \
  --image=curlimages/curl -n observability -- \
  -X POST http://tempo.observability.svc.cluster.local:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"test"}}]},"scopeSpans":[{"spans":[{"traceId":"d4cda95b652f4a1592b449d5929fda1b","spanId":"6e0c63257de34c92","name":"test-span","kind":1,"startTimeUnixNano":"1721000000000000000","endTimeUnixNano":"1721000001000000000","status":{}}]}]}]}'
```

**Grafana (Tempo):** Explore → Tempo → search by `service.name = api-gateway`

### Metrics

**Direct:**
```bash
curl http://localhost:3000/metrics
# Should return Prometheus text format with http_requests_total, etc.
```

**Grafana (Prometheus):**
```promql
rate(http_requests_total{service="api-gateway"}[5m])
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{service="api-gateway"}[5m]))
```

---

## Troubleshooting

### Logs not appearing in Loki

| Check | Command |
|-------|---------|
| Service writing to stdout? | `kubectl logs <pod>` or `pm2 logs <service>` |
| Promtail running? | `kubectl get pods -n observability -l app.kubernetes.io/name=promtail` |
| Promtail can reach Loki? | `kubectl logs <promtail-pod> -n observability --tail=10` |
| Logs are JSON? | If `NODE_ENV` is not set, logs may be pretty-printed (not parseable) |

### Traces not appearing in Tempo

| Check | Command |
|-------|---------|
| Exporter set to `otlp-http`? | Check `app.module.ts` — if `type: 'console'`, traces only go to stdout |
| Service can reach Tempo? | `kubectl exec <pod> -- wget -qO- http://tempo.observability.svc.cluster.local:3100/ready` |
| Tempo healthy? | `kubectl logs tempo-0 -n observability --tail=20` |
| `enableShutdownHooks()` called? | Without it, spans may be buffered but never flushed |

### Prometheus not scraping metrics

| Check | Command |
|-------|---------|
| `/metrics` responds? | `curl http://<service>:<port>/metrics` |
| ServiceMonitor exists? | `kubectl get servicemonitor -n observability` |
| ServiceMonitor has `release: prometheus` label? | Required for discovery |
| Prometheus targets page | Port-forward to 9090 → Status → Targets |

### Grafana "Unable to connect" to datasource

| Check | Fix |
|-------|-----|
| Wrong port for Tempo | Use `3100` for query API, not `4318` (that's the OTLP receiver) |
| Service not running | `kubectl get svc -n observability` |
| Network policy blocking | Check if policies restrict cross-namespace traffic |
