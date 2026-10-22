# RELIABILITY.md — Delivery Guarantees, Crash Recovery, Concurrency & Trade-offs

This document details the reliability architecture, delivery guarantees, failure recovery mechanisms, concurrency model, system bottlenecks, and future scaling improvements for the **Campaign Processing & Notification Platform**.

---

## 1. Delivery Guarantees & Limitations (Module 3)

### 1.1 Do We Claim "Exactly-Once" External Delivery?
**No — we do not falsely claim unconditional "exactly-once" external delivery across arbitrary third-party gateways.**
In any distributed system communicating over a network with an external notification provider (Email/SMS/Push gateway), it is mathematically impossible (by the Two Generals' Problem) to guarantee *unconditional* exactly-once delivery if the external provider does not support idempotent deduplication: a worker process could lose power in the microsecond *after* the TCP socket flushes the request to the provider, but *before* the worker writes `status = 'succeeded'` to MongoDB.

### 1.2 What Our Platform Genuinely Guarantees
We implement **At-Least-Once Execution with Three-Layer Idempotent Deduplication**, which achieves **Effectively-Once Delivery** whenever the downstream provider honors `Idempotency-Key` headers (such as SendGrid, Postmark, or our Mock Notification Provider):

1. **Layer 1 — API Campaign Creation Idempotency (`Idempotency-Key` Header)**:
   - Enforced by a **unique compound partial index** in MongoDB: `{ tenantId: 1, idempotencyKey: 1 }`.
   - If a client retries `POST /api/campaigns` due to a network timeout, the API returns the existing campaign (`200 OK`, `X-Idempotent-Replay: true`) without duplicating the campaign or re-enqueueing jobs.
2. **Layer 2 — Deterministic `deliveryId` & MongoDB Uniqueness Constraints**:
   - Every `(campaignId, channel, normalizedRecipient)` tuple maps to a deterministic SHA-256 identifier:
     $$\text{deliveryId} = \text{del\_} + \text{SHA256}(\text{campaignId} : \text{channel} : \text{normalizedRecipient})[0..40]$$
   - MongoDB enforces a **unique index** on `{ deliveryId: 1 }` and a **unique compound index** on `{ campaignId: 1, recipient: 1 }`.
   - BullMQ jobs use deterministic `jobId = delivery_<deliveryId>` so duplicate jobs for the same delivery cannot be queued concurrently.
3. **Layer 3 — Provider-Side Idempotency-Key Deduplication**:
   - Every call from the worker to the Notification Provider passes `idempotencyKey: deliveryId`.
   - The provider atomically records `SET provider:idemp:<deliveryId> <receiptJson> EX 86400 NX` in Redis.

### 1.3 What Happens If the Provider Succeeds but the Worker Crashes Before Persisting Success?
1. **Worker #1** atomically claims `deliveryId` in MongoDB (`status: 'queued' -> 'processing'`, `lastAttemptAt = now`) and increments `campaign.stats.queued: -1, campaign.stats.processing: +1`.
2. **Worker #1** calls `provider.send({ idempotencyKey: deliveryId, ... })`. The provider dispatches the notification and stores `provider:idemp:<deliveryId> = msg_abc123` in Redis.
3. **CRASH**: Worker #1 crashes (`SIGKILL` / OOM / host reboot) *before* updating MongoDB to `status: 'succeeded'`.
4. **Recovery**:
   - After BullMQ's stall lock expires (`stalledInterval`) and `lastAttemptAt` exceeds the stale processing cutoff (`15s`), **Worker #2** picks up the stalled job.
   - Worker #2 atomically claims the stale `processing` record (`{ deliveryId, status: 'processing', lastAttemptAt: { $lte: staleCutoff } }`). Because `priorDelivery.status` was already `'processing'`, Worker #2 **does not** increment `campaign.stats.processing` a second time.
   - Worker #2 calls `provider.send({ idempotencyKey: deliveryId })`.
   - The provider finds `provider:idemp:<deliveryId>` in Redis, **does NOT send a second external message**, and returns `{ success: true, providerMessageId: 'msg_abc123', deduplicated: true }`.
   - Worker #2 atomically transitions `status: 'processing' -> 'succeeded'` and updates `campaign.stats.processing: -1, campaign.stats.succeeded: +1`.

---

## 2. Concurrency Control & Zero-Drift Campaign Counters (Modules 4C & 5)

### Why Atomic Database Operations Instead of Custom Distributed Locks?
Custom distributed locks (e.g. naive Redis `SETNX` locks) introduce failure modes around clock drift, lock expiration during GC pauses, and orphaned locks on process crashes. Instead, we use **MongoDB document-level atomic Compare-And-Swap (`findOneAndUpdate`)** operations:

- **Atomic Delivery Claiming**:
  ```ts
  const priorDelivery = await DeliveryModel.findOneAndUpdate(
    {
      deliveryId: data.deliveryId,
      $or: [
        { status: 'queued' },
        { status: 'processing', lastAttemptAt: { $lte: staleProcessingCutoff } },
      ],
    },
    { $set: { status: 'processing', lastAttemptAt: new Date(), jobId } },
    { new: false }
  );
  ```
  If 10 concurrent workers race on the same `deliveryId`, MongoDB serializes the document update so **exactly 1 worker** receives `priorDelivery !== null`, and the other 9 workers receive `null` and exit immediately (`already_processed`).

- **Preventing Double-Counting Across Retries**:
  - When `queued -> processing`: `$inc: { 'stats.queued': -1, 'stats.processing': 1 }`.
  - When a **transient error** occurs (`attempt < maxAttempts`): the delivery atomically transitions `processing -> queued` (`$inc: { 'stats.processing': -1, 'stats.queued': 1 }`) while waiting for BullMQ's exponential backoff timer (`1s, 2s, 4s, 8s`).
  - Only when a delivery enters a true terminal state (`succeeded` or `failed`) does `stats.succeeded` or `stats.failed` increment by `1`.
  - **Invariant preserved at all times**:
    $$\text{total} = \text{queued} + \text{processing} + \text{succeeded} + \text{failed} + \text{skipped}$$

---

## 3. Recovery After Worker Restart & Temporary Redis/MongoDB Outages (Module 5)

1. **Graceful Worker Shutdown (`SIGTERM` / `SIGINT`)**:
   - The worker process intercepts `SIGTERM` and `SIGINT`, stops accepting new jobs, waits for in-flight BullMQ jobs to complete via `await Promise.all([dispatchWorker.close(), deliveryWorker.close()])`, deletes its Redis heartbeat key, and cleanly closes Redis and MongoDB connections.
2. **Temporary Redis Outage**:
   - `ioredis` connections use exponential reconnect backoff (`Math.min(times * 200, 5000)` ms) and `maxRetriesPerRequest: null` for BullMQ workers.
   - During a temporary Redis blip, API caching and rate limiting degrade gracefully to in-memory fallback buckets rather than throwing `500 Internal Server Error` to HTTP clients.
3. **Temporary MongoDB Outage**:
   - Mongoose maintains a connection pool (`maxPoolSize: 25`) with automatic reconnection and surfaces live connection state on `GET /api/health`. If a worker attempt fails due to a transient database disconnect, BullMQ retries the job with exponential backoff once MongoDB reconnects.

---

## 4. Architecture Trade-offs, Bottlenecks & Future Improvements

| Area | Current Design & Trade-off | Bottleneck at 1M+ Scale | Future Production Improvement |
| :--- | :--- | :--- | :--- |
| **Recipient Upload** | Parses CSV/JSON in memory (`multer.memoryStorage`, up to 25MB) and bulk-inserts in chunks of 1,000. Simple and fast up to ~100k rows. | Uploading a 500MB CSV (5M+ rows) in a single HTTP request would spike API memory. | Stream CSV directly from S3 / multipart upload stream using Node `Readable` streams + MongoDB `bulkWrite` cursor pipelines. |
| **Campaign Counter Updates** | Atomic `$inc` on the `Campaign` document per delivery transition guarantees real-time accuracy. | At >5,000 deliveries/sec for a *single* campaign, hot-document write contention on one `Campaign` document in MongoDB. | Buffer counter deltas in Redis (`HINCRBY campaign:stats:<id> succeeded 1`) and flush to MongoDB every 500ms. |
| **Queue Granularity** | Dispatcher chunks `queued` deliveries (`BATCH_SIZE = 250`) into BullMQ via `addBulk`. Gives per-recipient exponential backoff and dead-letter visibility. | Millions of individual BullMQ job keys in Redis consume ~1–2GB of Redis RAM. | Use Redis Streams or Kafka partitioned by `campaignId` with consumer-group batch commits for multi-million recipient campaigns. |
| **Multi-Tenancy & Auth** | Tenant isolation via `X-Tenant-ID` header with versioned Redis cache keys. | No JWT/OAuth signature verification on `X-Tenant-ID`. | Add OAuth2/JWT middleware + per-tenant BullMQ rate-limited queues (fair-share scheduling across tenants). |
