# Accession Book

Traceability and compliance platform for regulated material: what a unit is, where it came
from, who touched it, what it tested at, and where it went — with a full audit trail on
every action.

> **Status: production rebuild in progress.** See [`docs/rebuild-plan.md`](docs/rebuild-plan.md)
> and [`docs/architecture.md`](docs/architecture.md). "Cannabase" refers only to the legacy
> system the first dataset is migrated from.

## Requirements

- Node.js 22.12+ (developed on 24)
- PostgreSQL 16 — `npm run db:start` (no Docker needed) or `docker compose up -d postgres`

## Development

```bash
npm install
cp .env.example .env
npm run db:start                 # terminal 1: local PostgreSQL 16 (keep open)
npx prisma migrate deploy        # terminal 2: create the schema
npm run db:admin -- --name admin --email you@example.com   # prints a one-time password
npm run db:seed-demo -- --actor you   # optional: a realistic demo lab (passwords in .local/)
npm run dev                      # http://localhost:4000 (port 3000 is left free)
```

| Command              | What it does                                |
| -------------------- | ------------------------------------------- |
| `npm run check`      | lint + typecheck + unit tests               |
| `npm run lint:ci`    | ESLint with the warning ratchet used in CI  |
| `npm test`           | Vitest unit tests                           |
| `npm run test:e2e`   | Playwright end-to-end tests (port 3100)     |
| `npm run build`      | Production build (standalone output)        |
| `npm run audit:deps` | Fail on high/critical dependency advisories |

## Brand

`src/lib/brand.ts` is the only place the product name is written.
