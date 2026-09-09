# Hosted USER management

`ADMIN_USERNAME` and `ADMIN_PASSWORD_SCRYPT` remain the environment-backed root/bootstrap administrator. Hosted USER accounts are cloud-managed in `public.hosted_users`; their Scrypt hashes are available only to the trusted BFF service-role client and never to browsers.

Usernames are trimmed, normalized to lowercase, and must match `^[a-z0-9][a-z0-9._-]{2,63}$`. Matching is therefore case-insensitive. Reserved names and bootstrap/legacy environment usernames cannot be created as managed users.

ADMIN can create USER accounts, enable/disable them, and replace a password. Disable and reset increment `session_version`; a managed session is checked against the current enabled/version state on every authenticated BFF request, so it is invalid on the next request. There is no hard delete, administrator creation, permission editor, password display, session viewer, or impersonation feature in B4: `USER_DELETE = DEFERRED`.

`USER_USERNAME`/`USER_PASSWORD_SCRYPT` remains a temporary compatibility login only. Managed accounts are checked before that legacy account. Operator tokens, agent credentials, enrollment tokens, and Local Agent DPAPI credentials are independent and never part of managed-user authentication.
