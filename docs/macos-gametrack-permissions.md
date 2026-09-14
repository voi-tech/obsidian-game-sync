# macOS GameTrack permissions — Phase 4A.6

Status: `NO-GO` for direct GameTrack SQLite production cutover.

This spike tested only official macOS permission paths. The GameTrack
container, its SQLite database and the TCC database were not modified.

## Host application

| Check | Result |
|---|---|
| Bundle identifier | `md.obsidian` |
| `CFBundleExecutable` | `Obsidian` |
| Executable | Present; universal arm64/x86_64 Mach-O |
| `NSAppDataUsageDescription` | Absent from `Info.plist` |
| Sandbox entitlement | No readable `com.apple.security.app-sandbox`; entitlements inspection reported an invalid blob |
| Code signature verification | `codesign --verify --deep --strict` reported `invalid signature (code or signature have been modified)` for arm64 |
| Gatekeeper assessment | Current assessment returned an internal Code Signing subsystem error |
| Runtime observed by UI | Obsidian 1.14.1 |
| Bundle metadata | 1.13.7; version discrepancy remains unresolved |

The executable exists and Obsidian can run, but the installed bundle is not a
clean production verification target until its signature/version discrepancy is
resolved by a normal user-managed installation repair. No repair, re-signing or
bundle modification was attempted.

## Direct App Data access

The earlier embedded test returned `authorization denied` when the plugin's
short-lived `sqlite3` process opened the real GameTrack database. The terminal
can read the same database.

The official, narrowly scoped command
`tccutil reset SystemPolicyAppData md.obsidian` completed successfully. After a
full Obsidian restart no authorization prompt was observed. No positive direct
App Data authorization was obtained, and the real embedded read remains
blocked/unverified.

The `tccd` log identifies the requesting host as `md.obsidian` and the real
bundle path. It did not show a usable plugin-level authorization mechanism or a
prompt that could be accepted by the plugin.

## OpenPanel directory probe

A development-only command was added and excluded from the production build.
It invokes the native Electron open dialog with `openDirectory`, then attempts
to read `GameData.sqlite` through the normal read-only provider. The selected
directory is intended to cover the adjacent `-wal` and `-shm` files as well.

Observed behavior:

- the native `Choose GameTrack folder` panel opened in embedded Obsidian;
- the protected GameTrack directory and all three database-related files were
  visible in the panel;
- the renderer did not expose `electron.dialog` directly; the installed host
  exposed a legacy `electron.remote.dialog` path, which is not a suitable
  stable Community Plugin contract;
- a directory selection callback followed by embedded SQLite read could not be
  confirmed: the native `Open` action remained disabled under the available UI
  harness;
- therefore OpenPanel directory access is `UNVERIFIED`, not a PASS;
- no vault write and no GameTrack database write occurred.

This result does not justify a production dependency on Electron `remote` or
on undocumented Obsidian IPC. A supported host-level folder picker/API would be
needed to make this path production-grade.

## Restart persistence

Not established. No successful OpenPanel grant/read was obtained, so there is
no permission token or selected path whose persistence can be tested across a
second restart.

## WAL and side effects

No production read was performed after a confirmed OpenPanel selection. The
previous read-only probes recorded identical size, mtime and SHA-256 for
`GameData.sqlite`, `GameData.sqlite-wal` and `GameData.sqlite-shm` before and
after the embedded authorization probe. No database write or configuration
change was forced. Natural concurrent GameTrack writing remains untested.

## Full Disk Access control

Full Disk Access was not granted. Granting it requires a user action in System
Settings and was intentionally not automated. The existing denial without FDA
is therefore confirmed; a positive FDA control result remains unverified.

Even if FDA makes direct SQLite access work, it would grant Obsidian broad
access to the user's files. That is technically viable only as an explicit
advanced opt-in, not as a recommended default for a Community Plugin.

## CSV fallback assessment

CSV export was not implemented in this spike.

| Dimension | Assessment |
|---|---|
| Data coverage | Depends on GameTrack's export format; likely lower than private SQLite, especially for provenance, WAL-backed activity and detailed metadata |
| Manual effort | User must export the file and select/import it periodically |
| Cross-platform potential | High; user-selected file avoids macOS App Data protection and can work on desktop/mobile if the export is available |
| TCC implications | File picker access only; no direct access to another app's container |
| Product suitability | Better long-term fallback than requiring FDA; exact coverage must be measured from a real export |

## Decision matrix

| Method | Works | Survives restart | Extra permission | Suitable default |
|---|---|---|---|---|
| Direct container | No in embedded Obsidian; terminal only | No positive result | App Data/TCC authorization | No |
| OpenPanel directory | Native panel opens; directory grant/read unverified | Unverified | Explicit folder selection | No decision yet; not production-ready |
| Full Disk Access | Not tested; no grant made | Unverified | Broad FDA permission | No; advanced-only at most |
| CSV export | Not implemented | n/a | File selection | Future fallback, preferred over FDA |

## Recommended production strategy

Keep direct GameTrack SQLite as `NO-GO` for default/cutover. Do not add FDA
instructions as a normal setup step and do not depend on Electron `remote` or
hidden IPC. Before reconsidering SQLite, use a clean, user-managed Obsidian
installation and a supported folder-selection API that proves:

1. real database read;
2. WAL/SHM visibility;
3. persistence after two full restarts;
4. no database side effects.

Otherwise prioritize a future `GameTrackCsvProvider`, with its actual export
coverage documented before implementation.
