# Runtime verification

## Current publication audit, 2026-10-06

See [publication-audit.md](publication-audit.md) for current evidence and open release checks. The release is now desktop-only. Anonymous GameTrack creation, idempotent reimport, a real YAML update preserving user content, concurrent-edit rejection and configuration-preview invalidation passed in an isolated Obsidian 1.14.4 desktop profile. Authenticated Steam/PSN and the declared minimum application version remain separate checks. The sections below are historical evidence for their stated revisions, not a mobile-support guarantee. Historical private-database/TCC findings do not apply to the current explicit ZIP-export flow.

## Historical verification: Phase 4A.5

Status: `NO-GO` for GameTrack production cutover.

The local Obsidian installation is structurally valid and can run the plugin.
The remaining blocker is macOS privacy authorization for the real GameTrack
container, not a missing executable or an invalid plugin bundle.

## Environment

| Item | Observed value |
|---|---|
| Obsidian UI/runtime | 1.14.1 |
| Obsidian bundle metadata observed earlier | 1.13.7; discrepancy retained as a diagnostic risk |
| Electron | 43.3.0 |
| Embedded Node | 24.18.1 |
| macOS | 27.0 (build 26A428) |
| `/usr/bin/sqlite3` | 3.54.0 |
| GameTrack | 6.1.5, bundle version 1018 |
| required schema signature | `a07d8908` |
| plugin build | 26.9.0 |

## Installation diagnosis

`/Applications/Obsidian.app` contains the executable named by
`CFBundleExecutable`, is a universal arm64/x86_64 Mach-O, has a valid Developer
ID signature and notarization ticket, and is accepted by Gatekeeper. A running
process was observed from that bundle, so the earlier `kLSNoExecutableErr`
was not reproduced as an executable/bundle defect. No application repair,
LaunchServices reset or reinstall was performed.

## Embedded runtime results

### Anonymous fixture — PASS

In a temporary, isolated vault containing only the development plugin build:

- plugin loaded in Obsidian Desktop;
- embedded Electron spawned `/usr/bin/sqlite3` successfully;
- the provider opened an anonymous SQLite fixture read-only;
- schema validation returned `supported` with 5 games;
- `Preview sync` executed through the registered command and composition root;
- first sync created 5 notes;
- second preview reported 0 creates, 0 updates and 5 unchanged;
- a controlled missing provider property was restored without losing user
  `status`, `rating`, a custom property or manual note content.

The first write attempt also exposed and then fixed a test-vault setup issue:
the configured `Games` directory did not exist. This was not a provider or
database failure.

### Real GameTrack database — BLOCKED / UNVERIFIED

The same embedded Electron child-process check reached `/usr/bin/sqlite3`,
but the real GameTrack file returned:

```text
unable to open database ...: authorization denied
```

The terminal process can read the database, while the Obsidian embedded process
is denied by macOS TCC. No permission changes were attempted. Until the user
grants the running Obsidian application access to the GameTrack container, the
real-database runtime chain cannot be marked production-verified.

## SQLite integrity and process cleanup

The existing real-database read-only checks recorded identical size, mtime and
SHA-256 values for `GameData.sqlite`, `GameData.sqlite-wal` and
`GameData.sqlite-shm` before and after terminal reads. The embedded test used
only the anonymous fixture, so it could not produce a real-database side
effect. No orphan `sqlite3` process was present after the checks.

The final Phase 4A.5 before/after comparison around the embedded authorization
probe was identical:

| File | Size | mtime | SHA-256 |
|---|---:|---:|---|
| `GameData.sqlite` | 16646144 | 1789378499 | `b9f3179f4c0b5cb96dcc1aa3be59232de324050e4ed92133f155dca98cb994d9` |
| `GameData.sqlite-wal` | 98912 | 1789378584 | `83ee0f88453a9afc70138d1c560072111a47434746da75f7b65d23474e8d7fbe` |
| `GameData.sqlite-shm` | 32768 | 1789386945 | `0994d0ffab274eec39cc250d68b28ec2f3f7a27e1fba4b789e960e2b609a28d4` |

No natural concurrent GameTrack write was forced. A concurrent real-database
test remains unverified because the embedded process lacks TCC access.

## Scheduler verification

The scheduler now consumes a provider-neutral `SyncExecutor`. Composition
adapts canonical and legacy services outside the scheduler. Manual and
scheduled execution share one concurrency guard, preview and apply share the
same opaque prepared plan, and partial/failed snapshots never call `apply`.
GameTrack background writes require explicit approval from a manual preview/apply
session; changing source or database path invalidates that approval.

Targeted contract tests passed for safe-operation selection, conflicts,
partial/failed snapshot blocking, explicit approval, source invalidation and
manual/scheduled serialization. Legacy providers remain available.

