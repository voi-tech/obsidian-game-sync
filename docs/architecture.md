# Game Sync architecture

Game Sync has one production sync path for library sources:

```text
LibraryProvider
  -> CanonicalSnapshot
  -> optional GameEnricher patches
  -> matcher
  -> CanonicalSyncPlan
  -> CanonicalVaultWriter
```

## Library providers

`GameTrack`, `Steam` and `PlayStation` are library sources. Each source
produces `CanonicalGame` values and therefore does not own matching, planning,
filenames or Markdown writing.

GameTrack uses the official, user-selected ZIP export. It is manual and
read-only. Direct SQLite access is not part of the standard runtime.

Steam and PlayStation keep their platform clients and can be selected as
standalone library sources. The same clients also power optional enrichers.

## Enrichers

Enrichers receive a complete canonical library snapshot and return patches for
games already present in it. They cannot add library membership. A failed
optional enricher produces diagnostics and does not erase previously projected
values.

Authority is per field: the library provider owns membership and base
identity, GameTrack owns its aggregate activity data when present, platform
enrichers own their activity and achievement details, and Obsidian owns
user-managed properties and note bodies.

## Matching and paths

Matching uses explicit associations, IGDB, GameTrack and legacy platform IDs
before controlled title fallback. Ambiguous matches require review. The
`NotePathAllocator` allocates deterministic paths for new games; an existing
matched note path is always preserved. A filename is never a canonical game
identity.

## Planning and writing

`CanonicalSyncPlan` contains neutral create, update, unchanged, conflict and
skip outcomes. It is calculated before any write. `CanonicalVaultWriter` owns
only the vault projection and creates missing target folders through the vault
gateway. Provider-managed properties may change; user-managed and unknown
properties and the Markdown body remain intact.

## Runtime and state

The runtime composition selects one library provider and builds one canonical
executor. The scheduler consumes only `SyncExecutor` and shares one
concurrency guard with manual operations. An executor can expose the neutral
`canRunAutomatically()` capability; the scheduler does not inspect provider
IDs or transport details. GameTrack ZIP imports are manual; platform
enrichers may refresh independently when configured.

Legacy state readers, the legacy service and legacy provider models remain
only for compatibility with old combined configurations, match management,
history and rollback-sensitive data. Unambiguous old Steam/PlayStation
settings migrate to the corresponding canonical library provider and are no
longer sent through the legacy library sync path.

## Mobile boundary

The canonical model, ZIP transport and platform-independent sync code are
mobile-safe. SQLite, private GameTrack container access and native desktop
runtime code are not imported by the normal release composition.
