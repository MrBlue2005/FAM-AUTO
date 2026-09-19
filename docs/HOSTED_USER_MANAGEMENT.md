# Hosted USER management

`ADMIN_USERNAME` and `ADMIN_PASSWORD_SCRYPT` remain the environment-backed root/bootstrap administrator. Hosted USER accounts are cloud-managed in `public.hosted_users`; their Scrypt hashes are available only to the trusted BFF service-role client and never to browsers.

Usernames are trimmed, normalized to lowercase, and must match `^[a-z0-9][a-z0-9._-]{2,63}$`. Matching is therefore case-insensitive. Reserved names and bootstrap/legacy environment usernames cannot be created as managed users.

ADMIN can create USER accounts, enable/disable them, and replace a password. Disable and reset increment `session_version`; a managed session is checked against the current enabled/version state on every authenticated BFF request, so it is invalid on the next request. There is no hard delete, administrator creation, permission editor, password display, session viewer, or impersonation feature in B4: `USER_DELETE = DEFERRED`.

`USER_USERNAME`/`USER_PASSWORD_SCRYPT` remains a temporary compatibility login only. Managed accounts are checked before that legacy account. Operator tokens, agent credentials, enrollment tokens, and Local Agent DPAPI credentials are independent and never part of managed-user authentication.

## Dedicated QA Preview browser

Hosted Preview validation uses a separate Playwright persistent browser context, never the operator's normal Chrome profile or a Facebook automation profile. Its local-only data lives at `app/data/qa-preview-browser/` (or below the configured `RX_DATA_PATH`) and is Git-ignored. The existing local profile lock manager permits only one owner at a time.

Run `npm run qa:auth` to open the exact Preview in a headed browser. Complete Vercel Authentication, when requested, and enter the existing `qa_user_b4` credentials only in that browser UI. The tool polls the authoritative `/api/auth/status` endpoint, requires the exact managed username, performs only same-origin `GET` requests for visible campaigns, the safe target, assignments, and active work, then closes normally. Vercel protection is not disabled or bypassed by application code.

Run `npm run qa:session:verify` to reopen the same persistent profile headlessly and repeat the authoritative identity and hosted read-only checks. An absent or expired application session fails as `QA_SESSION_EXPIRED`; a different signed-in user fails as `QA_IDENTITY_MISMATCH`. No password, cookie, authorization header, or storage state is exported or logged.

Normal close preserves the persistent browser directory. Intentional removal is separate and explicit: `npm run qa:session:reset -- --confirm-reset`. Reset acquires the same exclusive lock and removes only the dedicated QA profile; it is never performed automatically.
