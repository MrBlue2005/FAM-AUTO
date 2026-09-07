# Supabase/Postgres control plane

## Scope

Phase 3 implements the Protocol v1 control plane without moving the dashboard, property data, media, Chromium profiles, or Facebook sessions. Local Agent remains outbound-only and `LOCAL` transport remains the default. Supabase credentials are server-side Edge Function secrets; they never enter the agent or browser.

## Schema and migrations

Migrations live in `supabase/migrations/` and create `agents`, `agent_credentials`, `agent_enrollment_tokens`, `profiles`, `tasks`, `task_events`, and `idempotency_requests`.

The immutable local `agent_id`/`profile_id` values remain primary identities. Credentials store bcrypt-compatible pgcrypto `crypt()` hashes, never raw secrets. Enrollment tokens are SHA-256 hashes, single-use, and expire within 24 hours. Task payloads are immutable JSON snapshots and profile sync rejects browser/session-shaped fields.

The task state machine is Protocol v1: `QUEUED → CLAIMED → RUNNING → COMPLETED|FAILED|CANCELLED|OUTCOME_UNKNOWN`. `OUTCOME_UNKNOWN` is terminal until an explicit operator resolution.

## Atomic claims, leases, and idempotency

`rx_cp_claim_task` reconciles expired leases, selects due tasks using `FOR UPDATE SKIP LOCKED`, takes a transaction-scoped advisory lock for the physical profile, and persists the claim/lease/audit event before returning the snapshot. A partial unique index on `tasks(profile_id)` where status is `CLAIMED` or `RUNNING` is the database-level same-profile invariant.

`CLAIMED` lease expiry requeues only work that has not begun. `RUNNING` lease expiry becomes `OUTCOME_UNKNOWN`; it is never auto-requeued. Lease operations validate the authenticated agent, task ID, and lease ID.

`idempotency_requests` has a unique `(agent_id, request_id)` key. SQL wrappers execute mutation and response persistence in the same transaction. A retry with the same operation/fingerprint returns the stored response; reuse with a different request hash or operation fails with `IDEMPOTENCY_KEY_CONFLICT`. Retention is seven days; `rx_cp_purge_idempotency()` is safe to run by scheduled maintenance.

## Edge Function API

Deploy `supabase/functions/agent-protocol`. It uses `SUPABASE_SERVICE_ROLE_KEY` only inside the Edge runtime, validates Bearer credentials through `rx_cp_authenticate_agent`, and invokes the transactional RPCs. It preserves `/v1/...` endpoint shapes consumed by `HttpAgentTransport`.

Operator endpoints require `RX_OPERATOR_API_TOKEN` in the Edge runtime and are never exposed to the Local Agent: issue enrollment token, inspect a task, request cancellation, and resolve an `OUTCOME_UNKNOWN` task as `MARK_AS_COMPLETED`, `MARK_AS_FAILED`, or explicitly `REQUEUE`.

## Credential lifecycle and Windows storage

The agent creates its secret locally and submits it only during one-time enrollment using an operator-issued token. The database records only its verifier. Rotation stages a new secret in the local credential file first, registers it with the control plane, then commits locally. The prior credential remains valid for a configured overlap window (minimum 60 seconds), so a crash cannot lock out the agent before the protected copy exists.

On Windows, `LocalAgentCredentials` protects the credential with CurrentUser DPAPI via PowerShell/.NET; legacy Phase 2 plaintext records migrate only after protected storage writes successfully. On non-Windows development hosts, the fallback is explicitly file-permission based and is not equivalent to DPAPI.

## RLS and security boundary

RLS is enabled on every control-plane table and `anon`/`authenticated` roles receive no table or function privileges. The browser and Local Agent do not use direct database credentials. Service-role Edge Functions are the trusted policy boundary. Audit metadata contains IDs, state transitions, and safe operational facts only—not descriptions, full media URLs, headers, cookies, profile paths, or secrets.

## Local development

1. Install Supabase CLI and Docker, then run `supabase start`.
2. Apply migrations with `supabase db reset`.
3. Set Edge secrets locally: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `RX_OPERATOR_API_TOKEN`.
4. Run `supabase functions serve agent-protocol --no-verify-jwt`.
5. Create a short-lived operator enrollment token through the operator endpoint.
6. Set `RX_AGENT_TRANSPORT_MODE=HTTP`, `RX_AGENT_CLOUD_URL` to the function URL, and use the token for one-time enrollment.
7. Run `npm run agent:http` with `publishEnabled: false`; use fake task/executor workflow for protocol testing, not Facebook publishing.

`npm run supabase:dev` resets a local Supabase database and serves the Edge Function; it requires Supabase CLI and Docker. The ordinary test suite includes SQL/Edge contract checks but does not require Supabase or production credentials.

## Deployment and rollback

Apply migrations in order, deploy the Edge Function, set secrets in the Supabase project, then enroll agents explicitly. Roll back by leaving agents in `LOCAL` mode and disabling the Edge Function route; do not delete profiles, credentials, or task history. Schema migrations are additive; data reversal should be an operator-reviewed migration, never an automated client action.
