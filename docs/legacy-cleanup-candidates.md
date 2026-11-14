# Legacy cleanup candidates

This inventory records what was removed and what stays.

## Removed

- Phase 6: direct GameTrack SQLite runtime and permission probe;
  provider-specific sync/preview command registrations; direct-database
  settings field and translations.
- 26.11.3: the unused canonical Steam and PlayStation library providers,
  `canonicalProviderFactories`, the runtime registry that kept unused modules in
  the bundle (and its marker check in `scripts/check-mobile-bundle.mjs`),
  unused re-export modules and a concurrency helper, and the ignored
  `CanonicalVaultWriter` options.

## Permanent

The direct Steam and PlayStation sync is a permanent path, not a
compatibility layer (see `docs/architecture.md`):

- `src/sync/service.ts`, `planner.ts`, `executor.ts` and `src/vault/writer.ts`;
- `src/model/provider.ts` (`ProviderGame`, `ProviderSnapshot`);
- Steam and PlayStation adapters, credentials and connection modals;
- the match manager, unmerge, history and the managed achievement block;
- provider-specific Bases views.

## Migration-only

- reading `libraryProvider: steam | playstation` stored by older migrations;
- preservation of `steam-id` and PlayStation identifier properties while a
  GameTrack note is adopted;
- canonical mapping conversion from legacy property destinations.

## Compatibility-only

- the transitional `GameProvider` alias in
  `src/model/canonical-provider.ts`;
- legacy provider snapshot/state conversion used by old installations.
