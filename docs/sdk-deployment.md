# SDK Deployment & Distribution Guide

How to build, publish, and consume `@company/observability` across your services.

---

## Deployment Options

```
Option A: Private npm Registry     Option B: Git-based Install
┌─────────────────────┐            ┌─────────────────────┐
│ Build SDK            │            │ Build SDK            │
│ npm publish          │            │ git push / tag       │
│ → Verdaccio/GitHub   │            │                     │
│   Packages/GitLab    │            │ Services install via │
│                      │            │ git+ssh:// or        │
│ Services install via │            │ file: path           │
│ npm install @company │            └─────────────────────┘
│   /observability     │
└─────────────────────┘

Option C: Monorepo Workspace
┌─────────────────────────────────┐
│ All services + SDK in one repo  │
│ pnpm workspace links SDK        │
│ No publish step needed          │
└─────────────────────────────────┘
```

---

## Option A: Private npm Registry (Recommended for multi-repo)

### 1. Choose a registry

| Registry | Hosting | Cost |
|---|---|---|
| **Verdaccio** | Self-hosted (Docker) | Free |
| **GitHub Packages** | GitHub-hosted | Free for private repos |
| **GitLab Packages** | GitLab-hosted | Free |
| **npm (org)** | npmjs.com | $7/user/mo for private |
| **AWS CodeArtifact** | AWS-hosted | Usage-based |

### 2. Build the SDK

```bash
cd packages/sdk
pnpm build
```

Output lands in `dist/`:
```
dist/
  index.js      # CJS (require)
  index.mjs     # ESM (import)
  index.d.ts    # TypeScript types
  index.js.map  # Source maps
```

### 3. Publish

#### Verdaccio (self-hosted, simplest)

```bash
# Run Verdaccio
docker run -d --name verdaccio -p 4873:4873 verdaccio/verdaccio

# Point npm to it
npm set registry http://localhost:4873
npm adduser --registry http://localhost:4873

# Publish
cd packages/sdk
npm publish --registry http://localhost:4873
```

#### GitHub Packages

```bash
# .npmrc in SDK root
@company:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}

# Update package.json
# "name": "@your-gh-org/observability"
# "publishConfig": { "registry": "https://npm.pkg.github.com" }

npm publish
```

#### GitLab Packages

```bash
# .npmrc
@company:registry=https://gitlab.com/api/v4/projects/<PROJECT_ID>/packages/npm/
//gitlab.com/api/v4/projects/<PROJECT_ID>/packages/npm/:_authToken=${GITLAB_TOKEN}

npm publish
```

### 4. Consume in services

```bash
# In each service repo, point to your registry
echo "@company:registry=http://your-verdaccio:4873" >> .npmrc

# Install
pnpm add @company/observability
```

### 5. Version bumps

```bash
cd packages/sdk

# Patch (bug fix): 0.1.0 → 0.1.1
npm version patch

# Minor (new feature): 0.1.0 → 0.2.0
npm version minor

# Major (breaking change): 0.1.0 → 1.0.0
npm version major

# Build & publish
pnpm build && npm publish
```

---

## Option B: Git-based Install (No registry needed)

Install directly from git. No registry setup required.

### From GitHub/GitLab

```bash
# SSH
pnpm add git+ssh://git@github.com:your-org/internal-observability-platform.git#v0.1.0

# HTTPS
pnpm add git+https://github.com/your-org/internal-observability-platform.git#v0.1.0
```

**Important**: package.json `main`/`types` point to `dist/`, so you must commit built files or use a `prepare` script:

```jsonc
// packages/sdk/package.json
{
  "scripts": {
    "prepare": "tsup"  // auto-builds on install
  }
}
```

### From a tag/release

```bash
# Tag a release
git tag v0.1.0
git push origin v0.1.0

# Install from tag
pnpm add git+ssh://git@github.com:your-org/observability-platform.git#v0.1.0
```

### From local path (development)

```bash
# Service repo sits next to SDK repo
pnpm add file:../internal-observability-platform/packages/sdk
```

---

## Option C: Monorepo Workspace (All services in one repo)

