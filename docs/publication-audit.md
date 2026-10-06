# Publication audit, 2026-10-06

## Scope and verdict

Game Sync 26.9.1 was audited against Obsidian's community submission requirements and developer policies. The audit started from the existing working changes, not only the last commit. No release, community-directory PR, commit or push was created by this audit.

The local checks and anonymous GameTrack desktop runtime scenarios pass. This is not a claim that authenticated Steam/PlayStation flows or every supported desktop OS have passed end-to-end testing. Complete those checks before a stable release; use BRAT for the next validation build.

## Implemented safeguards

- Fingerprint validation and frontmatter mutation share the same synchronous `Vault.process` callback. A concurrent edit rejects the write.
- YAML parsing uses `yaml` documents instead of a hand-written subset. Invalid YAML, duplicate keys, non-mapping roots, unsupported tags and excessive aliases fail closed.
- Updates preserve unrelated properties, nested values, comments and Markdown body bytes, including BOM/CRLF notes. Anchor changes that would modify an unrelated alias are rejected.
- New notes preserve textual identifiers and empty arrays; custom property names cannot introduce extra YAML structure.
- If multiple games resolve to one existing note, every involved game is a conflict. No arbitrary winner updates that note.
- Canonical previews are tied to their service instance, current settings, property mapping and template content. Runtime shutdown and changed configuration block subsequent operations.
- PlayStation auth is shared per SecretStore across adapters. It invalidates stale connect/refresh responses, coalesces concurrent refreshes, and routes modal connection commits through the same session generation.
- Filename allocation checks occupancy after every fallback, including identifiers that sanitize to the same suffix, for both individual and batch allocation.
- Enumerating Markdown files no longer reads all their bodies. The index computes each fingerprint from the same content it parses, avoiding an extra full-vault read and a mismatched fingerprint.

## Publication decisions

### Desktop-only

`manifest.json` declares `isDesktopOnly: true`. The explicit GameTrack picker uses Electron; export reads use Node filesystem APIs. Delayed imports and a platform guard do not remove the submission requirement. Mobile support is not claimed. The optional mobile-bundle scanner is not a publication gate or proof of mobile compatibility.

### Dependency licenses

The build identifies packages actually included in the bundle from esbuild's metafile. It generates `THIRD_PARTY_NOTICES.md` and embeds their full notices in `main.js`, including MIT, ISC and BSD-3-Clause texts. The standard Obsidian installation remains `main.js`, `manifest.json`, `styles.css`.

### Privacy disclosure

Both READMEs disclose direct Steam/Sony requests and the explicit read of a selected ZIP outside the vault. The file path is persisted locally; exports remain read-only. The plugin does not upload note bodies or add telemetry. The audit did not access production credentials or use production notes as test inputs.

## Verification evidence

### Automated

`npm run check`: lint with zero warnings, TypeScript, Vitest, production build and release validation passed. Final automated result: 562 passed, 1 skipped, 0 failed across 76 test files. The skipped case requires a separately supplied real GameTrack export; anonymous fixtures remain covered.

`git diff --check`: passed.

`npm audit --omit=dev`: 0 reported vulnerabilities.

Full `npm audit`: 3 moderate entries, all caused by Moment 2.29.4 pinned by the Obsidian development SDK, including its transitive presence through the ESLint plugin. Moment is not a Game Sync production import or bundled input. The source-map-js development issue was resolved with 1.2.2. No `npm audit fix --force`, SDK downgrade or constraint-breaking Moment override was used. This does not audit dependencies inside the installed Obsidian application itself.

### Real Obsidian desktop runtime

Environment: macOS, Obsidian 1.14.4, dedicated application profile and dedicated scratch vault. Tests used an anonymous ZIP built from repository fixtures. A test-only onload instrumentation hook exposed the plugin instance for CDP assertions; the hook is not shipped in `main.js`.

Observed results:

- Incomplete fixture with missing IGDB ID: import rejected before writes by the ZIP schema guard.
- Valid four-game ZIP: complete preview, 4 create operations applied, 4 Markdown notes read back.
- Second import: 0 operations.
- Changed export title: one update applied; user body, nested custom property, rating and concurrent user text read back intact.
- Editing a note after preview: old preview rejected; a fresh preview succeeded.
- Changing settings after preview: old preview rejected.
- Final preview after update: 0 operations.

Native export-picker interaction, authenticated provider requests, Windows/Linux, long-running background scheduling and the minimum Obsidian version were not covered by this runtime test.

## Remaining release checklist

- [ ] Run Steam connect, library sync, achievement refresh and disconnect with a consenting test account.
- [ ] Run PSN connect, expired-token refresh, library/trophy sync and disconnect with a consenting test account.
- [ ] Exercise the native GameTrack picker and setup/preview dialogs manually.
- [ ] Verify supported desktop platforms and the declared minimum Obsidian version (1.13.7).
- [ ] Validate a real, explicitly supplied GameTrack export and background sync over a full interval.
- [ ] Review changes, choose a new release version if 26.9.1 already exists remotely, create a release without a `v` tag prefix, and verify the three assets.
- [ ] Submit the community-directory PR, then address automated and human review feedback.

## Authoritative references

- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Plugin guidelines](https://docs.obsidian.md/community-directory/plugin-guidelines)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Submit your plugin](https://docs.obsidian.md/community-directory/submit-your-plugin)
- [Manifest](https://docs.obsidian.md/Reference/Manifest)

See also [runtime verification history](runtime-verification.md). Older results describe their own revisions and do not supersede this audit.
