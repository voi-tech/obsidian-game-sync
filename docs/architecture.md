# Game Sync architecture

Game Sync has two sync paths that share the vault gateway, the matcher, the
state store and the scheduler:

```text
GameTrack ZIP (LibraryProvider)
  -> CanonicalSnapshot
  -> optional GameEnricher patches (Steam, PlayStation)
  -> matcher
  -> CanonicalSyncPlan
  -> CanonicalVaultWriter

Steam and PlayStation accounts (GameProviderAdapter)
  -> ProviderSnapshot per account
  -> SyncPlanner (merges both platforms into one game)
  -> matcher
  -> SyncPlan
  -> SyncExecutor + VaultWriter (managed achievement block)
```

The second path is the direct Steam and PlayStation sync. It is the default
and stays permanent: it merges both platforms into one note per game, keeps
the match manager, unmerge, history, ignored games and the achievement block.
Moving it onto the canonical path would rebuild those features without a user
benefit, so it is not planned.

## Library sources

GameTrack uses the official, user-selected ZIP export. It is manual and
read-only. Direct SQLite access is not part of the standard runtime. It
produces `CanonicalGame` values and does not own matching, planning, filenames
or Markdown writing.

Steam and PlayStation are read through their platform clients
(`src/providers/steam`, `src/providers/playstation`). The same clients power
the direct sync and the optional GameTrack enrichers.

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

`libraryProvider: gametrack` selects the canonical path. Any other value,
including `steam`, `playstation` or no value, uses the direct Steam and
PlayStation sync for every connected, enabled account. The scheduler consumes
only `SyncExecutor` and shares one concurrency guard with manual operations.
An executor can expose the neutral `canRunAutomatically()` capability; the
scheduler does not inspect provider IDs or transport details. GameTrack ZIP
imports are manual; platform enrichers may refresh independently when
configured.

Both paths decide note identity with the same matcher
(`src/vault/matcher.ts`) and write state through atomic `StateStore.update()`
calls. A note that cannot be written safely skips only its own operation.

## Mobile boundary

The canonical model, ZIP transport and platform-independent sync code are
mobile-safe. SQLite, private GameTrack container access and native desktop
runtime code are not imported by the normal release composition.
