-- The audit trail is append-only and its integrity checks may truncate or rebuild it in tests, so no
-- other table holds a foreign key into it: a notice keeps the audit entry's id as a plain number.
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_auditLogId_fkey";
