# Campaign Processing & Notification Platform

A scalable, fault-tolerant **Campaign Processing & Notification Platform** built with **Node.js, Express, TypeScript, MongoDB, Redis, BullMQ, and React**. Designed to ingest thousands of recipients via CSV or JSON, validate and deduplicate records, process notifications asynchronously in controllable batches with exponential backoff, enforce three-layer idempotency, and provide real-time observability and lifecycle controls.

---

## 1. System Architecture

```mermaid
flowchart LR
    Client["React + TypeScript Dashboard"] -->|REST + Multipart CSV| API["Express API Process\n(src/server.ts)"]
    API -->|SSE Stream + Polling| Client
    API -->|CRUD & Durable Records| Mongo[("MongoDB 7\n(campaigns & deliveries)")]
    API -->|Versioned Cache & Lua Rate Limit| Redis[("Redis 7\n(Cache, Rate Limit, BullMQ)")]
    API -->|Enqueue Dispatch Job| Redis
    Worker["Separate Worker Process\n(src/worker.ts)"] <-->|campaign-dispatch & delivery-queue| Redis
    Worker -->|Atomic CAS State Transitions| Mongo
    Worker -->|Idempotent Send (Idempotency-Key)| Provider["Mock Notification Gateway\n(Redis-backed Deduplication)"]
```

### Key Architectural Highlights
- **Strict Process Separation**: The Express HTTP API (`backend/src/server.ts`) **never** sends notifications directly; it validates inputs, persists durable MongoDB records, and enqueues orchestration jobs into BullMQ. Delivery execution happens in an independent Worker process (`backend/src/worker.ts`) with configurable concurrency (`WORKER_CONCURRENCY`).
- **Controlled Batching**: Rather than flooding Redis with an uncontrolled workload, the Campaign Dispatcher streams `queued` deliveries from MongoDB in configurable micro-batches (`CAMPAIGN_BATCH_SIZE = 250`) and dispatches them via `queue.addBulk()`, checking for `paused` or `cancelled` flags before each batch.
- **Three-Layer Idempotency & Deduplication**:
  1. **API Layer**: Client `Idempotency-Key` header persisted on `Campaign` with a unique compound index `{ tenantId: 1, idempotencyKey: 1 }` prevents duplicate campaign creation on client retry (`200 OK`, `X-Idempotent-Replay: true`).
  2. **Database & Queue Layer**: Deterministic `deliveryId = "del_" + sha256(campaignId + ":" + channel + ":" + normalizedRecipient)` backed by unique MongoDB indexes (`{ deliveryId: 1 }` and `{ campaignId: 1, recipient: 1 }`) and deterministic BullMQ `jobId`s.
  3. **Provider Layer**: The Mock Notification Provider enforces `SET provider:idemp:<deliveryId> <receipt> EX 86400 NX` in Redis, preventing duplicate external notifications even if a worker crashes *after* the provider succeeds but *before* MongoDB persists `succeeded`.
- **Atomic Concurrency Without Fragile Custom Locks**: Concurrent workers claim deliveries via atomic MongoDB `findOneAndUpdate` Compare-And-Swap (`status: 'queued' -> 'processing'`) and update campaign counters (`$inc`) strictly on valid state transitions so retries **never** double-count statistics.

---

## 2. Quick Start & Setup Instructions

### Option A: Docker Compose (Recommended Full Stack)
Starts **MongoDB 7**, **Redis 7**, **Express API**, **Dedicated BullMQ Worker**, and **React Frontend**:

```bash
cp .env.example .env
docker compose up --build -d
```

- **React Monitoring Dashboard**: `http://localhost:5173`
- **Express REST & SSE API**: `http://localhost:4000/api`
- **System Health & Telemetry**: `http://localhost:4000/api/health`

To scale worker instances horizontally:
```bash
docker compose up -d --scale worker=3
```

### Option B: Local Development Setup
1. Start infrastructure (via Docker or local MongoDB + Redis services):
   ```bash
   npm run docker:infra
   ```
2. Copy environment variables:
   ```bash
   cp .env.example .env
   ```
3. Install dependencies and start the 3 processes in separate terminals:
   ```bash
   # Terminal 1: Backend Express API (port 4000)
   cd backend && npm install && npm run dev:api

   # Terminal 2: Separate BullMQ Worker Process
   cd backend && npm run dev:worker

   # Terminal 3: React + TypeScript Dashboard (port 5173)
   cd frontend && npm install && npm run dev
   ```

---

## 3. Database Schema & Index Decisions

### 3.1 `campaigns` Collection (`backend/src/models/Campaign.ts`)
Stores campaign metadata, lifecycle status (`draft`, `scheduled`, `processing`, `paused`, `completed`, `partially_failed`, `failed`, `cancelled`), recipient validation breakdown, and real-time counters (`total`, `queued`, `processing`, `succeeded`, `failed`, `skipped`).

