# Library providers and enrichers

Phase 5 separates library membership from optional platform data.

```text
LibraryProvider
  -> complete CanonicalLibrarySnapshot
  -> optional GameEnricher patches
  -> canonical matcher/planner/writer
```

## Contracts

`LibraryProvider` is the source of the canonical list of games. The existing
`GameProvider` name remains a transitional type alias. A provider must return a
`complete`, `partial` or `failed` snapshot; only a complete library snapshot
can reach the writer.

`GameEnricher` receives a complete canonical snapshot and returns source-tagged
patches for existing `canonicalKey` values. It cannot create library members.
Unmatched Steam or PlayStation games become diagnostics only.

The implementation lives in `src/model/enrichment.ts`, with platform-specific
adapters in `src/providers/steam/enricher.ts` and
`src/providers/playstation/enricher.ts`. Both reuse the existing API/auth
boundaries; they do not call the legacy `fetchLibrary()` path.

## Authority and provenance

| Domain | Authority |
| --- | --- |
| Library membership and GameTrack/IGDB identity | selected library provider, normally GameTrack |
| Aggregate playtime | GameTrack when trustworthy |
| Steam activity and achievements | Steam enricher |
| PlayStation activity and trophies | PlayStation enricher |
| User status, rating, review, notes and custom properties | Obsidian |

Playtime observations, activity values and achievement summaries retain their
source. Direct Steam/PlayStation summaries can be projected when reliable, but
full detail is kept in the canonical model and is not written to frontmatter
by default.

## Failure semantics

An incomplete or failed library snapshot produces zero writes. An optional
enricher may be `success`, `partial` or `failed`; its failure does not cancel a
complete base-library preview. It also does not erase previously written
`last-played` or achievement values. The planner protects those domains while
the source is unavailable.

## Freshness and scheduling

Manual GameTrack ZIP import is the only operation that changes library
membership. After a successful manual preview, the runtime caches the complete
base snapshot for the current export. A background run with enabled enrichers
uses that snapshot and does not silently re-import a stale ZIP. Steam and
PlayStation library-only modes retain their existing scheduler behavior.

The current source fingerprint and enricher result fingerprints participate in
preview invalidation. Manual and scheduled operations share the same canonical
service and writer boundary.

## Configuration

The UI exposes this as `Library source` and `Additional data`. The settings
flags `steamEnricherEnabled` and `playstationEnricherEnabled` are separate from
legacy `enabledProviders`, so enabling an account does not silently authorize
additional enrichment requests.

Xbox and RetroAchievements remain future extension points. No direct Xbox
enricher or automatic discovery of games outside the selected library is
implemented.

## Legacy compatibility

Steam and PlayStation remain valid library providers for existing users. Their
legacy `SyncService`, state, credentials and settings are intentionally kept;
only the new optional enrichment path uses the canonical contracts.
