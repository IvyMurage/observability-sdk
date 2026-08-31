# Grafana Observability Stack — Troubleshooting & Resolution

> BRD HQ Cluster · `observability` namespace · 2026-08-31

---

## 1. Issues Encountered

### Problem 1: Prometheus Metrics Scrape — 500 Error

**Symptom:** Prometheus scraping `/api/metrics` on configuration-service returns HTTP 500. Service is reachable but the CORS middleware rejects the request.

**Root cause:** The CORS `origin` callback in `constant.common.ts` throws an `HttpException` when `origin` is `undefined`. Prometheus is a server-to-server caller — it sends no `Origin` header, so the value arrives as `undefined`, which fails the whitelist check.

**Error log:**
```
"message": "undefined is not allowed by CORS policy"
"method": "GET", "url": "/api/metrics"
"stack": "HttpException: undefined is not allowed by CORS policy
    at origin (/opt/app-root/src/dist/common/constant.common.js:18:22)"
```

**File:** `src/common/constant.common.ts:30`

---

### Problem 2: No Tempo Datasource in Grafana

**Symptom:** Tempo pod running in k8s (`tempo-0`, ports 3100/4317/4318) but no Grafana datasource configured for it. Traces cannot be queried from Grafana.

**Root cause:** No ConfigMap with label `grafana_datasource: "1"` exists for Tempo. The kube-prometheus-stack Helm chart provisions Prometheus and Alertmanager datasources, but Tempo was installed separately and never linked to Grafana.

---

### Problem 3: No Trace-to-Log Correlation

**Symptom:** Log lines containing `trace_id` in Loki have no clickable link to Tempo. Logs and traces exist independently with no cross-referencing.

**Root cause:** Loki datasource missing `derivedFields` configuration. Without it, Grafana cannot extract `trace_id` from log lines and link them to Tempo traces.

---

### Problem 4: Grafana `parentUID` Dashboard Crash

**Symptom:** Grafana 12.2.0 `DashboardListPage` throws:
```
TypeError: cannot use 'in' operator to search for "parentUID" in "<!DOCTYPE html>…"
```

**Root cause:** Grafana 12.x enables `kubernetesDashboards` feature flag by default. The new `folder.grafana.app/v1beta1` Kubernetes-style API server for folder management returns the SPA HTML shell instead of JSON API responses. The JavaScript then tries `"parentUID" in response` where `response` is an HTML string, not an object.

**Impact:** Dashboard list page crashes. Individual dashboards accessible by direct URL. Explore page unaffected.

---

### Problem 5: Datasource UID Mismatch After Re-provisioning

**Symptom:** After modifying the Loki datasource ConfigMap, Grafana logs spam:
```
"Datasource provisioning error: data source not found"
```
All dashboards show "Datasource P8E80F9AEF21F6940 was not found."

**Root cause:** The existing Loki datasource had auto-generated UID `P8E80F9AEF21F6940`. Provisioning a new ConfigMap with `uid: loki` caused Grafana to fail reconciling old vs new UID. Using `deleteDatasources` removed the old one, but the new UID didn't match what dashboards reference.

**Key learning:** All dashboard panels store datasource references by UID. Changing the UID breaks every panel.

---

## 2. Architecture — Trace Pipeline

The intended observability pipeline for traces:

```
NestJS App → OTLP HTTP :4318 → Tempo → Grafana (Explore)
```

Tempo in this cluster accepts OTLP directly — no OpenTelemetry Collector needed as intermediary. The internal service endpoint is:

```
http://tempo.observability.svc:4318
```

For log-to-trace correlation:

```
App Log (Pino JSON) → Promtail → Loki → Grafana derivedFields → Tempo (via trace_id)
```

### Key Services

| Service | Namespace | Port | Purpose |
|---------|-----------|------|---------|
| `tempo` | observability | 3100 (HTTP API), 4317 (gRPC OTLP), 4318 (HTTP OTLP) | Trace storage & query |
| `loki-gateway` | observability | 80 | Log aggregation gateway |
| `prometheus-kube-prometheus-prometheus` | observability | 9090 | Metrics |
| `prometheus-grafana` | observability | 80 | Visualization |

---

## 3. Workarounds Applied

### Workaround 1: CORS Fix for Prometheus Scraping

Added `!origin ||` check to allow requests without an `Origin` header (server-to-server) through CORS.

**Before (broken):**
```typescript
origin: (origin: string, callback) => {
  if (corsWhitelist.indexOf(origin) !== -1) {
    callback(null, true);
  } else {
    callback(new HttpException(`${origin} is not allowed by CORS policy`, HttpStatus.INTERNAL_SERVER_ERROR));
  }
}
```

**After (fixed):**
```typescript
origin: (origin: string | undefined, callback) => {
  // Allow requests with no Origin header (server-to-server: Prometheus, health checks, curl)
  if (!origin || corsWhitelist.indexOf(origin) !== -1) {
    callback(null, true);
  } else {
    callback(new HttpException(`${origin} is not allowed by CORS policy`, HttpStatus.INTERNAL_SERVER_ERROR));
  }
}
```

