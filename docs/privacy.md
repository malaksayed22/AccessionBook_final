# Privacy and personal information

Accession Book holds very little personal information, and it is deliberately limited to what accountability
requires. This document records what is held, why, for how long, and how the obligations of PIPEDA and Quebec's
Law 25 are met. It is a working record for the customer's privacy officer, not legal advice; confirm the retention
periods below with the customer's QA lead and counsel before go-live.

## What personal information exists

| Data                                          | Where                         | Why                                                    |
| --------------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| Username, e-mail, role, initials              | `User`                        | sign-in, invitations, attributing records to a person  |
| Password hash (Argon2id)                      | `User.passwordHash`           | sign-in; never reversible, never logged                |
| TOTP secret (encrypted), recovery-code hashes | `User`, `MfaRecoveryCode`     | two-step verification                                  |
| Sign-in time, IP address, browser             | `Session`, `AuditLog`         | security, investigation of misuse                      |
| Who did what and when                         | `AuditLog`, `UnitState`, etc. | regulatory record of custody; Health Canada inspection |

No health, financial or government identifiers are collected. Cookies: one strictly necessary session cookie; no
analytics, advertising or third-party cookies.

## Principles applied

- **Minimisation:** e-mail is visible to administrators only; the member list shows names and roles.
- **Purpose limitation:** personal data is used for access control and accountability, nothing else.
- **Security safeguards:** see `docs/security.md` (encryption in transit and at rest, MFA, rate limiting, audit).
- **Accountability:** every access-control change and every regulated action names the person responsible.
- **Residency:** AWS `ca-central-1` only (database, files, backups, logs).

## Retention

| Data                            | Keep                                                                                                                                             | Then                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Regulated records and audit log | the period set by the customer's licence and Health Canada requirements (assumed at least 2 years after the end of the activity; **to confirm**) | review, then archive               |
| Dead sessions                   | 30 days                                                                                                                                          | deleted by `purgeDeadSessions`     |
| Rate-limit counters             | until their window ends                                                                                                                          | deleted by `purgeExpiredBuckets`   |
| Application logs                | 90 days (set in P6 on the log group)                                                                                                             | expire                             |
| Deactivated accounts            | as long as the records they authored exist                                                                                                       | pseudonymise on request, see below |

## Individual rights

- **Access:** an administrator exports everything held about a person: profile row, their sessions, and the audit
  entries naming them (`SELECT` on `User`, `Session`, `AuditLog` by `userId`). A self-service export page is planned for P5.
- **Correction:** members correct their own username, initials and password on the profile page; administrators
  correct e-mail and role. Every change is audited.
- **Erasure and the regulated record.** Records that name a person are part of the compliance trail and must not be
  deleted or rewritten, and the audit chain makes silent edits detectable. Instead, on a valid request the account is
  deactivated and **pseudonymised**: e-mail, password hash, MFA material and sessions are removed, and the display
  name in the live `User` row is replaced by a stable pseudonym ("Former member 0042"). The regulated entries keep
  the historical name as written at the time, because altering them would falsify the record; the customer's privacy
  officer decides, per request, whether that exemption applies. The workflow is a documented admin procedure today
  and becomes an admin action in P5.
- **Complaints / questions:** the customer designates a privacy officer; the contact is shown on the sign-in page (P5).

## Incidents

A breach register is kept by the customer (template: date found, what, whose data, risk of serious harm assessment,
who was told, fix). Law 25 and PIPEDA require notifying the regulator and affected people where there is a real risk
of significant harm. The audit log, request ids and session records are the investigation material; `Session` rows
show which devices accessed an account and `revokeUserSessions` ends them all at once.

## Open items

1. Confirm retention periods with the customer's QA lead and counsel (regulated records, logs).
2. Build the pseudonymise-member action and the self-service export (P5).
3. Publish a privacy notice (English and French) linked from the sign-in page (P4/P5).
4. Document sub-processors: AWS (hosting), and the e-mail provider chosen in P6.
