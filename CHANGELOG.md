# Changelog

## 26.11.0 (BRAT prerelease)

- Added an import of PlayStation purchases: a console script copies the Sony transaction history (without payment or address data) and the import writes purchase date, price and currency to existing game notes. Writes check that the note was not edited after the preview, a missing price or currency keeps existing values, refunds are matched by time, transaction, SKU and amount (ambiguous refunds are reported, not guessed), and an incomplete export is not copied.
- Reworked the sync preview: sections ordered from least to most effort, bulk and per-section selection, "Decide later" that skips only the current sync, and colliding library entries combined into one game. Progress notices while preparing and applying.
- Settings and ignored games no longer revert when a preview or the setup wizard was open while they changed (three-way merge on save).
- Stable identifiers of one game that point to different notes now require a decision instead of updating the first note found. Property names that differ only in case (`Title`, `title`) are treated as one property.
- One malformed note becomes a conflict for that game instead of stopping the whole sync. Achievement blocks follow CommonMark code fence rules, so marker examples inside code blocks are never replaced.
- Match manager actions (unmerge, resolve, allow matching) wait for a running sync. In GameTrack imports, a note edited after the preview is skipped and reported while the rest is written.
- Steam: requests are retried after 429, 502, 503, 504 and network errors (honouring Retry-After up to 30 s); an incomplete library or failed achievement response is reported as partial; achievements use the stable `apiname` ID.
- PlayStation: a temporary token refresh failure keeps the stored session instead of disconnecting.
- Trophy counters count only earned trophies. Title matching in enrichers handles Unicode and trademark signs.
- Library filters (unplayed, free-to-play, no longer owned) now decide which games get new notes; games that already have a note keep syncing. Settings without effect (metadata language, history, demos and betas) are hidden. "Open Games.base" creates the base on first use.
- main.js shrank from 1.06 MB to 0.70 MB. Tooling: eslint-plugin-obsidianmd 0.5, CI on Node 20, 24 and 26.
- Verified with 640 automated tests and CI. Not yet verified in Obsidian with real Steam or PlayStation accounts.

## 26.10.3 (BRAT prerelease)

- Rebuilt settings on the declarative Obsidian 1.13 settings API: native groups, native sub-pages instead of the Additional settings modal, folder and file pickers, and Game Sync entries in the Obsidian settings search. Versions older than 1.13 are not supported.
- Turned template keys into a grouped sub-page indexed by the Obsidian settings search. Clicking a key copies a ready-to-paste snippet (lists use `join`, achievements and trophies use partials).
- Fixed `{{join list}}` without an explicit separator, which joined items with the Handlebars options object instead of `, `.
- PlayStation library requests now use 200-title pages (Sony rejects larger pages) and always query the signed-in account as `me`. Suspected cause of PSN sync failing after connection; not yet verified against a real account.
- PSN transport failures now carry a sanitized code (HTTP status, timeout, network, oversized or invalid response). Sync warnings and the diagnostic report show the last attempt's status, game count and error code.

## 26.10.2 (BRAT prerelease)

- Fixed an Obsidian crash when starting PlayStation sign-in from Settings. Obsidian 1.14 shows Settings in a separate window, and an embedded browser there terminates Electron's main process. Game Sync now never creates the sign-in browser outside the main window: it closes Settings and continues sign-in in the main window. Reproduced and verified in Obsidian 1.14.4 with an identical crash signature before the fix.

## 26.10.1 (BRAT prerelease)

- Replaced browser-fetch PSN requests with a scoped desktop HTTPS transport for authorization, refresh, library and trophy endpoints.
- Added isolated browser sign-in with a Finish connecting action, keeping code copying behind an advanced fallback.
- Guarded session reads against navigation races and distinguished credential commit from account-settings save failures.
- Unified URL-safe session-code validation, closed streaming redirect/error responses and allowed account-settings retries without reauthentication.
- Added real local-server transport tests and a synthetic native-auth/library check inside Obsidian 1.14.4. Authenticated Sony login and MFA remain unverified.

## 26.10.0 (BRAT prerelease)

- Made preview fingerprint validation and YAML updates atomic, preserving comments, nested properties, string identifiers, empty lists and Markdown body bytes.
- Blocked every game involved in a shared-note identity collision and invalidated canonical previews after configuration changes or runtime shutdown.
- Prevented stale PlayStation authentication responses from restoring a disconnected session; coalesced concurrent refreshes.
- Removed redundant full-vault reads when building the note index and updated the development source-map dependency.
- Marked the release desktop-only to match its Node/Electron export flow and embedded bundled dependency license notices.
- Hardened background-write approval, scheduler shutdown and setup lifecycle safeguards, with regression tests.

Known test scope: anonymous GameTrack desktop import/update passed in Obsidian 1.14.4. Authenticated Steam/PSN, other desktop platforms and the minimum application version still require end-to-end testing before a stable release.

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
