# Legacy cleanup candidates

This inventory records the cleanup outcome and the work intentionally left for
a later compatibility migration.

## Removed in Phase 6

- direct GameTrack SQLite runtime and permission probe;
- provider-specific sync/preview command registrations;
- direct-database settings field and translations.

## Still required

- `src/sync/service.ts` and the legacy `SyncService` for compatibility callers;
- `src/model/provider.ts` and legacy `ProviderGame`/`ProviderSnapshot` types for
  state readers and platform client boundaries;
- Steam and PlayStation library adapters;
- existing credentials, connection modals, state readers and migrations;
- legacy regression coverage;
- existing achievement rendering and Bases compatibility.

## Migration-only

- `libraryProvider` compatibility for installations without an explicit
  provider;
- preservation of `steam-id` and PlayStation identifier properties while a
  GameTrack note is adopted;
- canonical mapping conversion from legacy property destinations.

## Compatibility-only

- the transitional `GameProvider` alias in
  `src/model/canonical-provider.ts`;
- legacy provider snapshot/state conversion used by old installations.

## Unknown / requires evidence

- whether direct Steam and PlayStation library modes can be replaced by
  enrichers without losing useful membership or freshness behavior;
- whether the legacy achievement block should be replaced by a canonical
  detail projection;
- whether provider-specific Bases views remain needed after all users move to
  canonical properties.

Removal of the retained compatibility layer requires a separate migration plan,
rollback path, regression tests and explicit confirmation that existing
settings, history, match management and notes remain readable.