## Cutover verdict

`NO-GO`.

The canonical runtime and write path are proven in embedded Obsidian on an
anonymous fixture, but the required real GameTrack read is blocked by TCC.
The release gate must remain closed until a real database read, real preview,
and real GameTrack integrity check succeed in the embedded runtime. The only
other explicitly unverified scenario is a natural concurrent GameTrack write.

## Phase 5.5 manual ZIP gate

The isolated vault `game-sync-phase45-vault` was opened as a separate Obsidian
window and guarded with the `.game-sync-test-vault` marker. The production
`Choose export` action opened the native macOS file picker. The official ZIP
was visible and selectable in the picker, but the `Open` control remained
disabled, so the picker did not return a file to the plugin.

No path was injected, no Preview approval was created from this attempt, and
no Sync/write operation was run. Consequently the following remain
`UNVERIFIED`: native picker acceptance, first ZIP sync, second-sync
idempotency, mtime preservation of generated notes, restart persistence,
production enricher execution, and production scheduler behavior.

The source archive remained unchanged after the attempt: size `763150`, mtime
`1789389647`, SHA-256
`c8d93cbb0e6e4633506a42a334d92e2d6952f9eb43ab9c3076f393223081ebd5`.
Obsidian captured no runtime errors. No files were modified in the user's
production vault during the test window.

### Phase 5.5 gate result

`NO-GO` — the native picker could be opened, but it did not complete ZIP
selection. The test stopped before any write path, as required by the test-vault
safety guard.

## Phase 5.6 picker fix and repeated gate

The picker blocker was isolated to the renderer's hidden HTML file input. It
used an `accept` attribute, but did not configure the native Electron dialog
with explicit file-selection semantics. On macOS the ZIP row could be focused,
but `Open` remained disabled.

The production path now uses the asynchronous Electron `showOpenDialog` via
the existing bridge. The options are:

```text
properties: ["openFile"]
filters:
  - name: "GameTrack export", extensions: ["zip"]
  - name: "All files", extensions: ["*"]
defaultPath: saved export path, when available
buttonLabel: "Choose export"
```

The selected file is validated before the new source configuration is saved.
Cancel and an empty result leave the previous configuration and preview
approval unchanged. Development-only diagnostics record the dialog result and
filename, never a private path in the public diagnostics report.

### Native picker and ZIP runtime result

On Obsidian Desktop 1.14.1, in the isolated marked test vault
`game-sync-phase56-clean-vault`, the current production path passed the picker
test: the official ZIP became selectable, `Open` was enabled, the dialog
closed, and the plugin received the selected file. Cancel was also verified as
a no-op; the saved export fingerprint remained unchanged.

The real official export was read by the embedded runtime and produced:

```text
status: READY
games: 207
canonical games: 207
GameTrack: 6.1.5
snapshot: complete
```

The source archive was not modified. The final observed values remained size
`763150`, mtime `1789389647`, SHA-256
`c8d93cbb0e6e4633506a42a334d92e2d6952f9eb43ab9c3076f393223081ebd5`.

### Preview result and newly exposed blocker

Production Preview also passed the provider and canonical parsing path:

```text
read: 207
create: 206
update: 0
unchanged: 0
conflicts: 1
skipped: 0
```

The single conflict is deterministic and comes from the real export: it
contains two distinct `Dead Space` games with different IGDB IDs, while the
existing planner derives both target notes from the title. This is an
independent pre-existing canonical filename collision, not a picker or ZIP
transport failure. The `Sync games` action therefore remained disabled and no
notes were written.

First Sync, second Sync/idempotency, runtime user-property preservation,
Steam/PlayStation enrichment, scheduler runtime behavior and runtime
concurrency could not be completed in this repetition because the production
Preview correctly refused to approve a plan containing the unresolved
conflict. Unit and contract coverage for these paths remains green, but they
are not claimed as embedded end-to-end verification here.

The test vault's saved configuration contained the selected export before the
restart. After quitting and relaunching Obsidian, the application reopened the
user's last production vault rather than the isolated test vault. No Game Sync
action was performed there, and the test vault was not reopened afterward;
therefore restart persistence of the configured export remains unverified as an
end-to-end runtime result.

### Phase 5.6 gate result

`NO-GO`.

The ZIP picker and embedded ZIP read are now verified. Release remains blocked
by the real-export title collision that prevents a safe first Sync. No
provider, canonical pipeline, scheduler or writer redesign was made to bypass
the conflict. The user's production vault and the GameTrack source archive
were not written.

The final repository verification completed with 71 test files and 459 passing
tests (6 skipped), plus passing lint, typecheck, build, mobile-bundle and
release checks. The real-export transport test passed with 207 parsed games.

