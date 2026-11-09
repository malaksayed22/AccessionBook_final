> **Status: the importer described below has been rewritten (phase P2).** `npm run db:import -- --actor <admin> --dump <file.sql>`
> is now **non-destructive and idempotent** (it matches on natural keys, never truncates, and a re-run changes nothing),
> imports members as pending invitations (no passwords), translates each legacy state chain into immutable
> events, audits every batch, and refuses `NODE_ENV=production` without `--allow-production`. Add `--dry-run` to
> see what would be imported and which legacy values cannot be carried over. `npm run migrate:validate` checks the
> result (and reconciles against the dump with `--dump`). Column names for `SentTo`, `StateRecords` and the
> hold fields are assumptions to confirm against the real export. Read the rest of this file as the business
> plan; where a command conflicts with this note, this note wins.

# Migrating legacy Cannabase → Accession Book

This is the working plan for moving production data out of the legacy Cannabase
database and into this application. It is written to be executed by one engineer
with a second person witnessing the cutover, which is also what the destruction
and inventory record-keeping duties expect.

## 1. Where the data comes from

The legacy system exports a MySQL-style SQL dump. `scripts/import-cannabase.ts`
parses it with `scripts/sql-parser.ts` and writes into the Prisma schema.

Two properties of the current importer matter a great deal:

- **It is destructive.** `clearDatabase()` truncates 18 tables before loading.
  It is a _reload_, not an incremental sync. Never point it at a database that
  has accumulated post-migration operator input unless you intend to lose it.
- **It does not clear the new tables.** `AuditLog`, `StageTransition`,
  `UnitAttachment`, `UnitActivity`, `LocationTransfer`, `Shipment` and
  `ShipmentItem` are not in its truncation list. After a reload these will hold
  rows whose `unitId` no longer resolves, because unit ids are re-issued from
  the dump. **This must be fixed before the production migration** — see
  §5, task M1.

## 2. Entity mapping

| Legacy concept                      | Target model                                              | Notes                                                         |
| ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| User                                | `User`                                                    | id preserved; password set to a default that must be rotated  |
| Strain / variety                    | `Cultivar`                                                | matched by unique `name`                                      |
| Experiment                          | `Experiment`                                              | `ecode` unique; parent/sub links resolved in a second pass    |
| Plant / seed lot / flower / culture | `BiologicalUnit` + type marker table                      | one of `Plant`/`SeedLot`/`Flower`/`Culture`                   |
| State chain                         | `UnitState` (+ `PlantState`/`FlowerState`/`SeedLotState`) | the current state is the newest non-destroyed, non-parent row |
| Room                                | `Location`                                                | via `Store` on each state                                     |
| Partner                             | `Organization`                                            | `licenceNumber` is **new** and will be blank after import     |
| Cutting / subculture                | `Manipulation`                                            | parent state → child state                                    |
| Destruction                         | `Destroyed`                                               |                                                               |

### Fields with no legacy source

These are new in this application and will be empty after a migration. They are
listed here because several are compliance-relevant and need a backfill plan:

| Field                             | Impact                                              | Backfill                                                          |
| --------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `Organization.licenceNumber`      | **Critical** — s.224 transfer records               | manual, from licence files                                        |
| `Shipment` / `ShipmentItem`       | receiving & shipping ledger                         | manual entry of open movements only                               |
| `LocationTransfer`                | location history is empty until units move          | accept gap; history starts at cutover                             |
| `StageTransition`                 | stage day-counters read zero until first transition | accept gap; optionally seed one row per unit at its current stage |
| `BiologicalUnit.sourceType`       | s.222 lawful source                                 | derive where possible, else operator review                       |
| `UnitAttachment` / `UnitActivity` | documents and treatments                            | not migrated                                                      |

The stage-duration counters and the location timeline are both derived from
event logs that do not exist in the legacy data. Expect them to read "0 days"
and "no location recorded" for pre-existing units on day one. This is honest
behaviour — inventing timestamps would put fabricated data into a regulatory
record — but the lab should be told to expect it.

