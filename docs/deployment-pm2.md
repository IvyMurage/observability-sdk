# PM2 / Bare-Metal Deployment Guide

## Architecture

```
App Server(s)                    Observability Server
┌────────────────────┐          ┌─────────────────────┐
│ PM2                │          │ Docker Compose       │
│ ├── service-a      │──OTLP──→│ ├── OTel Collector   │
│ ├── service-b      │          │ ├── Tempo (traces)   │
│ └── service-c      │          │ ├── Prometheus       │
│                    │          │ ├── Loki (logs)      │
│ Promtail/Vector ───│──logs──→ │ └── Grafana          │
│ (log shipper)      │          └─────────────────────┘
└────────────────────┘
```

## 1. SDK Configuration (each service)

```typescript
// app.module.ts
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  environment: 'production',
  version: '1.2.3',
  tracing: {
    exporter: {
      type: 'otlp-http',
      endpoint: 'http://<observability-server-ip>:4318',
    },
    sampling: { ratio: 0.1 },
  },
  metrics: { prefix: 'myservice' },
  instrumentations: [
    httpInstrumentation(),
    mysqlInstrumentation(),
  ],
})
```

Or use environment variables:

```bash
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'workflow-service',
    script: 'dist/main.js',
    instances: 2,
    env_production: {
      NODE_ENV: 'production',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://10.0.1.50:4318',
    },
  }],
};
```

## 2. Observability Server Setup

Run the sandbox docker-compose with production Tempo storage:

```yaml
# docker-compose.prod.yml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.100.0
    command: ["--config", "/etc/otel/config.yaml"]
    volumes:
      - ./otel-collector/config.yaml:/etc/otel/config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
      - "8889:8889"
    restart: always

  prometheus:
    image: prom/prometheus:v2.52.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"
    restart: always

  loki:
    image: grafana/loki:2.9.6
    volumes:
      - loki-data:/loki
    ports:
      - "3100:3100"
    command: -config.file=/etc/loki/local-config.yaml
    restart: always

  tempo:
    image: grafana/tempo:2.4.1
    command: ["-config.file=/etc/tempo.yaml"]
    volumes:
      - ./tempo-prod.yaml:/etc/tempo.yaml:ro
      - tempo-data:/var/tempo
    ports:
      - "3200:3200"
    restart: always

  grafana:
    image: grafana/grafana:10.4.2
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
      - GF_SERVER_ROOT_URL=http://grafana.yourdomain.com
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - grafana-data:/var/lib/grafana
    ports:
      - "3000:3000"
    restart: always

volumes:
  prometheus-data:
  loki-data:
  tempo-data:
  grafana-data:
```

Key differences from sandbox:
- `restart: always` — survives reboots
- Named volumes — data persists across container restarts
- Grafana password via env var, not hardcoded

## 3. Tempo Production Config

```yaml
# tempo-prod.yaml
server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        http:
        grpc:

storage:
  trace:
    backend: local
    local:
      path: /var/tempo/blocks
    wal:
      path: /var/tempo/wal
    block:
      bloom_filter_false_positive: 0.05

# Retention: auto-delete traces older than 7 days
compactor:
  compaction:
    block_retention: 168h
```

For S3 storage (if you have it):

```yaml
storage:
  trace:
    backend: s3
    s3:
      bucket: your-traces-bucket
      endpoint: s3.amazonaws.com
      region: us-east-1
      access_key: ${S3_ACCESS_KEY}
      secret_key: ${S3_SECRET_KEY}
```

## 4. Log Collection

PM2 writes stdout to log files. Ship them to Loki with Promtail:

```yaml
# promtail-config.yaml (run on app server)
server:
  http_listen_port: 9080

positions:
  filename: /var/promtail/positions.yaml

clients:
  - url: http://<observability-server-ip>:3100/loki/api/v1/push

scrape_configs:
  - job_name: pm2
    static_configs:
      - targets: [localhost]
        labels:
          __path__: /home/deploy/.pm2/logs/*.log
          environment: production
    pipeline_stages:
      - json:
          expressions:
            level: level
            service: service_name
            trace_id: trace_id
      - labels:
          level:
          service:
```

Install Promtail on app server:

```bash
# Download and run as systemd service
curl -LO https://github.com/grafana/loki/releases/download/v2.9.6/promtail-linux-amd64.zip
unzip promtail-linux-amd64.zip
sudo mv promtail-linux-amd64 /usr/local/bin/promtail
```

## 5. Prometheus Scraping

Add all your PM2 services as Prometheus targets:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: "otel-collector"
    static_configs:
      - targets: ["otel-collector:8889"]

  - job_name: "nestjs-services"
    static_configs:
      - targets:
          - "10.0.1.10:3001"  # api-gateway
          - "10.0.1.10:3002"  # workflow-service
          - "10.0.1.11:3001"  # crm-service
          - "10.0.1.11:3002"  # credit-service
        labels:
          environment: production
```

Or use file-based discovery for dynamic targets:

```yaml
  - job_name: "nestjs-services"
    file_sd_configs:
      - files: ["/etc/prometheus/targets/*.json"]
        refresh_interval: 30s
```

## 6. PM2 Ecosystem File

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'api-gateway',
      script: 'dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://10.0.1.50:4318',
      },
    },
    {
      name: 'workflow-service',
      script: 'dist/main.js',
      instances: 1,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3002,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://10.0.1.50:4318',
      },
    },
  ],
};
```

Start: `pm2 start ecosystem.config.js --env production`

## Summary

| Component | Where | How |
|---|---|---|
| SDK | Each service | `ObservabilityModule.forRoot()` |
| OTel Collector | Observability server | Docker |
| Tempo | Observability server | Docker + volume |
| Prometheus | Observability server | Docker + static targets |
| Loki | Observability server | Docker + volume |
| Grafana | Observability server | Docker + volume |
| Promtail | App server(s) | Systemd service |
| PM2 | App server(s) | Manages NestJS processes |
