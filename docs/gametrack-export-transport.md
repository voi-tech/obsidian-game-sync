# GameTrack export transport — production transport

Status: the official GameTrack ZIP export is the supported production
transport. Direct SQLite remains `experimental`, `unsupported` and is not
shown in the normal user interface.

Probe date: 2026-09-14. Tested application: GameTrack 6.1.5.

## Automatic Backups

GameTrack Settings > Data > Backups exposed:

- `Enable Automatic Backups` — enabled in the observed UI;
- frequency: `Weekly`;
- location: `On This Device`;
- retention: `5` backups;
- a note that older backups are deleted when the limit is reached.

The UI did not expose a confirmed user-selected ordinary directory during the
probe. Before the manual export, the list showed `No backups yet`. Therefore
there is no evidence that Automatic Backups can produce a file in a directory
that an Obsidian Community Plugin can read without access to GameTrack's
private container. Automatic Backup is not selected as the transport.

The settings did not provide enough evidence to establish the exact automatic
backup filename, package location, cadence trigger, overwrite/rotation
algorithm or atomic-write protocol. These remain unverified rather than
assumed.

## Official export package

The observed GameTrack action was Settings > Data > Export Library. The screen
described a backup of games, lists, playthroughs and all data. It completed with
`2,391 items exported successfully` and `207 Games`.

The share item was:

```text
gametrack-export.zip · 763 KB
```

The archive contained 30 entries, including `manifest.json` and separate CSV
files. The manifest reported:

```json
{"appVersion":"6.1.5","exportDate":"2026-09-14T12:38:51Z","version":"1.0"}
```

The package was copied only to a temporary analysis location outside the
repository. It was not committed and was not modified.

The real package was parsed through the prototype with 207/207 games,
207/207 unique GameTrack IDs and 207/207 IGDB IDs. The resulting snapshot was
complete. No raw real-library rows were added to the repository.