| Index Name | Keys | Options | Engineering Justification |
| :--- | :--- | :--- | :--- |
| `uniq_tenant_idempotency_key` | `{ tenantId: 1, idempotencyKey: 1 }` | `unique: true`, `partialFilterExpression: { idempotencyKey: { $type: 'string' } }` | Enforces atomic API idempotency per tenant when clients retry `POST /api/campaigns`. |
| `idx_tenant_status_created` | `{ tenantId: 1, status: 1, createdAt: -1 }` | Compound index | Optimizes paginated dashboard campaign listing, status filtering, and sorting. |
| `idx_status_scheduled_at` | `{ status: 1, scheduledAt: 1 }` | Compound index | Optimizes lookup of due scheduled campaigns. |

### 3.2 `deliveries` Collection (`backend/src/models/Delivery.ts`)
Stores durable per-recipient delivery state (`queued`, `processing`, `succeeded`, `failed`, `skipped`), `failureType` (`transient`, `permanent`, `validation`, `duplicate`, `cancelled`), `attemptsMade`, `providerMessageId`, and full `attemptHistory`.

| Index Name | Keys | Options | Engineering Justification |
| :--- | :--- | :--- | :--- |
| `deliveryId_1` | `{ deliveryId: 1 }` | `unique: true` | Enforces globally unique deterministic delivery identifier (`sha256(campaignId:channel:recipient)`). |
| `uniq_campaign_recipient` | `{ campaignId: 1, recipient: 1 }` | `unique: true` (partial on active/valid statuses) | Guarantees a recipient never receives two active delivery records within the same campaign. |
| `idx_campaign_status_cursor` | `{ campaignId: 1, status: 1, _id: 1 }` | Compound index | Enables $O(1)$ cursor-based batch streaming of `queued` deliveries and fast pagination of `failed` deliveries. |

---

## 4. Redis Caching & Distributed Rate Limiting

### 4.1 API Caching (`backend/src/services/cacheService.ts`)
- **Tenant Isolation**: Every cache key incorporates `tenantId` (`X-Tenant-ID` header) and an atomic tenant version number (`cache:v1:tenant:<tenantId>:version`).
- **Cache Keys & TTLs**:
  - Campaign List: `cache:v1:tenant:<tenantId>:v<ver>:campaigns:list:<queryHash>` (`TTL = 30s`)
  - Dashboard Summary: `cache:v1:tenant:<tenantId>:v<ver>:campaigns:summary` (`TTL = 15s`)
  - Campaign Detail: `cache:v1:tenant:<tenantId>:v<ver>:campaign:<campaignId>` (`TTL = 15s`)
- **Deterministic $O(1)$ Invalidation**: Whenever a campaign is created, updated, paused, resumed, cancelled, retried, or updated by a worker, `INCR cache:v1:tenant:<tenantId>:version` atomically invalidates all cached list pages, search filters, and summaries for that tenant without blocking Redis with `KEYS *`.

### 4.2 Distributed Rate Limiting (`backend/src/middleware/rateLimiter.ts`)
- Uses an atomic Redis Lua script (`INCR` + `PEXPIRE` + `PTTL`) shared across all API instances.
- Emits `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on every response, and returns `429 Too Many Requests` + `Retry-After: <seconds>` when exceeded.

---

## 5. API Documentation & Postman Collection

Import [`postman_collection.json`](./postman_collection.json) into Postman to test all endpoints interactively.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/campaigns` | Create campaign via JSON or multipart CSV upload (`Idempotency-Key` supported). |
| `POST` | `/api/campaigns/validate-recipients` | Preview recipient validation & deduplication report before creating a campaign. |
| `GET` | `/api/campaigns` | List campaigns with `search`, `status`, `channel`, `page`, `limit` (Redis cached). |
| `GET` | `/api/campaigns/summary` | Global tenant KPI summary (Redis cached). |
| `GET` | `/api/campaigns/events` | Server-Sent Events (SSE) live stream for real-time dashboard progress. |
| `GET` | `/api/campaigns/:id` | Get campaign details & live statistics (Redis cached). |
| `PATCH` | `/api/campaigns/:id` | Update campaign name, subject, template, or schedule. |
| `POST` | `/api/campaigns/:id/start` | Immediately start a `draft` or `scheduled` campaign. |
| `POST` | `/api/campaigns/:id/pause` | Pause an active campaign (workers defer remaining deliveries). |
| `POST` | `/api/campaigns/:id/resume` | Resume a paused campaign and re-dispatch queued deliveries. |
| `POST` | `/api/campaigns/:id/cancel` | Cancel a campaign and mark remaining queued deliveries as `skipped`. |
| `GET` | `/api/campaigns/:id/deliveries` | Inspect deliveries filtered by `status` (`failed`, `skipped`, `succeeded`), `failureType`, and `search`. |
| `POST` | `/api/campaigns/:id/retry` | Manually reprocess all failed deliveries or selected `deliveryIds`. |
| `GET` | `/api/health` | System health check (MongoDB, Redis, BullMQ queues, active worker heartbeats, cache & provider telemetry). |
| `GET` | `/api/health/failed-jobs` | Inspect raw failed jobs in BullMQ `delivery-queue`. |