## Phase 5.7 collision-safe allocation

The planner now allocates note paths in a deterministic, batch-aware step
before create operations are emitted. The real export's two exact-title
`Dead Space` records now receive `Dead Space (2008).md` and
`Dead Space (2023).md`; the complete real-export plan contains 207 creates and
zero path conflicts in an empty fixture vault.

Existing matched paths remain authoritative and are never renamed. The
allocator uses release years for readable disambiguation and stable IGDB or
GameTrack identifiers only when the year is unavailable or insufficient.

This change resolves the Phase 5.6 planner blocker in the dry-run path. A real
embedded verification was then repeated after rebuilding and reloading the
plugin in the isolated marked test vault. The first production Preview showed:

```text
read: 207
create: 207
update: 0
unchanged: 0
conflicts: 0
skipped: 0
```

The first Sync created 207 Markdown notes. The two exact-title records were
written as `Games/Dead Space (2008).md` and `Games/Dead Space (2023).md`; the
other `Dead Space` sequel titles remained distinct. A representative note was
then edited with user-managed and custom properties plus body text. The next
production Preview showed `0 create`, `0 update`, `207 unchanged` and `0
conflicts`; the apply action was disabled because there was nothing to write.
The edited properties, body and representative note mtimes remained intact.

After a full Obsidian restart, the same test vault was reopened and Preview
again showed 207 unchanged games without selecting the export again. This
confirms persisted-path readability in the tested runtime. The test vault
needed its configured `Games` folder to exist before the first write; no
production-vault or source-archive changes were made.

## Phase 5.8 final runtime gate

### Target folder creation

A fresh isolated vault, `game-sync-phase58-clean-vault`, was opened in Obsidian
Desktop with the `.game-sync-test-vault` marker and without a `Games` folder.
The production Preview reported 207 creates and zero conflicts. The first
production Sync created the missing `Games` folder through the Obsidian Vault
API and wrote 207 notes. Nested-folder creation, file-vs-folder conflicts and
folder-creation failures are covered by focused tests; conflicts and creation
failures stop before any note write.

The second production Preview reported 207 unchanged games, zero creates,
zero updates and zero conflicts. The fresh vault contained exactly 207
Markdown game notes after the first Sync.

### Enricher availability

The isolated test vault has no pre-existing Steam or PlayStation credentials,
and no credentials were created or copied for this gate. Consequently:

- Steam runtime enrichment: `UNVERIFIED` — no available credentials;
- PlayStation runtime enrichment: `UNVERIFIED` — no available credentials.

The failure semantics remain covered by the canonical enrichment tests:
optional enrichment failure continues with a complete GameTrack snapshot and
does not erase stale enriched data. No claim is made here about live API
matching, activity, trophies or achievements.

### Scheduler and concurrency

The scheduler contract tests pass for the Phase 5.8 requirements: a manual
GameTrack export is not re-imported by background scheduling; scheduling is
allowed only for enabled optional enrichers; partial or failed library
snapshots never call the writer; and the shared guard serializes scheduled
and manual operations. A real-time race was not forced in Obsidian because it
would require an artificial long-running provider operation; the live
concurrency scenario therefore remains `CONDITIONALLY VERIFIED`, with the
unit/contract guard coverage passing.

### Production classification after Phase 5.8

| Component | Status | Evidence |
|---|---|---|
| GameTrack library provider | `VERIFIED` | embedded ZIP read, 207/207 canonical games, Preview and Sync |
| Canonical writer and target-folder handling | `VERIFIED` | fresh vault without `Games`, 207 notes created |
| Steam enricher | `UNVERIFIED` | no credentials in isolated test vault |
| PlayStation enricher | `UNVERIFIED` | no credentials in isolated test vault |
| GameTrack scheduler policy | `CONDITIONALLY VERIFIED` | scheduler tests; no live automatic ZIP import |
| Shared concurrency guard | `CONDITIONALLY VERIFIED` | scheduler/guard tests; no forced live race |

The source archive remained unchanged throughout the gate: size `763150`,
mtime `1789389647`, SHA-256
`c8d93cbb0e6e4633506a42a334d92e2d6952f9eb43ab9c3076f393223081ebd5`.
No GameTrack SQLite access was used in the production flow. No write was
performed in the user's production vault.

### Phase 5.8 gate result

`CONDITIONAL GO`.

The GameTrack ZIP library path, automatic target-folder creation, collision
safe allocation and idempotent second Preview are verified in embedded
Obsidian. Optional Steam and PlayStation runtime enrichment cannot be marked
verified without credentials, and a forced live concurrency race was not
performed. Phase 6 was not started.
