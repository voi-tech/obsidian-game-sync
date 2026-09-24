# Changelog

## 26.9.1

- Added game-level and attribute-level preview selection, including stable-identity safeguards for new notes.
- Made new-note templates part of the frozen preview so applied notes use exactly the content that was reviewed.
- Hardened canonical matching and provider-specific property projection while protecting user-owned attributes.
- Bounded memory use when reading GameTrack ZIP exports.
- Streamlined settings and documented the full template catalog, match manager, protected attributes and local release checks in English and Polish.

## 26.9.0

Initial public release of Game Sync:

- GameTrack library import from the official ZIP export, including multi-platform membership, stable IGDB/GameTrack identity, playtime, platform ownership and reliable achievement summaries.
- Steam and PlayStation as library sources, with optional Steam activity/achievement and PlayStation activity/trophy enrichment.
- Provider-neutral canonical synchronization with stable matching, collision-safe note paths and preservation of user-managed and custom data.
- Preview before synchronization, write blocking for partial or failed snapshots, idempotent updates and automatic target-folder creation.
- Local processing without telemetry, Full Disk Access or access to GameTrack's private database; source exports remain read-only.
- English and Polish interface, setup flow, settings, diagnostics, library summary and ignored-games management.

Known limitations:

- GameTrack imports are manual; Automatic Backup is not supported.
- Steam and PlayStation enrichment have limited runtime end-to-end verification in this release.
- There is no direct Xbox provider.
- Detailed achievement presentation remains limited to the supported summary projection.

Not included: provider write-back, purchase-history import, extra providers, custom backend and multi-account vaults.