If all services live in the same repo, no publishing needed.

### Structure

```
monorepo/
  packages/
    observability/          # The SDK
  services/
    api-gateway/
    workflow-service/
    crm-service/
```

### pnpm-workspace.yaml

```yaml
packages:
  - "packages/*"
  - "services/*"
```

### Service package.json

```jsonc
{
  "dependencies": {
    "@company/observability": "workspace:*"
  }
}
```

`pnpm install` automatically links the SDK. Changes to SDK are immediately available — no build/publish cycle during development.

Build order handled by Turborepo:

```bash
turbo build  # builds SDK first, then services
```

---

## CI/CD Pipeline

### GitHub Actions example

```yaml
# .github/workflows/publish-sdk.yml
name: Publish SDK

on:
  push:
    tags: ["v*"]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://npm.pkg.github.com"

      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @company/observability build
      - run: pnpm --filter @company/observability test

      - run: pnpm --filter @company/observability publish --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Workflow

```
Developer pushes SDK change
    → PR review + merge to main
    → Tag release: git tag v0.2.0 && git push origin v0.2.0
    → CI runs tests + publishes to registry
    → Services update: pnpm update @company/observability
```

---

## Service Integration Checklist

After SDK is available, each service needs:

### 1. Install

```bash
pnpm add @company/observability

# Add instrumentations you need
pnpm add mysql2 @opentelemetry/instrumentation-mysql2   # if using MySQL
pnpm add ioredis @opentelemetry/instrumentation-ioredis  # if using Redis
pnpm add kafkajs @opentelemetry/instrumentation-kafkajs  # if using Kafka
```

### 2. Configure module

```typescript
// app.module.ts
import {
  ObservabilityModule,
  ObservabilityHealthModule,
  httpInstrumentation,
  mysqlInstrumentation,    // add what you need
  redisInstrumentation,
  kafkaInstrumentation,
} from '@company/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'api-gateway',
      tracing: {
        exporter: { type: 'otlp-http' },  // endpoint from env var
        sampling: { ratio: 0.1 },
      },
      metrics: { prefix: 'apigateway' },
      instrumentations: [
        httpInstrumentation({ ignoreIncomingPaths: ['/health', '/metrics'] }),
        mysqlInstrumentation(),
        redisInstrumentation(),
        kafkaInstrumentation(),
      ],
    }),
    ObservabilityHealthModule,
  ],
})
export class AppModule {}
```

### 3. Replace NestJS logger

```typescript
// main.ts
import { NestPinoLogger } from '@company/observability';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(NestPinoLogger));
  await app.listen(3000);
}
```

### 4. Set environment variables

```bash
# PM2 ecosystem or .env or K8s configmap
NODE_ENV=production
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

### 5. Verify

```bash
# Health check
curl http://localhost:3000/health

# Metrics endpoint
curl http://localhost:3000/metrics

# Check traces in Grafana → Explore → Tempo
# Search by service.name = "api-gateway"
```

---

## Updating the SDK Across Services

### Breaking change workflow

```
1. Bump major version in SDK (npm version major)
2. Update CHANGELOG with migration notes
3. Publish new version
4. Update services one at a time:
   pnpm add @company/observability@^1.0.0
5. Test each service before moving to next
```

### Non-breaking change

```
1. Bump patch/minor in SDK
2. Publish
3. Services pick it up on next pnpm update
```

### Pin versions in production

```jsonc
// service package.json — pin exact version for stability
{
  "dependencies": {
    "@company/observability": "0.1.0"    // exact, not ^0.1.0
  }
}
```

---

## Recommendation

| Situation | Use |
|---|---|
| Services in separate repos, small team | **Verdaccio** (5min Docker setup) |
| Services in separate repos, using GitHub | **GitHub Packages** (free, no infra) |
| All services in one repo | **Workspace** (zero publish overhead) |
| Quick prototyping / early development | **Git install** or **file: path** |

For your PM2 setup with multiple NestJS services: **Verdaccio** or **GitHub Packages**. Run Verdaccio on the same server as your observability stack, publish once, install everywhere.