## 3. Phases

### Phase 0 — Freeze and snapshot

1. Announce a write freeze on the legacy system.
2. Take the final SQL dump.
3. `cp dev.db dev.db.pre-migration-$(date +%F)` — the importer is destructive.
4. Record the dump's checksum in the migration log.

### Phase 1 — Dry run on a scratch database

1. Copy the dump to a scratch working directory.
2. Run the import against a throwaway SQLite file, not the live one.
3. Run `npm run migrate:validate` (see §4) and record every count.
4. Reconcile counts against the legacy system's own totals. Any variance must
   be explained before proceeding — an unexplained variance in unit or
   destruction counts is a hard stop.

### Phase 2 — Gap analysis

1. Open `/overview` (All-Seeing Eye) on the scratch database.
2. Work the compliance findings list top-down. Critical findings —
   unlocated inventory, undocumented destructions, missing counterparty
   licences, post-harvest material with no weight — are the migration's
   punch list.
3. Produce the manual-backfill spreadsheet from those findings.

### Phase 3 — Production cutover

1. Confirm the backup from Phase 0 exists and restores.
2. Run the import against the production database.
3. Re-run `npm run migrate:validate`; compare to the Phase 1 numbers.
4. Rotate every password — the importer sets predictable defaults.
   Use `npm run db:password -- <user> <password> --admin` per account.
5. Set permissions with `npm run db:permissions`.
6. Two people sign the migration log.

### Phase 4 — Backfill and verify

1. Enter `Organization.licenceNumber` for every counterparty.
2. Enter any material movements that were in transit across the cutover.
3. Re-check `/overview` until the critical findings are clear.
4. Generate a CTLS monthly return for the first post-migration month and
   reconcile it by hand against the legacy system's final return.

## 4. Validation

`scripts/validate-migration.ts` (run via `npm run migrate:validate`) checks:

- row counts per model
- units with no current state (orphaned state chains)
- units whose current state has no location
- `Manipulation` rows pointing at missing states
- lineage cycles (`sourceParentUnitId` loops)
- duplicate unit names
- destroyed units that still appear in active inventory
- event-log rows (`StageTransition`, `LocationTransfer`, `UnitActivity`,
  `UnitAttachment`, `ShipmentItem`) referencing unit ids that no longer exist

The last check is the one that catches the reload hazard described in §1.

## 5. Known migration tasks

- **M1 — make the importer safe.** Either add the event-log tables to
  `clearDatabase()`, or (better) change the importer to an idempotent upsert
  keyed on natural keys (`User.name`, `Cultivar.name`, `Experiment.ecode`,
  `BiologicalUnit.name`) so it can be re-run without orphaning history.
- **M2 — stop hardcoding a password (done in P3: no default passwords remain; passwords are Argon2id and chosen via invitation).** `src/lib/password.ts` exports
  `OMAR_PASSWORD` and `defaultPasswordForName()` returns the username. Both are
  fine for a demo seed and unacceptable for production. Replace with generated
  secrets delivered out of band, and force a change on first login.
- **M3 — id allocation is racy.** `User`, `BiologicalUnit`, `Experiment` and
  `UnitState` allocate ids with max+1 rather than autoincrement. Two concurrent
  registrations can collide. Convert to autoincrement, or serialise allocation
  behind a transaction, before multiple operators use the system at once.
- **M4 — optional stage seeding.** Decide whether to write one `StageTransition`
  per migrated unit recording its current stage as of the cutover date. This
  makes the day-counters start ticking immediately at the cost of one synthetic
  row per unit. If done, mark those rows in the comment so they are never
  mistaken for observed events.

## 6. Rollback

The database is a single SQLite file. Rollback is:

```bash
cd ~/cannabase
cp dev.db.pre-migration-<date> dev.db
```

Restart the server afterwards. There is no partial rollback — because the
importer truncates, a failed migration is recovered by restoring the whole file,
which is why Phase 0 step 3 is not optional.
