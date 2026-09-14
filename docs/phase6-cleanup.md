# Phase 6 cleanup report

## Removed

- direct GameTrack SQLite runtime from the standard composition;
- GameTrack database discovery, schema reader, native `sqlite3` runner and
  macOS permission probe;
- the development command that selected a private GameTrack database folder;
- provider-specific `Sync Steam`, `Sync PlayStation` and provider-specific
  preview commands;
- obsolete SQLite/Core Data research tests and their anonymous SQLite fixture;
- obsolete GameTrack database settings and translations from the runtime
  settings model/UI.

## Files removed from the implementation

- `src/providers/gametrack/desktop.ts`
- `src/providers/gametrack/runtime.ts`
- `src/providers/gametrack/permission-probe.ts`
- `src/providers/gametrack/gametrack-provider.ts`
- `src/providers/gametrack/gametrack-database.ts`
- `src/providers/gametrack/gametrack-schema.ts`
- `src/providers/gametrack/gametrack-path.ts`
- `src/providers/gametrack/sqlite-reader.ts`
- `src/providers/gametrack/sqlite-process-runner.ts`
- `src/providers/gametrack/transformable.ts`
- the SQLite spike helpers under `src/providers/gametrack/spike/`
- `tests/gametrack-technical-spike.test.ts`
- `tests/gametrack-permission-probe.test.ts`
- `tests/gametrack-provider-phase2.test.ts`
- `tests/fixtures/gametrack/technical-spike.sql`

## Retained

- `SteamAdapter` and `PlayStationAdapter` as the shared platform clients;
- `SteamLibraryProvider` and `PlayStationLibraryProvider`, both ending at
  `CanonicalGame`;
- Steam and PlayStation enrichers;
- legacy `SyncService`, `ProviderGame`/`ProviderSnapshot` models and legacy
  writer/planner for compatibility-only paths used by match management,
  history/state readers and ambiguous old combined configurations;
- legacy credentials, connection modals, Bases support and regression tests.

## Migration compatibility retained

- An unambiguous old Steam-only or PlayStation-only configuration is read as
  the corresponding `libraryProvider`.
- An old experimental `gametrackDatabasePath` is accepted while reading old
  settings but is not returned or persisted; the user must choose an official
  GameTrack export.
- Existing note identity, legacy IDs, custom properties and user-managed
  values remain preserved.
- Legacy state is read for compatibility; new selected library syncs use the
  canonical executor.
- The scheduler has no provider branching. An executor may expose the neutral
  `canRunAutomatically()` capability; the GameTrack composition returns false
  for a manual ZIP-only source and true when an optional enrichment is enabled.

## Compatibility-only / unknown

The remaining `SyncService` path is not a second production library engine
for explicitly selected Steam, PlayStation or GameTrack sources. It remains
because match-manager and legacy state APIs still use its responsibilities.
Removing it requires a separate state/history and match-management migration.

The final representation of detailed achievement blocks and provider-specific
Bases views remains outside this cleanup and is deliberately unchanged.

## Dependency and bundle impact

No native SQLite dependency was present in `package.json`. The standard build
no longer imports the SQLite/permission modules or their development probe.
The current `main.js` build is 871,001 bytes; the repository `HEAD` artifact is
764,638 bytes, but that comparison includes the earlier GameTrack and
canonical-pipeline work already present in the dirty worktree and is not an
isolated Phase 6 delta. Mobile bundle validation remains the release guard.

## Test impact

SQLite/Core Data probe tests were removed with the rejected transport. Canonical
provider, composition, migration, command and regression coverage remains;
new coverage verifies Steam/PlayStation canonical selection, neutral scheduler
automatic-run capability and old database configuration removal. The final
suite has 71 test files with 438 passing tests and one intentionally skipped
real-export test unless its opt-in fixture path is supplied.

## Future cleanup candidates

- remove the remaining compatibility `SyncService` after match-manager,
  history and legacy-state consumers have canonical replacements;
- remove legacy provider-specific snapshot caches after state migration;
- decide whether detailed achievements and Bases projections need a canonical
  projection, without expanding this cleanup into a feature.
