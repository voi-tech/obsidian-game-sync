# Game Sync

Game Sync synchronizes GameTrack exports, Steam and PlayStation game data into ordinary Obsidian Markdown notes.

## Features

- Steam library, playtime, achievements and metadata.
- PlayStation library, playtime and trophies.
- GameTrack's cross-platform library through its official ZIP export (manual import).
- One note per logical game, including games present on both providers.
- Conservative matching with preview before the first write.
- Existing note adoption without rewriting the manual body.
- Managed Properties and a managed achievements block; other note content remains user-owned.
- Optional `Games.base` bootstrap, background sync on desktop, English and Polish UI.
- No provider write-back, telemetry, Game Sync account or custom backend.

## Supported providers

### Steam

Steam requires an official Steam Web API key and a public Steam profile. The connection dialog accepts a profile URL, name or SteamID64. Profile and Game Details visibility must allow the library to be read.

### PlayStation

PlayStation support is unofficial. It uses an NPSSO bootstrap and the `psn-api` package for the current PlayStation Network flows. See the warning below before enabling it.

### GameTrack

GameTrack is the preferred source for a combined multi-platform library. Export
your library from GameTrack, then select the official ZIP in Game Sync. The
import is manual and read-only: Game Sync does not access GameTrack's private
database, require Full Disk Access or modify the export.

## Installation

### Community plugins

After directory approval, install **Game Sync** from Obsidian’s Community Plugins browser. Enable the plugin and open **Game Sync: Open Quick Setup**.

### BRAT

For a development or pre-directory build, use BRAT to add:

`https://github.com/voi-tech/obsidian-game-sync`

Enable the installed plugin after BRAT finishes updating it.

### Manual installation

Download the matching release files into `.obsidian/plugins/game-sync/`:

- `main.js`
- `manifest.json`
- `styles.css`

Reload Obsidian, enable **Game Sync** and open Quick Setup.

## First setup

1. Open the command palette and run **Game Sync: Open Quick Setup**.
2. Choose a library source. For GameTrack, export the library from GameTrack
   and select the ZIP when prompted.
3. Review **Preview first sync**.
4. Apply the changes you accept.

The default destination is `Games/`; change it only if you want another folder. The provider dialogs explain the account-specific steps and the preview is shown before anything is written.

The first sync cannot be applied silently. A later sync may still require review when matching is uncertain. When credentials are still available, opening a connection tries a one-click reconnect first and opens the provider dialog only when repair is needed.

## GameTrack setup

1. In GameTrack, export your library using its official export action.
2. Open Game Sync settings and choose **GameTrack** as the library source.
3. Select the exported ZIP.
4. Run **Preview sync**, review the plan and then sync.

GameTrack imports are explicit/manual. Selecting an export does not start a
background sync, and the scheduler does not silently re-import a stale file.

For an already imported GameTrack library, optional Steam activity/achievements
and PlayStation activity/trophies can be enabled under Additional settings.
These enrichers update matched games only; they never add games that are not in
the selected GameTrack library.

## Steam setup

