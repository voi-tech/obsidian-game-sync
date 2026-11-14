# Provider migration

## Library source migration

Game Sync keeps the library source as an explicit, optional setting:

```text
libraryProvider: gametrack | steam | playstation
```

Only `gametrack` selects the canonical path. `steam`, `playstation` and an
empty value all use the direct Steam and PlayStation sync, which reads every
connected, enabled account. Older installations may have `steam` or
`playstation` stored after a migration; the value is kept and means the direct
sync. Selecting GameTrack is an explicit user action; it does not remove
credentials, state, history or existing mappings.

## GameTrack selection

GameTrack is presented as one public library provider. It uses an official
user-selected ZIP export, not live SQLite access. New users can choose it
during setup; existing users remain on their current provider until they make
an explicit change. GameTrack is described as a manual export flow, not as
automatic sync.

The selected export filename and, when available, reusable local path are
stored for the next preview. The path is never copied into diagnostics. If the
file is missing, the UI asks the user to choose an export again. Direct SQLite
configuration from development builds is not used by the production GameTrack
path and is not exposed in normal settings.

## Commands and snapshot safety

The primary commands are `Sync games` and `Preview sync`. They route through
the selected source. GameTrack first creates a canonical preview; a partial or
failed snapshot is displayed as an error and cannot reach the writer. A source
change invalidates preview approval. The manual export provider is excluded
from background scheduling.

## Rollback and compatibility

Changing the library source from GameTrack back to the direct sync is
non-destructive. Credentials and state remain available. Existing notes are
matched by stable identifiers and custom/user-managed properties are
preserved by both writers. There is no global frontmatter migration.

## Decision on the direct sync

The direct Steam and PlayStation sync is permanent (decision 2026-11-14). It
is not migrated to the canonical path: that would have to rebuild platform
merging, the match manager, unmerge and the achievement block for no user
benefit. Automatic Backup, filesystem watching, telemetry and automatic
provider migration are out of scope.
