# RX Agent Protocol v1

## Scope and transport

Protocol v1 is the outbound-only contract between RX Local Agent and the future Cloud Control Plane. Every message includes `protocol_version: 1` and `X-RX-Agent-Protocol: 1`. Production URLs must use HTTPS. Plain HTTP is rejected by the client except when `RX_AGENT_REFERENCE_ALLOW_HTTP=true` is explicitly set for the localhost reference backend.

The agent initiates all requests. The cloud never opens a connection to the Windows PC. Chromium paths, cookies, session storage, IndexedDB, credentials, browser tokens, and profile contents are prohibited fields and are rejected by the reference control plane.

## Enrollment and authentication

The local registry owns the public `agent_id`. `LocalAgentCredentials` creates a random 256-bit `agent_secret` once and stores it in ignored local application data with owner-only file permissions where supported. It is never returned by APIs, included in dashboard code, task DTOs, diagnostics, or logs.

Enrollment is a one-time `POST /v1/agents/enroll` using `Authorization: Bearer <agent_secret>`, `agent_id`, and an optional out-of-band enrollment token. The server stores only an scrypt hash plus salt. Later agent requests use the same Bearer secret and `X-RX-Agent-Id`. Secret comparison is constant-time after hashing.

## Safe heartbeat and profile sync

`POST /v1/agent/heartbeat` carries `agent_id` through authenticated headers and a body containing safe display/version/state metadata:

```json
{
  "protocol_version": 1,
  "display_name": "RX Agent - WORKSTATION",
  "agent_version": "1.1.3",
  "agent_status": "ONLINE",
  "profiles": [{ "profile_id": "profile_…", "display_name": "Profil principal", "status": "READY" }],
  "active_task_ids": []
}
```

The control plane writes `last_seen_at`. It computes an agent as `OFFLINE` once the configurable heartbeat expiry is exceeded; no clean shutdown is required. A profile can be created or renamed only by its owning agent. A profile ID already owned by another agent is rejected.

## Task claim and leases

`POST /v1/agent/tasks/claim` is pull-only and atomically selects at most one due `QUEUED` task assigned to the authenticated agent with a profile owned by that agent. It also refuses a claim if that profile already has a `CLAIMED` or `RUNNING` task.

The response contains a full immutable task snapshot and an opaque `lease_id`. Lease-scoped operations require `X-RX-Lease-Id` and validate agent, task, and lease together:

- `POST /v1/agent/tasks/:id/running`
- `POST /v1/agent/tasks/:id/renew`
- `POST /v1/agent/tasks/:id/completed`
- `POST /v1/agent/tasks/:id/failed`
- `POST /v1/agent/tasks/:id/outcome-unknown`
- `POST /v1/agent/tasks/:id/cancelled`
- `GET /v1/agent/tasks/:id/cancellation`

Renewals extend a configurable expiry. `CloudAgentService` renews while the Facebook executor is active and can attach safe progress metadata. An expired `CLAIMED` lease returns to `QUEUED` (or `CANCELLED` if cancellation was requested). An expired `RUNNING` lease becomes terminal `OUTCOME_UNKNOWN`, never an automatic repost candidate.

## State machine and cancellation

```text
QUEUED -> CLAIMED -> RUNNING -> COMPLETED | FAILED | CANCELLED | OUTCOME_UNKNOWN
   |         |          |
   +------> CANCELLED <-- cancellation requested, honored at a safe point
CLAIMED --lease expiry--> QUEUED
RUNNING --lease expiry--> OUTCOME_UNKNOWN
```

Illegal transitions are rejected. Cancelling a queued task is immediate. Cancelling claimed/running work sets `cancellation_requested_at`; the agent polls at safe points and never kills Chromium during a critical posting action.

`OUTCOME_UNKNOWN` means a Facebook side effect may have happened but the control plane cannot prove it. It requires operator investigation; the system must not repost blindly.

## Idempotency and retries

Every mutating agent request has `X-RX-Request-Id`. The server stores the first response by agent/request ID and returns that response on a retry, so a dropped response cannot duplicate a claim or transition. A stale lease cannot complete a task after a newer claim. Control-plane idempotency does not make a Facebook browser click idempotent.

The client uses bounded exponential retry timing with jitter through `AgentConnectionManager`; failures do not crash the agent or alter Chromium state. Heartbeats resume after connectivity returns and emit safe `HEARTBEAT_FAILED` / `AGENT_RECONNECTED` diagnostics.

## Reference backend and local modes

`npm run reference-cloud` starts the test/reference control plane only on `127.0.0.1:3400`; it is never started by Studio. `npm run agent:http` requires `RX_AGENT_TRANSPORT_MODE=HTTP`, a cloud URL, and explicit enrollment. Default behavior remains Phase 1 `LOCAL` transport.

The reference backend persists agents, profiles, tasks, leases, and safe audit events when `RX_REFERENCE_CLOUD_DATA` is configured. It intentionally has no dashboard integration and is a protocol validation target, not production hosting.

## Supabase production implementation

Phase 3 implements these same semantics in Postgres migrations and the `agent-protocol` Supabase Edge Function. The HTTP routes remain Protocol v1 compatible, so `HttpAgentTransport` needs no agent-facing redesign. Atomic claim, same-profile enforcement, lease expiry, state transitions, and idempotency are database transactions rather than single-process JSON operations. See `docs/SUPABASE_CONTROL_PLANE.md`.
