# Provider migration

## Library source migration

Game Sync keeps the library source as an explicit, optional setting:

```text
libraryProvider: gametrack | steam | playstation
```

Existing unambiguous Steam-only or PlayStation-only settings are read as the
corresponding canonical library source. Ambiguous combined legacy settings
remain on the compatibility path until the user chooses a source. Selecting
GameTrack is an explicit user action; it does not remove credentials, legacy
state, history or existing mappings.

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

Changing `libraryProvider` back to Steam or PlayStation is non-destructive.
Legacy credentials and state remain available. Existing notes are matched by
stable identifiers and custom/user-managed properties are preserved by the
canonical writer. No global frontmatter migration or legacy cleanup is part of
Phase 4B.

## Next phase boundary

Legacy Steam/PlayStation paths remain in this release. Automatic Backup,
filesystem watching, telemetry, automatic provider migration and full legacy
cleanup are deliberately excluded. A later cleanup phase must first compare
the value of direct providers as optional enrichers against the GameTrack
export path.
