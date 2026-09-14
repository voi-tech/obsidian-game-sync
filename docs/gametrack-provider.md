# GameTrack provider

The production GameTrack provider uses the official ZIP/CSV export. Direct
SQLite is not included in the standard runtime; its rejected transport and
schema findings remain historical research only.

```text
user-selected GameTrack ZIP
  -> in-memory ZIP reader
  -> manifest and CSV validation
  -> GameTrack CSV intermediate rows
  -> GameTrack normalizer
  -> CanonicalGame[]
```

The provider id is `gametrack`. Steam, PlayStation, Xbox and other platforms remain data attached to a GameTrack game; they are not separate Game Sync providers.

## Runtime requirements

The first production implementation targets a user-selected official export.
ZIP parsing is pure JavaScript and reads entries in memory; it does not require
native addons, shell commands, Full Disk Access or access to the GameTrack
container. The desktop path may remember the selected file path when the
embedded runtime exposes one. If it cannot, the user chooses the export again.

The provider is exposed through an opt-in canonical composition boundary and is
manual (`automaticSync: false`). It can run wherever the normal file picker
and ZIP APIs are available, while live GameTrack database access remains
unsupported on every platform.

## Schema validation

The export validator requires `manifest.json`, `games.csv` and the stable core
headers `uuid`, `igdb_id`, `title`, `platforms` and `hours_played`. It produces
a signature from the required header set and manifest format. Missing required
files/columns or invalid identity stops the snapshot before planning writes;
unknown optional files and columns are ignored.

The library query is static and returns one JSON-shaped row per game, including platform playtime, activity dates, achievement summaries and genres. The data query is a single short-lived read, so the provider does not hold a connection open across the Obsidian lifecycle.

## Identity

`games.uuid` is serialized as the GameTrack external id and is the provider
canonical key (`gametrack:<lowercase hex>`). `games.igdb_id` is exposed as the
numeric IGDB id. The canonical matcher indexes IGDB and GameTrack IDs before
falling back to legacy platform IDs or title review.

## Normalization

GameTrack-specific columns and transformable values are confined to `src/providers/gametrack/`. The normalizer produces a neutral `CanonicalGame` with metadata, normalized platform ids, ownership hints, activity, achievement summaries, playtime observations and provenance.

The CSV transport does not decode Core Data transformables. Core Data
transformable decoding was removed with the rejected SQLite transport.

## Playtime semantics

All normalized values are minutes. The GameTrack aggregate is read from hours and wins as the canonical scalar, including zero. If the aggregate is missing, one valid platform observation may be used; multiple observations remain per-source data without a synthesized scalar. Aggregate/platform disagreement is retained as an anomaly and is never corrected heuristically.

## Achievements

Only summary values with an explicit reliable total are emitted with a completion percentage. Partial snapshots do not become zeroes, and no total is inferred from an unavailable catalogue. Individual achievement records are not yet part of the canonical output.

## Dry-run and write boundary

Phase 3 uses `CanonicalGame` directly in a neutral planner and writer. The
planner performs matching and returns a create/update/unchanged/conflict plan;
the writer updates only provider-managed properties and preserves user/custom
properties and the note body. Partial or failed provider snapshots cannot be
written. The existing legacy service and provider composition remain available
for regression compatibility.

When enabled in Additional settings, Steam and PlayStation can enrich existing
GameTrack games before canonical planning. They never add games to the
library. A failed optional enrichment leaves the complete GameTrack library
usable and preserves previously written activity/achievement values.

## User flow and snapshot safety

The normal flow is:

```text
export from GameTrack -> choose ZIP -> Preview sync -> Sync
```

The source fingerprint is checked before and after parsing. A source that
disappears or changes during read produces a failed snapshot and zero vault
writes. Replacing the export invalidates the previous preview approval.
GameTrack status/rating/notes are available in the export but are not projected
by default because Obsidian owns those user-managed fields.

## Known limitations

- The official export is manual; there is no live or background GameTrack import.
- Automatic Backups are not implemented because their ordinary-directory path,
  stable format and atomicity were not confirmed.
- Achievement detail is not imported into the primary note; only reliable
  summaries are eligible.
- Direct SQLite requires private-container access and is not part of the
  shipped provider runtime. Its schema is private and can change without
  notice.
- Steam and PlayStation library sources use the same canonical pipeline as
  GameTrack; their legacy state readers remain only for compatibility.

## Background execution boundary

Manual preview and execution use the same provider-neutral `SyncExecutor`
contract. The scheduler does not treat the manual GameTrack export as a live
source and does not silently re-import a stale selected file. Legacy providers
retain their existing background behavior. GameTrack itself is not re-imported
by the scheduler; an enabled platform enricher may refresh data against the
last successfully imported GameTrack snapshot.