The public GameTrack release notes also describe `CSV Export & Import` and
`Automatic Backups` as supported features:
[GameTrack changelog](https://gametrack.app/change-log).

## CSV schema

The package uses comma-delimited UTF-8 CSV. The observed `games.csv` begins
with a plain UTF-8 header, uses LF row endings, double quotes for fields that
contain commas or newlines, and doubled double quotes for embedded quotes.
Empty fields represent missing values. Numeric decimals use `.`. Boolean
values observed in `games.csv` use `false`; platform and genre lists use `|`.

The parser does not rely on column order and ignores unknown additional
columns. Required identity/library headers are:

```text
uuid, igdb_id, title, platforms, hours_played
```

The package's primary files are:

| File | Meaning | production use |
|---|---|---|
| `games.csv` | identity, metadata, platforms, status/rating/user fields, aggregate playtime | required |
| `steam_games.csv` | Steam IDs and minutes | optional playtime observation |
| `playstation_games.csv` | PS title/trophy data and hours | optional playtime/activity/summary |
| `xbox_games.csv` | Xbox IDs, achievement counts and activity | optional activity/summary |
| `steam_achievements.csv` | individual Steam achievement rows | summary derivation |
| `game_trophies.csv` | individual PlayStation trophy rows | detail only; sparse in snapshot |
| `xbox_achievements.csv` | individual Xbox achievement rows | detail only |
| `playthroughs.csv` | session/progress records | not needed for canonical library v1 |
| `game_releases.csv` | per-platform release dates | optional future metadata |
| `game_genres.csv`, `genres.csv` | genre relationships and names | `games.csv` already carries genre labels |

The export had 35 fields in `games.csv`; the fields relevant to canonical
normalization are:

| Column | Type/encoding | Canonical mapping | Required |
|---|---|---|---:|
| `uuid` | UUID text | GameTrack ID; hyphens removed and lowercased to match SQLite `ZID` | yes |
| `igdb_id` | positive integer text | `identity.externalIds.igdb` | no, but strongly preferred |
| `title` | UTF-8 text | `title` | yes |
| `summary` | quoted UTF-8 text | `metadata.summary` | no |
| `developer` | UTF-8 text | `metadata.developers` | no |
| `publisher` | UTF-8 text | `metadata.publishers` | no |
| `poster_url` | URL text | `metadata.cover` | no |
| `release_date` | ISO-8601 text | `metadata.releaseDate` | no |
| `platforms` | `|`-separated text | canonical platform IDs | yes |
| `owned_platform` | platform text | `PlatformPresence.owned` | no |
| `additional_platforms` | `|`-separated text | merged platform presence | no |
| `hours_played` | decimal hours | GameTrack aggregate, converted to minutes | yes |
| `additional_playtime` | decimal hours | retained as source coverage; not added automatically | no |
| `status`, `user_rating`, `notes`, `review` | text/numeric/user fields | deliberately not imported into provider-managed canonical data | no |
| `genres` | `|`-separated labels | `metadata.genres` | no |

User-owned fields are present in the export but remain outside this provider
prototype's canonical provider-managed projection.

## Coverage compared with SQLite

The real export contained 207 games, 207 unique UUIDs and 207 non-empty IGDB
IDs. The UUID bytes matched SQLite `ZID` after removing hyphens and
lowercasing for all 207 games.

| Data | SQLite | Export package | Result |
|---|---|---|---|
| GameTrack ID | `ZID` | `games.uuid` | 207/207 equivalent |
| IGDB ID | `ZGAMEID` | `games.igdb_id` | 207/207 present and equal |
| title | `ZTITLE` | `games.title` | 207/207 equal |
| release date | `ZRELEASEDATE` | `games.release_date` | field present; current values comparable |
| platforms | transformable `ZPLATFORMS` | `games.platforms` | present; export uses readable labels |
| owned platform | `ZOWNEDPLATFORM` | `games.owned_platform` | 202/207 non-empty |
| status | `ZSTATUS` | `games.status` | field present; 135/207 non-empty |
| user rating | `ZUSERRATING` | `games.user_rating` | field present; preserved as user-owned |
| notes/review | `ZNOTES`/`ZREVIEW` | `games.notes`/`games.review` | fields present; not mapped in v1 |
| aggregate playtime | `ZHOURSPLAYED` | `games.hours_played` | 207/207 equal |
| additional playtime | `ZADDITIONALPLAYTIME` | `games.additional_playtime` | 207/207 equal |
| per-platform Steam playtime | `ZPLAYTIMEFOREVER` | `steam_games.playtime_forever` | 134/134 equal, raw unit minutes |
| per-platform PlayStation playtime | `ZPLAYDURATION` | `playstation_games.play_duration` | 97/97 equal, raw unit hours |
| Xbox playtime | no source column | no source column | absent |
| last played | PS/Xbox activity columns | PS/Xbox CSV rows | fields present; not independently batch-compared to UI |
| start/finish date | `ZSTARTDATE`/`ZFINISHDATE` | `games.start_date`/`games.finish_date` | fields present; current sample mostly empty |
| genres | Core Data/join tables | `games.genres` plus join CSVs | present |
| developer/publisher | `ZDEVELOPER`/`ZPUBLISHER` | `games.developer`/`publisher` | present |
| artwork | poster/artwork transformables | `poster_url`/`banner_url` | cover/banner present |
| achievement summary | platform tables | platform CSV rows | available per linked platform |
| detailed achievements | achievement/trophy tables | 1,152 Steam, 58 PS, 225 Xbox rows | present but not complete uniformly |
| trophy timestamps | trophy rows | `game_trophies.earn_date` | present only for exported detail rows |

The export also contained 207 playthrough rows and 202 release rows. The
export's `games.csv` supports embedded commas/newlines: 35 game records in the
observed sample contained at least one embedded newline.

## Identity

`games.uuid` is the same 16-byte identifier represented by SQLite `ZID`; it is
safe to normalize to the existing canonical GameTrack key. `games.igdb_id`
matches SQLite `ZGAMEID` for all 207 exported games. The export therefore fits
the existing identity policy:

```text
existing note mapping → IGDB ID → GameTrack ID → controlled fallback
```

The provider must fail safely if `uuid`, `title` or the required header set is
missing. Duplicate UUIDs are fatal for the snapshot. Missing IGDB is a warning,
not a reason to invent a title-based identity.

## Playtime

The export preserves the Phase 1.5/Phase 2 semantics:

- `games.hours_played` is the GameTrack aggregate in hours;
- `steam_games.playtime_forever` is minutes;
- `playstation_games.play_duration` is hours;
- Xbox export has no playtime field.

For 20 representative games, CSV aggregate playtime and SQLite aggregate
playtime matched 20/20; the full 207-game comparison matched 207/207. The
normalizer converts all values to minutes and preserves per-source
observations. It does not add `additional_playtime`, Steam and PlayStation
values to the GameTrack aggregate.

The GameTrack UI was manually checked for two representative records. It
displayed `Played 0 hrs` for AdVenture Capitalist and `Played 12,8 hrs` for Age
of Conquest IV; the corresponding CSV values were `0.0` and `12.85` hours.
The UI comparison was a spot check, not a 20-game automated UI comparison;
the UI does not expose a batch-readable playtime table through the available
accessibility surface.

Invalid numeric values or inconsistent optional rows remain diagnostics and do
not become a fabricated canonical scalar. A changed source during a future
read must produce a partial/failed snapshot and zero writes.

## Achievements

The export supports summary derivation:

- Steam: count `achieved` over exported achievement rows per Steam app ID;
- PlayStation: sum defined/earned bronze, silver, gold and platinum counts;
- Xbox: use `total_achievements` and `current_achievements`.

Steam and Xbox summaries can be marked complete when both sides of the count
are explicit. PlayStation summaries remain low-confidence because the export
does not prove catalogue completeness. Individual achievement records are not
stored in the canonical model by this prototype.

Observed detail coverage was 1,152 Steam achievement rows, 58 PlayStation
trophy rows and 225 Xbox achievement rows. This is enough for optional summary
support but not a guarantee that every platform's detailed catalogue is
complete. Missing achievement data is not converted to zero.

## Automatic update, cadence and atomicity

The manual export filename is timestamped and versioned by its timestamp. A
second export was not generated after a natural library mutation, so
deterministic update behavior, backup rotation and exact cadence triggers are
not confirmed. No filesystem watcher is implemented.

The observed export is a ZIP package, not a directly consumable single CSV.
The production file source reads the selected archive in memory through a
bundlable pure-JavaScript ZIP reader. It does not extract next to the source,
write to the archive or require access to the private GameTrack container.
The source is fingerprinted before and after reading; a changed source is
rejected as an unsafe snapshot. No filesystem watcher is implemented.

## Production implementation

Added components:

```text
user-selected ZIP export
    ↓
GameTrackCsvProvider
    ↓
parseGameTrackCsvExport()
    ↓
GameTrackRawGame intermediate model
    ↓
GameTrack normalizer
    ↓
CanonicalGame[]
```

The provider is transport-neutral and dependency-injected. It declares manual
transport (`automaticSync: false`) and is registered under the public provider
name `GameTrack`. The normal UI accepts a ZIP directly; an extracted directory
remains a secondary source for tests and development.

The strict production archive contract is deliberately small:

- `manifest.json` must be present;
- `games.csv` must be present;
- `games.csv` must contain `uuid`, `igdb_id`, `title`, `platforms` and
  `hours_played`;
- every production row must contain a valid UUID and positive IGDB ID.

Unknown files and additional columns are ignored. Required-file, schema,
identity, parse and source-change failures produce a failed snapshot and zero
vault writes.

It handles:

- required-header and malformed-CSV failures;
- BOM, quoted fields, embedded commas/newlines and escaped quotes;
- future columns without relying on column order;
- duplicate UUID rejection;
- optional Steam/PlayStation/Xbox activity, playtime and achievement summary;
- unknown platforms and missing IGDB diagnostics;
- invalid playtime without inventing a value;
- complete/partial/failed snapshot semantics.

## TCC and accessibility

The export was generated from GameTrack and copied for analysis outside the
repository. Direct SQLite still requires access to the private GameTrack
container and remains `NO-GO`. The production path uses the normal file
picker and reads the user-selected ZIP; it does not access the GameTrack
container, require Full Disk Access or modify the export.

The persisted path is used on desktop when Electron exposes a local file path.
If a runtime does not expose a reusable path, the user must choose the export
again; the provider never guesses or silently falls back to SQLite.

While GameTrack was open for the natural export/UI probe, its SQLite and WAL
files changed size and hash between earlier and final observations. No
`sqlite3` process remained after the probe, and no plugin operation issued any
write SQL or modified the source files. The change is therefore treated as
GameTrack-originated natural activity, not as evidence of a provider write.

## Snapshot and scheduler semantics

Preview approval is invalidated when the source fingerprint, provider or
configuration changes. Preview and sync share the canonical planning path;
sync is allowed only after a complete snapshot and matching approval.

GameTrack export imports are manual. The background scheduler does not
re-import the last selected ZIP as if it were a live provider.

## Decision matrix

| Transport | Automatic | Data coverage | Stable identity | Achievements | TCC-safe | Recommended |
|---|---:|---:|---:|---:|---:|---:|
| SQLite | yes | high | yes | partial | no | no |
| Automatic Backup | unverified | unverified | unverified | unverified | unverified | no |
| CSV export package | no | high for library/playtime; partial detail | yes | summary/partial detail | yes after user file selection | yes, manual |
| Direct providers | yes | platform-specific | yes | high per platform | yes | not as GameTrack transport |

## Recommendation and cutover verdict

`GameTrackCsvProvider` is the supported GameTrack production transport. It
preserves the canonical identity and playtime decisions, reads the official
ZIP without manual extraction and avoids TCC access to the private container.
The product model is explicit/manual rather than live or automatic: the user
exports from GameTrack, selects the ZIP, previews the plan and then syncs.

Automatic Backups should not be selected until GameTrack proves that the user
can configure them to a stable ordinary directory and that the resulting
artifact has the same coverage and atomicity guarantees.

```text
CUTOVER VERDICT: GO — CSV (official ZIP, manual / supported)
```

Automatic Backup and direct SQLite are not part of the normal production
transport. Full achievement catalogues, filesystem watching and automatic
export generation remain future work.