---

## 6. Automated Tests & How to Run Them

The automated integration test suite (`backend/tests/`) uses **Vitest + Supertest** against MongoDB and covers all 8 required assignment scenarios:
1. Campaign creation, CSV/JSON validation, and batch enqueueing (`part1-api-cache-ratelimit.test.ts`)
2. Future scheduled campaign delayed enqueueing (`part1-api-cache-ratelimit.test.ts`)
3. Duplicate request handling via `Idempotency-Key` (`part1-api-cache-ratelimit.test.ts`)
4. Cache hit/miss, tenant isolation, and cache invalidation on state change (`part1-api-cache-ratelimit.test.ts`)
5. Distributed rate-limit enforcement returning `429` + `Retry-After` (`part1-api-cache-ratelimit.test.ts`)
6. Retry after a transient provider failure (`429`) with exponential backoff and zero-drift counters (`part2-worker-reliability-concurrency.test.ts`)
7. Permanent failure handling (`400 Hard Bounce` $\rightarrow$ BullMQ `UnrecoverableError`), failed job inspection, and manual retry (`part2-worker-reliability-concurrency.test.ts`)
8. Concurrent worker race (10 simultaneous workers) & post-provider worker crash recovery without duplicate external sends (`part2-worker-reliability-concurrency.test.ts`)
9. Pause, resume, and cancellation behavior (`part2-worker-reliability-concurrency.test.ts`)

### Run Automated Tests
```bash
npm test
# or inside backend/:
cd backend && npm test
```

---

## 7. 5,000-Recipient Load-Test Benchmark Report (Module 7)

Run the repeatable 5,000-recipient load benchmark at any time with:

```bash
npm run benchmark
# or inside backend/:
cd backend && npm run benchmark
```

### Measured Benchmark Environment & Results
- **Test Machine**: Windows_NT 10.0.26300 (x64), AMD Ryzen 7 5825U (16 logical cores), Node.js `v22.15.0`, MongoDB 7 (`localhost:27017`).
- **Workload Composition (5,000 Submitted Recipients)**:
  - `4,800` standard valid recipients (succeed on Attempt 1)
  - `100` transient failure recipients (`retry-once-*` — fail on Attempt 1 with `429 Rate Limit`, succeed on Attempt 2 after backoff)
  - `50` permanent bounce recipients (`perm-fail-*` — fail immediately on Attempt 1 with `400 Hard Bounce` / `UnrecoverableError`)
  - `25` invalid email format rows (caught & marked `skipped` during validation)
  - `25` duplicate email rows (caught & marked `skipped` during deduplication)
- **Worker Configuration**: `WORKER_CONCURRENCY = 25`, `CAMPAIGN_BATCH_SIZE = 250`, Mock Provider Latency = `2ms – 6ms`.

| Metric | Measured Value |
| :--- | :--- |
| **Total Submitted Recipients** | `5,000` |
| **Ingestion, Zod Validation, Deduplication & MongoDB Bulk Insert** | `2,484 ms` (`2.48 s`) |
| **Batch Dispatch Count** | `4,950` valid deliveries across `20` batches (`250` per batch) |
| **Worker Processing Duration (including 100 retries)** | `27,127 ms` (`27.13 s`) |
| **Total End-to-End Duration** | `29,611 ms` (`29.61 s`) |
| **Worker Delivery Throughput** | **`182.48 deliveries/sec`** |
| **End-to-End Campaign Throughput** | **`168.86 recipients/sec`** |
| **Final Campaign Status** | `partially_failed` |
| **Final Persisted Campaign Counters** | `total: 5000, succeeded: 4900, failed: 50, skipped: 50, queued: 0, processing: 0` |
| **Provider Dispatches vs. Duplicates** | `4,900` unique dispatches (`0` duplicate sends, `100` transient errors retried, `50` permanent bounces) |

### Benchmark Limitations & Notes
- Benchmark uses controlled mock provider latency (`2ms–6ms`) to measure platform queue, worker concurrency, and MongoDB atomic update throughput rather than external SMTP network round-trips.
- In single-node MongoDB mode, each delivery transition performs atomic document updates on `deliveries` and `$inc` updates on `campaigns`. See [`RELIABILITY.md`](./RELIABILITY.md) for detailed trade-offs, crash recovery analysis, and horizontal scaling strategies.