**Status:** Applied locally on configuration-microservice. Needs deployment to k8s. Same fix needed on all services.

---

### Workaround 2: Loki Datasource UID Restored

Used `deleteDatasources` directive in the Loki ConfigMap to remove the broken datasource, then re-created it with the original UID `P8E80F9AEF21F6940` that all dashboards reference.

```yaml
deleteDatasources:
  - name: Loki
    orgId: 1
datasources:
  - name: Loki
    uid: P8E80F9AEF21F6940  # original auto-generated UID
    url: http://loki-gateway.observability.svc.brd-hq-cluster.brd.rw
```

**Status:** Applied. Dashboards load again.

---

### Workaround 3: `parentUID` Dashboard Crash — Use Direct URLs

The Dashboards list page crashes in Grafana 12.2.0 due to the `kubernetesDashboards` feature. Direct navigation to individual dashboards or the Explore page bypasses the broken `DashboardListPage` component.

**Status:** Ongoing. Permanent fix requires Grafana version change or feature flag toggle.

---

## 4. Permanent Solutions

### Solution 1: Deploy CORS Fix to All Services

The `!origin` CORS fix must be deployed to **every service** using the same CORS pattern:
- configuration-microservice
- authentication-service
- api-gateway
- access-management-service
- application-service

**Action:** Update `constant.common.ts` in each service, rebuild, and deploy.

---

### Solution 2: Add Tempo Datasource via Grafana UI

Add Tempo as a datasource through the Grafana web interface to avoid ConfigMap provisioning conflicts.

**Steps:**
1. Go to **Connections → Data sources → Add data source → Tempo**
2. URL: `http://tempo.observability.svc:3100`
3. Trace to logs: select **Loki**, enable "Filter by trace ID"
4. Trace to metrics: select **Prometheus**
5. Save & test

---

### Solution 3: Add Loki Derived Fields via Grafana UI

Add trace correlation to Loki through the Grafana web interface.

**Steps:**
1. Go to **Connections → Data sources → Loki → Edit**
2. Scroll to **Derived fields**
3. Add field: Name = `TraceID`, Regex = `"trace_id":"(\w+)"`
4. Internal link → select **Tempo**
5. Save & test

After this, log lines with `trace_id` show a clickable link → opens trace in Tempo.

---

### Solution 4: Set `OTEL_EXPORTER_OTLP_ENDPOINT` in Services

Each service must have the OTLP endpoint configured to send traces to Tempo:

```bash
# Add to each service's k8s secret
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo.observability.svc:4318
```

The SDK's tracing config in `app.module.ts` reads this env var and sends traces via OTLP HTTP.

---

### Solution 5: Fix `parentUID` — Downgrade or Upgrade Grafana

The `DashboardListPage` crash is a Grafana 12.2.0 bug with the `kubernetesDashboards` feature. Options:

| Option | Approach | Risk |
|--------|----------|------|
| **A (Recommended)** | Downgrade to Grafana 11.x (e.g., `11.4.0`) via Helm | Low — stable, proven |
| **B** | Upgrade to a patched 12.x release | Medium — may introduce other changes |
| **C** | Disable feature flag: `[feature_toggles] kubernetesDashboards = false` in `grafana.ini` | Low — but untested side effects |

---

## 5. Key Files & ConfigMaps

| Resource | Location / Name | Purpose |
|----------|-----------------|---------|
| Loki Datasource | `grafana-datasource-loki` ConfigMap | UID: `P8E80F9AEF21F6940` — all dashboards reference this |
| Tempo Datasource | `grafana-datasource-tempo` ConfigMap | To be created — or add via Grafana UI instead |
| Grafana Config | `prometheus-grafana` ConfigMap | Contains `grafana.ini` — server config, feature toggles |
| ServiceMonitors | `sandbox/k8s/servicemonitor-*.yaml` | Prometheus scrape targets, path: `/api/metrics` |
| CORS Config | `src/common/constant.common.ts` | Per-service — needs `!origin` fix |
| Prometheus Config | `sandbox/prometheus.yml` | Local sandbox scrape paths, updated to `/api/metrics` |

---

## 6. Lessons Learned

1. **Never provision a datasource ConfigMap without specifying the original UID.** Grafana auto-generates UIDs when none is specified. Dashboards reference these UIDs. Changing or omitting them breaks every panel.

2. **Use `deleteDatasources` when changing a datasource UID.** Without it, Grafana can't reconcile old vs new and enters a provisioning error loop.

3. **Prefer Grafana UI for datasource changes** over ConfigMap provisioning when dashboards already exist — it preserves UIDs and avoids provisioning conflicts.

4. **NestJS global prefix `/api` affects all endpoints** including SDK health and metrics routes. ServiceMonitors and Prometheus configs must use `/api/metrics`, not `/metrics`.

5. **CORS must allow `undefined` origin** for server-to-server callers (Prometheus, health checks, internal k8s probes). This is a cross-cutting concern that affects every service.

6. **Check datasource UIDs before modifying provisioning.** Run this in Grafana to find current UIDs:
   ```
   Connections → Data sources → click datasource → UID shown in URL
   ```
