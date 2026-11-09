-- Roles beyond administrator and member: quality assurance, inventory manager, read-only inspector.
ALTER TYPE "PermissionLevel" ADD VALUE 'QA';
ALTER TYPE "PermissionLevel" ADD VALUE 'INVENTORY';
ALTER TYPE "PermissionLevel" ADD VALUE 'INSPECTOR';
