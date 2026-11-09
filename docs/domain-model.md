# Domain model (schema v3)

This replaces the legacy "state chain" (UnitState + PlantState/FlowerState/SeedLotState/Store/
StateRecord/Destroyed/SentTo/ReceivedFrom/Manipulation + LocationTransfer + StageTransition).
The legacy design copied side tables forward inconsistently, derived "current state" in four
places by loading whole tables, consumed the mother's state when cloning (so a second clone
failed), and let shipments ignore inventory.

## Core idea: one immutable event table, one pointer

A **unit** (`BiologicalUnit`) is an identity: a plant, seed lot, flower or culture with a name,
cultivar, experiment, lineage and provenance. Everything that _happens_ to it is a row in
`UnitState`: an immutable, numbered snapshot ("what was true from this event on"). The unit holds
`currentStateId`, a pointer to its newest state, maintained in the same transaction that writes the
state. "Current state" is therefore a primary-key lookup, never a derivation.

```
BiologicalUnit 1 ─── n UnitState (sequence 1..n, immutable)
      │  currentStateId ─────────────► UnitState (the latest)
      ├── sourceParentUnitId ────────► BiologicalUnit   (lineage; the only lineage source)
      ├── n UnitHold                                    (quality hold history)
      ├── n LabTest · QualityIncident · UnitActivity · UnitAttachment
      └── ShipmentItem.stateId ──────► UnitState        (shipping/receiving is an inventory event)
```

### UnitState

| Field                         | Meaning                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `sequence`                    | 1, 2, 3 … per unit; `(unitId, sequence)` is unique. Order is by recording, not by date.                         |
| `kind`                        | `CREATED` · `RECEIVED` · `MOVED` · `STAGE_CHANGED` · `MEASURED` · `SHIPPED` · `DESTROYED`                       |
| `effectiveAt`                 | When it really happened (operator-supplied, may be back-dated, never future, never before the unit's creation). |
| `recordedAt` / `recordedById` | When and by whom it was filed (system-assigned). Replaces `StateRecord`.                                        |
| `locationId`                  | Where the unit is. Carried forward on every event; changed by `MOVED`.                                          |
| `growthStage`                 | Plants and flowers. Carried forward; changed by `STAGE_CHANGED`.                                                |
| `humidWeight`, `dryWeight`    | `Decimal(12,3)` grams. Carried forward; changed by `MEASURED` / harvest.                                        |
| `seedCount`                   | Seed lots. Carried forward; changed by `MEASURED`.                                                              |
| `organizationId`              | Counterparty for `RECEIVED` / `SHIPPED`.                                                                        |
| `scanConfirmed`               | A `MOVED` event confirmed by a barcode scan.                                                                    |
| `reason`, `witnessId`         | Required for `DESTROYED` (reason + a witness who is not the actor).                                             |
| `parentStateId`               | On `CREATED` of a derived unit: the parent's state at the moment of derivation.                                 |

Rules enforced by the database: `UnitState` rows can never be updated or deleted; weights and counts
are non-negative; `DESTROYED` requires a reason; one active hold per unit.

`SHIPPED` and `DESTROYED` are **terminal**: no further events (the unit has left inventory). A unit is
_active_ iff its current state is not terminal.

### Derivation (clone, cutting, subculture)

Deriving creates a **new unit** with `sourceParentUnitId` and a `CREATED` state whose `parentStateId`
points at the parent's current state. **The parent is unchanged and stays active**, so a mother plant
can be cut any number of times, and a batch of N is one transaction. A parent on hold cannot be
derived from (legacy rule, kept).

### Unit status

A unit has exactly one status, derived from its newest event and its open hold: **Active** (here, free,
no open hold), **On hold** (an open hold), **Shipped** or **Destroyed**. Shipped and destroyed units
are terminal. There is no "in inventory" status and no quarantine: a quarantine is simply a hold.
"Inventory" names the module and the CTLS returns, not a status. Figures that count units not yet
shipped or destroyed (experiment, cultivar and report totals) include held units.

### Holds

`UnitHold` keeps the whole history (who placed it, why, origin manual or auto-incident, who
released it and when). A unit is on hold iff it has a row with `releasedAt IS NULL`. A hold blocks
`MOVED`, `STAGE_CHANGED`, derivation, `SHIPPED` and `DESTROYED`. It does **not** block lab tests,
incidents, activities, attachments or the release itself. A lab result never places a hold; only a
person, or a critical incident, does.

### Shipments are inventory events

An outbound shipment moving `DRAFT → IN_TRANSIT` writes a `SHIPPED` state for every item that
references a unit, in the same transaction (and refuses units that are on hold or already gone).
Cancelling is only possible from `DRAFT`. Inbound receipts record counterparty and quantities; the
received material is registered as units with provenance. Items without a unit (bulk weight lines)
are ledger records only.

### Derived histories

`LocationTransfer` and `StageTransition` no longer exist. Transfer history is the `MOVED` events
(from-location = previous state's location); stage history is the `STAGE_CHANGED` events; stage
durations are computed from consecutive events. One source of truth, always consistent.

## Reporting definitions

- **Active inventory at time T**: units whose latest state with `effectiveAt <= T` is non-terminal.
- **CTLS additions in a period**: `CREATED` and `RECEIVED` events with `effectiveAt` in the period.
- **CTLS reductions in a period**: `SHIPPED` and `DESTROYED` events with `effectiveAt` in the period.
- Period boundaries use the laboratory time zone, not the server's.

## Audit

Every service writes its audit entry in the same transaction as the change
(`logMemberActivity(user, entry, tx)`); the database chains and seals it (see the integrity
migration). Reasons are mandatory for destruction, hold release and voiding.
