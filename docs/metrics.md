# Metrics & Dashboards Guide

This guide covers how to collect, expose, and visualize metrics with the `@brdrwanda/observability` SDK.

## Table of Contents

- [Auto HTTP metrics](#auto-http-metrics)
- [Custom business metrics](#custom-business-metrics)
- [Exemplars (metrics to traces)](#exemplars-metrics--traces)
- [Metrics configuration](#metrics-configuration)
- [Prometheus scraping](#prometheus-scraping)
- [Kubernetes ServiceMonitor (kube-prometheus-stack)](#kubernetes-servicemonitor-kube-prometheus-stack)
- [Grafana dashboard queries](#grafana-dashboard-queries)

---

## Auto HTTP metrics

When you import `ObservabilityModule.forRoot()`, the SDK automatically registers a `MetricsInterceptor` that tracks every HTTP request. You get three things out of the box with zero code:

### 1. `http_requests_total` counter

Labels: `method`, `route`, `status_code`

Counts every HTTP request that enters your service. Incremented on both success and error responses.

### 2. `http_request_duration_seconds` histogram

Labels: `method`, `route`, `status_code`

Measures how long each request takes in seconds. Default buckets: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10`.

When tracing is enabled, each histogram observation includes a `trace_id` exemplar so you can jump from a slow data point straight to its trace in Grafana Tempo.

### 3. Node.js default metrics

Standard `prom-client` default metrics are collected automatically:

- `process_cpu_user_seconds_total` — CPU time spent in user mode
- `process_cpu_system_seconds_total` — CPU time spent in system mode
- `process_resident_memory_bytes` — Resident memory size
- `nodejs_heap_size_total_bytes` — V8 total heap size
- `nodejs_heap_size_used_bytes` — V8 used heap size
- `nodejs_eventloop_lag_seconds` — Event loop lag
- `nodejs_active_handles_total` — Active libuv handles
- `nodejs_active_requests_total` — Active libuv requests

### 4. `/metrics` endpoint

A `MetricsController` is auto-registered at `/metrics`. Prometheus scrapes this endpoint. The controller negotiates content type — it returns OpenMetrics format when the client sends `Accept: application/openmetrics-text`, and Prometheus text format otherwise.

### Example Prometheus output

Hit `GET /metrics` on a running service to see output like this:

```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/loans",status_code="200",service="loan-service",environment="production"} 1524
http_requests_total{method="POST",route="/api/loans/apply",status_code="201",service="loan-service",environment="production"} 312
http_requests_total{method="GET",route="/api/loans/:id",status_code="404",service="loan-service",environment="production"} 7

# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.01"} 980
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.025"} 1350
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.05"} 1480
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.1"} 1510
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.25"} 1520
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.5"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="1"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="2.5"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="5"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="10"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="+Inf"} 1524
http_request_duration_seconds_sum{method="GET",route="/api/loans",status_code="200"} 18.274
http_request_duration_seconds_count{method="GET",route="/api/loans",status_code="200"} 1524

# HELP process_resident_memory_bytes Resident memory size in bytes.
# TYPE process_resident_memory_bytes gauge
process_resident_memory_bytes 98304000

# HELP nodejs_eventloop_lag_seconds Lag of event loop in seconds.
# TYPE nodejs_eventloop_lag_seconds gauge
nodejs_eventloop_lag_seconds 0.0024
```

---

## Custom business metrics

Inject `ObservabilityMetrics` to create counters, histograms, and gauges for your domain-specific data.

```typescript
import { Injectable } from '@nestjs/common';
import { ObservabilityMetrics } from '@brdrwanda/observability';
import type { Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class LoanService {
  private loansApproved: Counter;
  private loanProcessingTime: Histogram;
  private activeApplications: Gauge;

  constructor(private metrics: ObservabilityMetrics) {
    this.loansApproved = metrics.createCounter(
      'loans_approved_total',
      'Total number of approved loans',
      ['loan_type'],
    );
    this.loanProcessingTime = metrics.createHistogram(
      'loan_processing_duration_seconds',
      'Time to process a loan application',
      ['loan_type'],
      [0.1, 0.5, 1, 2, 5, 10, 30],
    );
    this.activeApplications = metrics.createGauge(
      'active_loan_applications',
      'Currently active loan applications',
      ['status'],
    );
  }

  async approveLoan(application: LoanApplication) {
    this.loansApproved.inc({ loan_type: application.type });
    this.activeApplications.dec({ status: 'pending' });
    this.activeApplications.inc({ status: 'approved' });
  }
}
```

### API reference

| Method | What it creates | Use case |
|--------|----------------|----------|
| `createCounter(name, help, labels?)` | A counter that only goes up | Request counts, errors, events |
| `createHistogram(name, help, labels?, buckets?, enableExemplars?)` | A histogram with configurable buckets | Durations, sizes, latencies |
| `createGauge(name, help, labels?)` | A value that goes up and down | Active connections, queue depth, temperature |

### Counter

```typescript
const errors = metrics.createCounter('payment_errors_total', 'Payment errors', ['error_type']);
errors.inc({ error_type: 'timeout' });        // increment by 1
errors.inc({ error_type: 'validation' }, 3);  // increment by 3
```

### Histogram

```typescript
const duration = metrics.createHistogram(
  'external_api_duration_seconds',
  'External API call duration',
  ['api_name'],
  [0.1, 0.5, 1, 2, 5, 10],  // custom bucket boundaries
);
duration.observe({ api_name: 'esri' }, 1.234);  // record an observation

// Or use a timer
const end = duration.startTimer({ api_name: 'esri' });
await callExternalApi();
end();  // automatically records the elapsed time
```

If no `buckets` array is provided, the SDK uses these defaults: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`.

### Gauge

```typescript
const queue = metrics.createGauge('job_queue_size', 'Pending jobs in queue', ['priority']);
queue.set({ priority: 'high' }, 42);  // set to absolute value
queue.inc({ priority: 'high' });      // increment by 1
queue.dec({ priority: 'high' });      // decrement by 1
```

---

## Exemplars (metrics &rarr; traces)

Exemplars link a specific metric data point to the trace that produced it. When you see a latency spike on a Grafana histogram panel, you can click the exemplar dot and jump directly to the trace in Tempo that caused it.

### How it works

The SDK's `MetricsInterceptor` automatically attaches `trace_id` as an exemplar on every `http_request_duration_seconds` histogram observation. This happens when tracing is enabled — no extra configuration needed.

```typescript
// This is what the interceptor does internally (you don't write this code):
this.httpRequestDuration.observe({
  labels: { method, route, status_code: statusCode },
  value: duration,
  exemplarLabels: traceId ? { trace_id: traceId } : undefined,
});
```

### Adding exemplars to custom histograms

To add exemplars to your own histograms, pass `enableExemplars: true` when creating them:

```typescript
import { getContext } from '@brdrwanda/observability';

const processingTime = metrics.createHistogram(
  'loan_processing_duration_seconds',
  'Time to process a loan application',
  ['loan_type'],
  [0.1, 0.5, 1, 2, 5, 10, 30],
  true, // enableExemplars
);

// When observing, include the trace_id as an exemplar label
const traceId = getContext()?.traceId;
processingTime.observe({
  labels: { loan_type: 'personal' },
  value: 2.45,
  exemplarLabels: traceId ? { trace_id: traceId } : undefined,
});
```

### Viewing exemplars in Grafana

1. Prometheus must be started with `--enable-feature=exemplar-storage` (the sandbox docker-compose already does this)
2. In a Grafana histogram or heatmap panel, enable **Exemplars** in the query options
3. Small diamonds appear on the graph at data points that have exemplars
4. Click a diamond to see its `trace_id`, then click through to Tempo

### Prometheus format with exemplar

```
http_request_duration_seconds_bucket{method="POST",route="/api/loans/apply",status_code="201",le="5"} 312 # {trace_id="8cf631b00df8e35a403e57823ac58eee"} 3.21 1719900000.000
```

---

## Metrics configuration

```typescript
ObservabilityModule.forRoot({
  serviceName: 'loan-service',
  metrics: {
    enabled: true,          // default: true — set to false to disable all metrics
    prefix: '',             // prefix for all metric names (e.g., 'lending' → 'lending_http_requests_total')
    defaultMetrics: true,   // default: true — collect Node.js runtime metrics
    endpoint: '/metrics',   // default: '/metrics' — Prometheus scrape endpoint path
    labels: {               // default labels applied to every metric
      team: 'lending',
    },
  },
})
```

### Configuration options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | When `false`, no metrics interceptor or controller is registered |
| `prefix` | `string` | `''` | Prepended to all metric names. If set to `'lending'`, a metric `http_requests_total` becomes `lending_http_requests_total` |
| `defaultMetrics` | `boolean` | `true` | Collect Node.js runtime metrics (memory, CPU, event loop lag) |
| `endpoint` | `string` | `'/metrics'` | The HTTP path where Prometheus scrapes metrics |
| `labels` | `Record<string, string>` | `{}` | Default labels attached to every metric. `service` and `environment` are always included automatically |

### Automatic default labels

The SDK always adds these labels to every metric, regardless of your config:

```typescript
{
  service: config.serviceName,    // e.g., 'loan-service'
  environment: config.environment // e.g., 'production'
}
```

Any labels you add in `metrics.labels` are merged on top of these.

### Disabling metrics

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  metrics: {
    enabled: false,  // no MetricsController, no MetricsInterceptor
  },
})
```

When disabled, `ObservabilityMetrics` is still provided as a dependency (so injected constructors don't break), but the `/metrics` endpoint and auto-collection interceptor are not registered.

---

## Prometheus scraping

### prometheus.yml

Add your service as a scrape target in your Prometheus configuration:

```yaml
scrape_configs:
  - job_name: "loan-service"
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ["localhost:3000"]

  - job_name: "api-gateway"
    metrics_path: /metrics
    static_configs:
      - targets: ["localhost:7070"]

  - job_name: "authentication-service"
    metrics_path: /metrics
    static_configs:
      - targets: ["localhost:9001"]
```

### Enable exemplar storage

To use exemplars (metrics-to-trace linking), Prometheus must be started with the exemplar feature flag:

```yaml
# docker-compose.yml
prometheus:
  image: prom/prometheus:v2.52.0
  command:
    - '--config.file=/etc/prometheus/prometheus.yml'
    - '--enable-feature=exemplar-storage'
```

### OpenMetrics content negotiation

The SDK's `/metrics` endpoint supports both Prometheus text format and OpenMetrics format. Add the OpenMetrics scrape protocol in your Prometheus config for exemplar support:

```yaml
global:
  scrape_interval: 15s
  scrape_protocols:
    - OpenMetricsText1.0.0
    - OpenMetricsText0.0.1
    - PrometheusProto
    - PrometheusText0.0.4
```

### Verify scraping works

```bash
# Check that the service exposes metrics
curl http://localhost:3000/metrics

# Check that Prometheus is scraping successfully
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'
```

---

## Kubernetes ServiceMonitor (kube-prometheus-stack)

On Kubernetes with [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack), Prometheus discovers scrape targets through **ServiceMonitor** CRDs — not `prometheus.yml`. If your service is running on K8s and Prometheus isn't scraping it, this is what you need.

### Why your service doesn't appear in Grafana

Common symptom: Grafana dashboard shows Prometheus internal metrics (`prometheus-kube-*`) but not your application service. This happens because:

1. **Prometheus uses the operator pattern** — it only scrapes targets that have a matching ServiceMonitor (or PodMonitor)
2. **No ServiceMonitor exists** — the kube-prometheus-stack Helm install creates monitors for its own components but not your application services
3. **Your service exposes `/metrics` correctly** but Prometheus doesn't know where to find it

### Prerequisites

Before creating a ServiceMonitor, verify your service has:

1. **A Kubernetes Service** with a named port:
   ```bash
   kubectl get svc <service-name> -n <namespace> -o yaml
   ```
   The service must have a named port (e.g., `http`) that points to the metrics endpoint.

2. **Labels on the Service** — the ServiceMonitor uses label selectors to find which Service to scrape:
   ```bash
   kubectl get svc <service-name> -n <namespace> --show-labels
   ```

3. **The metrics endpoint working** — verify the pod actually exposes metrics:
   ```bash
   kubectl port-forward svc/<service-name> -n <namespace> 8080:8080
   curl http://localhost:8080/metrics
   ```

4. **Prometheus operator's selector label** — check what label Prometheus requires on ServiceMonitors:
   ```bash
   kubectl get prometheus -n observability -o yaml | grep -A5 "serviceMonitorSelector"
   ```
   BRD's kube-prometheus-stack requires `release: prometheus` on all ServiceMonitors.

### Creating a ServiceMonitor

A ServiceMonitor tells the Prometheus operator: "scrape the `/metrics` endpoint of the Service matching these labels, in this namespace."

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: authentication-service         # descriptive name
  namespace: observability             # where Prometheus runs
  labels:
    release: prometheus                # REQUIRED — must match Prometheus operator's serviceMonitorSelector
    app: authentication-service        # informational
spec:
  namespaceSelector:
    matchNames:
      - tugane-sit                     # namespace where your service runs
  selector:
    matchLabels:
      app.kubernetes.io/instance: authentication-service-sit  # must match a label on your K8s Service
  endpoints:
    - port: http                       # must match the named port on your K8s Service
      path: /metrics                   # SDK default metrics endpoint
      interval: 15s                    # how often Prometheus scrapes (15s recommended)
```

Apply it:

```bash
kubectl apply -f servicemonitor-authentication.yaml
```

### ServiceMonitor field reference

| Field | Required | Description |
|-------|----------|-------------|
| `metadata.namespace` | Yes | Put in same namespace as Prometheus (`observability`) or in the service's namespace — both work if `serviceMonitorNamespaceSelector: {}` |
| `metadata.labels.release` | Yes | Must match the Prometheus operator's `serviceMonitorSelector.matchLabels`. For BRD: `release: prometheus` |
| `spec.namespaceSelector.matchNames` | Yes | List of namespaces where the target Service lives |
| `spec.selector.matchLabels` | Yes | Label selector that matches the Kubernetes Service (not the Pod) |
| `spec.endpoints[].port` | Yes | Named port from the Service spec (e.g., `http`). Must match exactly |
| `spec.endpoints[].path` | No | Defaults to `/metrics`. Set if your SDK uses a custom endpoint |
| `spec.endpoints[].interval` | No | Scrape interval. Defaults to Prometheus global (usually 30s). 15s recommended for production services |
| `spec.endpoints[].scrapeTimeout` | No | Timeout for each scrape. Defaults to 10s. Increase if `/metrics` is slow |

### Template for any BRD service

Replace the placeholder values for each service you onboard:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: <SERVICE_NAME>
  namespace: observability
  labels:
    release: prometheus
spec:
  namespaceSelector:
    matchNames:
      - <SERVICE_NAMESPACE>
  selector:
    matchLabels:
      <SERVICE_LABEL_KEY>: <SERVICE_LABEL_VALUE>
  endpoints:
    - port: <NAMED_PORT>
      path: /metrics
      interval: 15s
```

To find the values you need:

```bash
# 1. Get service labels and port names
kubectl get svc <service-name> -n <namespace> -o yaml

# 2. Look for:
#    metadata.labels → use one as selector.matchLabels
#    spec.ports[].name → use as endpoints[].port
```

### Verifying Prometheus discovered your service

After applying the ServiceMonitor, wait 30-60 seconds for the Prometheus operator to reconcile, then:

**Option 1 — Prometheus targets page (recommended):**

```bash
kubectl port-forward -n observability svc/prometheus-kube-prometheus-prometheus 9090:9090
```

Open `http://localhost:9090/targets` → look for `serviceMonitor/observability/<service-name>`. Status should be `UP`.

**Option 2 — Prometheus API:**

```bash
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | select(.labels.service == "authentication-service") | {job: .labels.job, health: .health, lastScrape: .lastScrape}'
```

**Option 3 — Query a metric directly:**

```bash
curl -s 'http://localhost:9090/api/v1/query?query=up{job=~".*authentication.*"}' | jq '.data.result'
```

**Option 4 — Grafana dashboard:**

Open your Service Overview (RED) or Node.js Runtime dashboard → check the `service` dropdown. Your service name (e.g., `authentication-service`) should appear.

### Adding ServiceMonitors for all BRD services

Each service that has the SDK installed and is deployed on K8s needs its own ServiceMonitor. Here are the 11 BRD services:

| Service | Namespace | SDK Installed | ServiceMonitor Needed |
|---------|-----------|---------------|----------------------|
| api-gateway | tugane-sit | Yes | Yes |
| authentication | tugane-sit | Yes | Yes |
| access-management | tugane-sit | Yes | Yes |
| application | tugane-sit | Yes | Yes |
| product | tugane-sit | Yes | Yes |
| payment | tugane-sit | No (pending) | After SDK install |
| configuration | tugane-sit | No (pending) | After SDK install |
| mel | tugane-sit | No (pending) | After SDK install |
| workflow | tugane-sit | No (pending) | After SDK install |
| profile | tugane-sit | No (pending) | After SDK install |
| uno-job-scheduler | tugane-sit | No (pending) | After SDK install |

To create all at once, list the services and their labels:

```bash
# Find all services and their labels in your namespace
kubectl get svc -n tugane-sit -o custom-columns='NAME:.metadata.name,LABELS:.metadata.labels' --no-headers
```

### Troubleshooting ServiceMonitor issues

**ServiceMonitor created but target not appearing:**

1. **Missing `release: prometheus` label** — most common. Prometheus operator ignores ServiceMonitors without it:
   ```bash
   kubectl get servicemonitor <name> -n observability -o yaml | grep -A2 "labels:"
   ```

2. **Label selector mismatch** — the `selector.matchLabels` must match a label on the Kubernetes Service, not the Pod:
   ```bash
   # Check Service labels (this is what selector matches against)
   kubectl get svc <service> -n <namespace> --show-labels

   # NOT Pod labels (common mistake)
   kubectl get pods -n <namespace> --show-labels
   ```

3. **Port name mismatch** — `endpoints[].port` must exactly match `spec.ports[].name` on the Service:
   ```bash
   kubectl get svc <service> -n <namespace> -o jsonpath='{.spec.ports[*].name}'
   ```

4. **Wrong namespace** — check `namespaceSelector.matchNames` points to correct namespace:
   ```bash
   kubectl get svc -A | grep <service>
   ```

5. **Prometheus not watching namespace** — check Prometheus allows all namespaces:
   ```bash
   kubectl get prometheus -n observability -o yaml | grep -A2 "serviceMonitorNamespaceSelector"
   ```
   `serviceMonitorNamespaceSelector: {}` means "all namespaces" (BRD default).

6. **Service has no matching pods** — the Service selector might not match any running pods:
   ```bash
   kubectl get endpoints <service> -n <namespace>
   ```
   If endpoints are empty, no pods match the Service selector.

**Target appears but shows `DOWN`:**

1. The pod is crashing or not exposing `/metrics`:
   ```bash
   kubectl logs <pod> -n <namespace> --tail=20
   ```

2. Firewall or NetworkPolicy blocking Prometheus from reaching the service:
   ```bash
   # Test from Prometheus pod
   kubectl exec -it prometheus-prometheus-kube-prometheus-prometheus-0 -n observability -- \
     wget -q -O- http://<service>.<namespace>.svc.cluster.local:<port>/metrics | head -5
   ```

3. The SDK's `metrics.enabled` is set to `false` in the service config.

### PodMonitor alternative

If your service doesn't have a Kubernetes Service (e.g., a standalone job or CronJob), use a PodMonitor instead:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: batch-job
  namespace: observability
  labels:
    release: prometheus
spec:
  namespaceSelector:
    matchNames:
      - tugane-sit
  selector:
    matchLabels:
      app: batch-job
  podMetricsEndpoints:
    - port: http
      path: /metrics
      interval: 30s
```

---

## Grafana dashboard queries

Practical PromQL queries for building dashboards. All examples assume the default metric names (no prefix).

### Request rate

Total requests per second across all routes:

```promql
rate(http_requests_total[5m])
```

Request rate for a specific service:

```promql
rate(http_requests_total{service="loan-service"}[5m])
```

Request rate grouped by route:

```promql
sum by (route) (rate(http_requests_total{service="loan-service"}[5m]))
```

### Error rate

5xx errors per second:

```promql
rate(http_requests_total{status_code=~"5.."}[5m])
```

Error percentage (useful for SLO dashboards):

```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
* 100
```

Error rate by route (find which endpoints are failing):

```promql
sum by (route) (rate(http_requests_total{status_code=~"5.."}[5m]))
```

### Latency

P95 latency (95th percentile request duration):

```promql
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

P99 latency:

```promql
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))
```

P95 latency per route:

```promql
histogram_quantile(0.95, sum by (route, le) (rate(http_request_duration_seconds_bucket[5m])))
```

Average request duration:

```promql
rate(http_request_duration_seconds_sum[5m])
/
rate(http_request_duration_seconds_count[5m])
```

### Custom business metrics

Loan approvals per hour:

```promql
rate(loans_approved_total[1h])
```

Loan approvals by type:

```promql
sum by (loan_type) (rate(loans_approved_total[1h]))
```

Currently active loan applications:

```promql
active_loan_applications
```

P95 loan processing time:

```promql
histogram_quantile(0.95, rate(loan_processing_duration_seconds_bucket[5m]))
```

### Node.js runtime

Memory usage:

```promql
process_resident_memory_bytes{service="loan-service"} / 1024 / 1024
```

Event loop lag (should stay under ~100ms):

```promql
nodejs_eventloop_lag_seconds{service="loan-service"}
```

CPU usage rate:

```promql
rate(process_cpu_user_seconds_total{service="loan-service"}[5m])
```

### Alert-worthy queries

High error rate alert (more than 5% of requests are 5xx):

```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
> 0.05
```

High latency alert (P95 above 2 seconds):

```promql
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
> 2
```

Memory usage alert (above 512 MB):

```promql
process_resident_memory_bytes > 536870912
```
