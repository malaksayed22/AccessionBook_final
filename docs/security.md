# Security model

How Accession Book authenticates people, limits abuse and protects data in transit and at rest. Written for
developers, for the customer's security review, and as the starting point of the OWASP ASVS L2 checklist (P7).

## Sessions

- **Opaque and database-backed.** The browser holds a random 256-bit token. The `Session` table stores only its
  SHA-256, so a leaked database or backup cannot be replayed as logins. Nothing about the user is in the cookie.
- **Cookie:** `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` whenever `APP_URL` is https. Over https the name carries the
  `__Host-` prefix (browsers then refuse it unless it is Secure, host-only and path `/`).
- **Lifetime:** ends after `SESSION_IDLE_MINUTES` (30) without activity or `SESSION_ABSOLUTE_HOURS` (12) after
  sign-in, whichever is first. `lastSeenAt` is refreshed at most once a minute.
- **Rotation:** every sign-in issues a new token and revokes the one presented. Enabling MFA revokes every other session
  of the account.
- **Revocation:** sign-out, password change (all other sessions), deactivation, MFA reset by an admin, MFA enabled,
  and "end this session" in the profile page. Revoked rows are kept 30 days for investigations (`purgeDeadSessions`).
- **States:** `active`, `mfa-required` (password accepted, code pending) and `mfa-enrolment-required` (the role demands
  MFA and none is set up). Only the sign-in and MFA endpoints accept a non-active session
  (`withApi({ allowIncompleteSession: true })`); every page and every other endpoint treats it as signed out.
- **Pages:** the proxy only checks that a cookie is present. Every server component that reads data must call
  `requirePageUser()`; the `(app)` layout also does. Forged or expired cookies are redirected to `/login`.

## Passwords

- **Argon2id**, 19 MiB, 2 passes, 1 lane (OWASP minimum). Parameters live in the hash; `passwordNeedsRehash` upgrades
  hashes on the next successful sign-in.
- **Policy:** 12 to 256 characters, must not contain the username, small deny-list of common passwords, no trivially
  repetitive strings. No composition rules (NIST 800-63B). A breached-password lookup is deliberately not used: it would
  send data to a third party; revisit in P7 with an offline list.
- **No default or shared passwords exist.** Accounts are created by invitation; the invitee chooses the password.
- Changing a password requires the current one and ends all other sessions.

## Abuse limits (PostgreSQL fixed-window counters, shared by every instance)

| What                     | Limit                  | Notes                                                       |
| ------------------------ | ---------------------- | ----------------------------------------------------------- |
| Sign-in attempts per IP  | 30 / 15 min            | counts every attempt                                        |
| Failed sign-ins per name | 5 / 15 min then locked | keyed on the typed name, so unknown names lock the same way |
| MFA code failures        | 5 / 15 min per account | applies to authenticator and recovery codes                 |
| Password confirmations   | 5 failures / 15 min    | profile changes and re-authentication                       |
| Invitation link guesses  | 20 / 15 min per IP     |                                                             |

Responses are identical for wrong password, unknown user and deactivated user, and an unknown user still costs one
Argon2 verification (timing equalisation). A locked account answers `429` with `Retry-After`. The client address is the
`X-Forwarded-For` entry added by our own proxy, counted from the right (`TRUSTED_PROXY_HOPS`, ALB = 1); earlier
entries are client-controlled and never believed.

## Two-step verification (TOTP)

- RFC 6238 (SHA-1, 6 digits, 30 s, one step of drift). Secrets are encrypted at rest with AES-256-GCM
  (`MFA_ENCRYPTION_KEY`, 32 random bytes, mandatory in production, held in Secrets Manager).
- A code is single use: the accepted time step is stored and an equal or older step is refused, atomically.
- 10 recovery codes (about 59 bits each), stored as hashes, single use, regenerated with a current code.
- **Mandatory for administrators** where `REQUIRE_ADMIN_MFA` (default on in production). An admin without MFA gets a
  session that can only complete setup. Admins cannot turn it off. Members may enable and disable it themselves.
- Lost device and codes: another admin resets it (`PATCH /api/members/:id {action:"reset-mfa"}`), which ends the
  member's sessions and is audited. There is no self-service bypass.

## Re-authentication

With `REQUIRE_REAUTH` (default on in production) destroying a unit, releasing a hold, deactivating a member and
resetting MFA need a password confirmation within `REAUTH_WINDOW_MINUTES` (10). A fresh sign-in counts. Endpoints answer
`403 REAUTH_REQUIRED`; `POST /api/auth/reauth {password}` renews it. The confirmation dialog in the UI is part of P5;
until then the flag stays off outside production.

## Request integrity

- Every handler goes through `withApi`: same-origin check on mutating requests, bounded JSON (size cap per route),
  strict zod schemas, uniform error bodies without internals, request id on every response.
- `next=` redirects after sign-in are restricted to same-site paths (`lib/safe-redirect.ts`).
- State-changing endpoints are not reachable cross-site: `SameSite=Lax` plus the Origin check.

## Headers and CSP (`server/security-headers.ts`, applied in `proxy.ts` to every response)

Nonce-based CSP with `strict-dynamic`; no `unsafe-inline` or `unsafe-eval` in `script-src` in production;
`style-src-attr 'unsafe-inline'` only (inline `style=""` attributes cannot run script); `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri` and `form-action` `'self'`; HSTS (2 years, preload) when https; `nosniff`;
`X-Frame-Options: DENY`; `Referrer-Policy` (`no-referrer` on `/invite/`); a locked-down `Permissions-Policy`;
COOP/CORP `same-origin`. Covered by unit tests and a Playwright spec that fails on any CSP violation.

Overlays (Radix) inject a `<style>` element for scroll locking; `NonceBridge` passes the request nonce to that library, so
`style-src-elem` stays nonce-only. This only shows up in a production build (development allows inline styles), so after
changing overlay code run a production build and check the console for CSP violations.

## Files

Private storage only: disk in development, S3 (SSE-KMS, no public access, write-once keys) in production. Type and size
are validated by content. Downloads go through an authenticated route as attachments with `nosniff`. See
`docs/storage.md` for the bucket contract.

## Audit of authentication events

Sign-in, failure (existing accounts), lockout, sign-out, invitation acceptance, MFA setup/enable/disable/failure/lockout/
recovery-code use, password change, re-authentication, session revocation and admin MFA reset are written to the
hash-chained audit log with request id, address and user agent. Failed attempts against names that do not exist are
rate limited and logged operationally but not written to the regulated audit log (an attacker could otherwise grow it).

## Known limits and what comes next

- Authorization of reads by experiment membership is still the P2 policy set; the full ASVS V4 review is in P7.
- Account recovery by email (SES) arrives with P6; until then an admin issues a new invitation link.
- WebAuthn/passkeys are a candidate second factor for P7.
- The audit chain detects tampering inside history, not truncation of its tail; an external anchor is planned for P6.