Create an official Steam Web API key at [Steam's API-key page](https://steamcommunity.com/dev/apikey), then enter it together with your Steam profile URL, vanity name or SteamID64 in the Steam connection dialog. On later connections, leave the API-key field empty to reuse the key from Obsidian SecretStorage. Keep the profile and Game Details visibility public enough for the selected data. The key is never written to vault data or plugin state.

## PlayStation setup

PlayStation connection opens the official PlayStation sign-in and connection-code pages. Sign in, get a connection code, paste it into the dialog and connect. Game Sync exchanges it for a reusable session and stores credentials in Obsidian SecretStorage; the one-time code is not retained.

PlayStation support is unofficial. Sony does not provide a public consumer API for this use case. The integration depends on undocumented PlayStation Network behavior and may break when Sony changes it.

## Notes and Properties

Game Sync writes ordinary Markdown notes. Managed Properties use the default names such as `game-sync-id`, `steam-id`, `playstation-id`, `playtime` and provider-specific playtime fields. Property destinations can be changed or disabled in Settings; template keys are independent of Property mappings.

On an existing note, Game Sync preserves the manual body, unmanaged frontmatter and existing note identity. Templates render the body only when a new note is created. The managed achievements block is delimited by:

```md
%% game-sync:achievements %%

...

%% /game-sync:achievements %%
```

Playtime is stored in minutes. Progress values are numeric `0–100`. Dates use `YYYY-MM-DD`; technical timestamps use ISO 8601.

## Templates

Set a template path in Settings. Template keys include `title`, `released`, `description`, `cover`, `providers`, `owned`, `playtime`, `lastPlayed`, `steamId`, `steamAchievements`, `playstationId` and `playstationTrophies`.

Available helpers are `join`, `hours`, `percent` and `date`. Partials include `achievements`, `steamAchievements` and `playstationTrophies`.

## Achievements and trophies

Steam achievements and PlayStation trophies remain separate provider data. Game Sync does not create a combined achievement percentage. Hidden items stay undisclosed by default. If an achievement request is partial, known note data is retained and unknown values are left unknown.

## Games.base

`Games.base` is optional. If enabled, Game Sync creates it once with managed-property views for the library, Steam, PlayStation, cross-platform games and achievement/trophy views. It is not overwritten on later syncs.

## Background sync

Background sync is off by default and is disabled on mobile. Supported intervals are 30 minutes, 1 hour, 6 hours, 12 hours and 24 hours. It applies only safe operations; conflicts, uncertain matches and the first sync remain explicit-preview work.

## Privacy and network access

- There is no Game Sync backend, telemetry or Game Sync account.
- Vault contents and full note bodies are not uploaded.
- Provider requests go directly from Obsidian to provider services.
- Credentials are stored using Obsidian SecretStorage.
- Diagnostic text is allowlisted and excludes credentials, tokens, API responses and note contents.

The current production bundle contains these provider-related hosts:

| Purpose | Hostnames |
| --- | --- |
| Steam Web API and store metadata | `api.steampowered.com`, `store.steampowered.com` |
| Sony authentication | `ca.account.sony.com` |
| PlayStation library and trophy services | `web.np.playstation.com`, `m.np.playstation.com` |

The PlayStation hosts are reached through the isolated `psn-api` dependency. The plugin does not add a proxy or backend.

## PlayStation integration disclaimer

PlayStation support is unofficial. Sony does not provide a public consumer API for this use case. The integration depends on undocumented PlayStation Network behavior and may break when Sony changes it. Do not treat this integration as affiliated with or endorsed by Sony or PlayStation.

## Limitations

- Synchronization is provider → Obsidian only; there is no write-back.
- Game Sync never automatically deletes, moves, renames or merges existing notes.
- One Steam account and one PlayStation account are supported per vault.
- Purchase history, RAWG and providers other than GameTrack, Steam and PlayStation are outside this release.
- GameTrack requires an official ZIP export; imports are explicit and manual.
- Full provider connect/sync/background behavior is guaranteed on desktop; mobile bundle loading, settings and Markdown access are supported, while background sync is disabled.
- Uncertain cross-provider matches remain review/conflict items. The match-manager command is reserved until a safe split/unmerge backend is available.

## Troubleshooting

### Steam returns no games

Check the SteamID64, API key and profile/Game Details visibility. Run **Force refresh all data** after correcting the account.

### PlayStation asks you to connect again

The refresh session may have expired or been revoked. Reconnect through the PlayStation connection dialog. Existing Markdown notes are not removed by disconnecting.

### A note is not changed

Inspect the preview. The game may be ignored, matched ambiguously, or waiting for explicit review. Do not force a merge when the candidates are not clearly the same game.

### Diagnostics

Use **Copy diagnostic information** and share the generated report only after checking that it contains no private context. Never paste credentials or tokens into an issue.

## Development

Requirements: Node.js `>=20.19.0`.

```bash
npm ci
npm run check
npm run dev
```

The check runs lint, typecheck, the full Vitest suite, the production build, the mobile-bundle gate and the release gate.

## License

MIT. See [LICENSE](LICENSE).
