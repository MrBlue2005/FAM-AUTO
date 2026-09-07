# RX AI Studio cloud/local architecture

## Scope

Phase 1 prepares the existing local application for a later cloud control plane. It does not add cloud networking, Supabase, R2, inbound control ports, or a hosted dashboard. Facebook publishing remains controlled by the existing `publishEnabled` safety setting and defaults to `false`.

## Current architecture discovered

The React dashboard calls the Express API in `server/server.js`. Queue plans are derived from local JSON properties, jobs, groups, runtime configuration, and history. Manual and scheduled starts converge on `RobotManager.start`. `RobotManager` validates preflight, records a campaign run, and starts a separate `index.js` Node worker. That worker uses Playwright and the existing `campaignRunner`/Facebook modules with a persistent Chromium user-data directory.

The application already permits separate workers for different configured Facebook profiles. Before Phase 1, the only same-profile guard was the API process's in-memory `activeRobots` map, keyed by the configurable dashboard profile ID. The worker also reread campaign and group records before each queued item, including mutable post content.

## Phase 1 architecture

```text
Dashboard -> existing Express API -> RobotManager
                                      |
                                      v
                            immutable task snapshots
                                      |
                                      v
                            LocalTaskTransport (JSON)
                                      |
                                      v
                             RX Local Agent worker
                                      |
                                      v
                       existing campaignRunner / Playwright
```

`AgentTransport` defines the future boundary for registration, heartbeat, safe profile publication, claiming, acknowledgement, running state, completion, and failure. `LocalTaskTransport` implements that contract with local, ignored JSON state so the present offline workflow remains executable. No external service is required.

## Identity and profile adoption

The local registry is stored in ignored operational state at `app/data/localAgentRegistry.json` (or under `RX_DATA_PATH`). It creates one permanent `agent_...` ID per installation.

Each existing configured Chromium profile is adopted without copying, moving, renaming, opening, or modifying its directory. Adoption resolves its current local path, assigns a permanent `profile_...` ID once, and records the old runtime profile ID as a compatibility alias. Repeated starts reuse the same mapping. A display-name edit updates only `displayName`; it never changes `profile_id`. Multiple legacy aliases pointing to the same physical directory resolve to one immutable profile identity.

The current API and dashboard continue using legacy aliases such as `main` and `jobs`. Internal tasks and locks use the immutable profile ID. The local registry alone resolves that identity to the persistent Chromium directory.

## Trust boundary

The cloud-safe metadata DTO contains only:

```json
{
  "agent_id": "agent_...",
  "display_name": "RX Agent - PC",
  "status": "ONLINE",
  "profiles": [
    { "profile_id": "profile_...", "display_name": "Profil principal", "status": "READY" }
  ]
}
```

It never contains profile paths, cookies, browser storage, Facebook credentials, passwords, cache, IndexedDB, or session tokens. The local API exposes this safe DTO through the already-authenticated `/api/local-agent` route; no new listener or unauthenticated endpoint is introduced.

## Task lifecycle and immutable execution data

Internal tasks use `QUEUED -> CLAIMED -> RUNNING -> COMPLETED|FAILED|CANCELLED`. Each task records `task_id`, `agent_id`, immutable `profile_id`, type, lifecycle timestamps, attempts, payload, result, and structured error.

At run creation, each Facebook task snapshots the selected campaign/post descriptions, media references, target group, campaign day, posting identity reference, selected runtime profile alias, and execution configuration. Chromium paths and session data are excluded. The worker may still recheck local queue eligibility and history before execution, but once it runs a task it uses the saved campaign/group payload. Editing a property or group later cannot change content already claimed for that run. Media bytes are not duplicated; only their references are captured.

## Profile lock invariant

One physical Facebook profile may execute at most one Local Agent workload at a time.

Defense in depth is provided by:

1. `RobotManager` queue/dispatcher locking, keyed by immutable `profile_id` rather than display name or runtime alias.
2. `ProfileLockManager` executor locking through an exclusive local lock file held for the complete Playwright worker session.

The executor releases the lock in `finally` on success, handled failure, exception, or cancellation/process shutdown. A duplicate executor returns the machine-readable `PROFILE_BUSY` reason. If a process crashes and leaves a lock, a later acquisition verifies the recorded PID and safely removes a lock whose owner is confirmed dead; fresh or unreadable locks are not reclaimed eagerly.

Different immutable profile IDs keep the existing cross-profile concurrency behavior. Phase 1 adds no more aggressive parallelism.

## Backward compatibility and migration

- Existing dashboard routes, API contracts, scheduler entry points, `RobotManager`, and Facebook automation modules remain in place.
- Existing operational campaign/property data schemas are unchanged.
- Existing Chromium directories are used in place and are never migrated physically.
- Runtime profile aliases remain accepted by dashboard controls, reports, schedules, pause/resume, and stop APIs.
- Installer and continuous updater behavior is unchanged. The existing updater already preserves JSON under `app/data/`, while Git ignores the registry, task transport files, locks, logs, profiles, uploads, and secrets.
- Real publishing is not enabled by this phase.

## Final target architecture

In a later phase, a cloud HTTP implementation of `AgentTransport` can replace or accompany `LocalTaskTransport`. The hosted control plane will own authentication, property/campaign metadata, object-storage references, task scheduling, safe agent/profile metadata, and execution history. The Windows Local Agent will initiate outbound authenticated connections, claim tasks for its profiles, download temporary media, enforce local locks, and invoke the unchanged Facebook robot.

The mapping from immutable `profile_id` to Chromium user-data directory, all Facebook session material, local execution locks, and browser diagnostics remain local permanently.

## Phase 2 recommendation

Define and threat-model an authenticated outbound HTTPS transport before choosing database tables. Add task leases/idempotency, heartbeat expiry, retry policy, cancellation semantics, signed media download URLs, and versioned DTO validation. Build a mock HTTP contract test against the current `AgentTransport` boundary before integrating Supabase or moving the dashboard.
