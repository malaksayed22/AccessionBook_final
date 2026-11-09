-- The notification centre. Each row is one notice for one person.
--   kind 'activity':      something was recorded (an audit entry); every active administrator other
--                         than the person who did it is told, by the trigger below.
--   kind 'task_assigned': a task was given to the person (written by the task service).
CREATE TABLE "Notification" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "auditLogId" INTEGER REFERENCES "AuditLog"("id"),
  "taskId" INTEGER REFERENCES "Task"("id") ON DELETE CASCADE,
  "actorName" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "readAt" TIMESTAMPTZ(3)
);
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_auditLogId_idx" ON "Notification"("auditLogId");
CREATE INDEX "Notification_taskId_idx" ON "Notification"("taskId");

-- Administrators hear about every change to the records. Sign-in events (entity 'auth') are left
-- out: they are on the audit trail, and a notice for every sign-in would bury the rest.
CREATE FUNCTION notify_admins_of_activity() RETURNS trigger AS $$
BEGIN
  IF NEW."entityType" <> 'auth' THEN
    INSERT INTO "Notification" ("userId", "kind", "auditLogId", "actorName", "createdAt")
    SELECT u."id", 'activity', NEW."id", NEW."userName", NEW."createdAt"
    FROM "User" u
    WHERE u."permissions" = 'ADMIN' AND u."active" = true
      AND (NEW."userId" IS NULL OR u."id" <> NEW."userId");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_notify_admins AFTER INSERT ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION notify_admins_of_activity();
