# Game Sync

Game Sync synchronizes GameTrack exports, Steam and PlayStation game data into ordinary Obsidian Markdown notes.

## Features

- Steam library, playtime, achievements and metadata.
- PlayStation library, playtime and trophies.
- GameTrack's cross-platform library through its official ZIP export (manual import).
- One note per logical game, including games present on both providers.
- Conservative matching with preview before the first write.
- Existing note adoption without rewriting the manual body.
- Mapped destinations and a managed achievements block; unmapped note attributes and other note content remain unchanged.
- Optional `Games.base` bootstrap, background sync on desktop, English and Polish UI.
- No provider write-back, telemetry, Game Sync account or custom backend.

## Supported providers

### Steam

Steam requires an official Steam Web API key and a public Steam profile. The connection dialog accepts a profile URL, name or SteamID64. Profile and Game Details visibility must allow the library to be read.

### PlayStation

PlayStation support is unofficial and requires a PlayStation account. Select **Sign in to PlayStation**, sign in on the Sony page in the isolated desktop browser, then select **Finish connecting**. No session code needs to be copied in this flow. The initial session is exchanged through a scoped native HTTPS client; subsequent access tokens are refreshed automatically. Background note updates still require explicit background-sync write approval.

Sony may reject embedded sign-in. The collapsed **Advanced: manual connection** section is a fallback, not the default. The embedded browser uses a separate, non-persistent memory partition, without Node access or popups. Removing the browser does not immediately erase that partition's cookies; they may remain until Obsidian closes. Only the refresh token is saved in SecretStorage. The Sony login, MFA and minimum Obsidian version still require authenticated end-to-end verification before stable publication.

### GameTrack

Steam and PlayStation synchronize directly through their accounts, without
exporting or importing files. GameTrack is an optional manual source. Export
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
2. Connect Steam, PlayStation, or both. Use the optional GameTrack source only
   if you want to import an exported ZIP.
3. Review **Preview first sync**.
4. Apply the changes you accept.

The default destination is `Games/`; change it only if you want another folder. The provider dialogs explain the account-specific steps and the preview is shown before anything is written.

Quick Setup opens only when you request it; enabling the plugin or starting Obsidian does not open it. The first sync requires a preview and explicit Apply. With the default preview setting, later **Sync now** clicks apply safe changes directly from all connected, enabled accounts. Uncertain matches, conflicts and risky changes still require review; **Preview sync** always opens a preview. When credentials are still available, opening a connection tries a one-click reconnect first and opens the provider dialog only when repair is needed.

The sync preview lets you select individual games and individual changed attributes, inspect create/update details and apply only the changes you accept.

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

Game Sync writes ordinary Markdown notes. Each managed source field can use a custom destination attribute name, or be disabled by clearing the destination in Settings. User-owned attributes — `status`, `rating`, `favorite`, `start`, `end`, `review`, `notes` and `tags` — are protected: they cannot be selected as destinations and remain under your control. Template keys are independent of attribute mappings.

On an existing note, Game Sync preserves the manual body, unmanaged frontmatter and existing note identity. Templates render the body only when a new note is created. The managed achievements block is delimited by:

```md
%% game-sync:achievements %%

...

%% /game-sync:achievements %%
```

Playtime is stored in minutes. Progress values are numeric `0–100`. Dates use `YYYY-MM-DD`; technical timestamps use ISO 8601.

## Templates

Set a template path in Settings. The flat template context exposes the complete public key catalog:

```text
id, title, original, year, released, description, cover,
developers, publishers, genres, platforms, providers,
owned, acquisitionType, playtime, playtimeHours, lastPlayed, updated,
steamId, steamUrl, steamOwned, steamPlaytime, steamPlaytimeHours,
steamLastPlayed, steamAchievementsEarned, steamAchievementsTotal,
steamAchievementsProgress, steamAchievements,
playstationId, playstationUrl, playstationOwned, playstationPlaytime,
playstationPlaytimeHours, playstationLastPlayed, psnTrophiesEarned,
psnTrophiesTotal, psnTrophiesProgress, psnBronze, psnSilver, psnGold,
psnPlatinum, playstationTrophies,
purchaseDate, purchasePrice, purchaseCurrency, purchaseSource,
developersText, publishersText, genresText, platformsText, providersText
```

The array keys `developers`, `publishers`, `genres`, `platforms` and `providers` can be rendered with `join`. Platform values are normalized identifiers such as `pc` and `playstation-5`; `platformsText` is the ready-to-display comma-separated form. The current provider data does not reliably identify how a game was acquired, so `acquisitionType` is `unknown`.

Available helpers are `join`, `hours`, `percent` and `date`. `join` joins an array, `hours` converts minutes to hours, `percent` formats a number to two decimal places, and `date` formats a date with `YYYY-MM-DD` as the default. The implementation also registers `renderAchievementList` for the built-in achievement partials. Obsidian placeholders such as `{{date:YYYY-MM-DD}}` and `{{time:HH:mm}}` are also resolved when the template is rendered.

Partials are `achievements` (both providers), `steamAchievements` and `playstationTrophies`. They render the corresponding achievement or trophy lists while keeping hidden, locked item details undisclosed unless spoiler disclosure is enabled.

## Achievements and trophies

Steam achievements and PlayStation trophies remain separate provider data. Game Sync does not create a combined achievement percentage. Hidden items stay undisclosed by default. If an achievement request is partial, known note data is retained and unknown values are left unknown.

## Games.base

`Games.base` is optional. If enabled, an explicit completed sync creates it once with views for All games, Recently played, Most played, Steam, PlayStation, Never played, Steam 100% and PlayStation platinum. It is not overwritten on later syncs.

## Background sync

Background sync is off by default. Supported intervals are 30 minutes, 1 hour, 6 hours, 12 hours and 24 hours. It applies only safe operations; conflicts, uncertain matches and the first sync remain explicit-preview work. Stopping the runtime invalidates pending previews before further writes.

## Privacy and network access

- There is no Game Sync backend, telemetry or Game Sync account.
- Vault contents and full note bodies are not uploaded.
- Provider requests go directly from Obsidian to provider services.
- Credentials are stored using Obsidian SecretStorage.
- GameTrack reads only the ZIP export you explicitly select, including a file outside the vault. The selected path is saved in the plugin's local settings; the export is not modified or uploaded.
- Diagnostic text is allowlisted and excludes credentials, tokens, API responses and note contents.

The current production bundle contains these provider-related hosts:

| Purpose | Hostnames |
| --- | --- |
| Steam Web API and store metadata | `api.steampowered.com`, `store.steampowered.com` |
| Sony authentication | `ca.account.sony.com` |
| PlayStation library and trophy services | `web.np.playstation.com`, `m.np.playstation.com` |

The PlayStation API hosts are reached through the scoped native HTTPS client, using endpoint definitions adapted from `psn-api` 2.18.1. The sign-in window also accesses `www.playstation.com` and Sony-owned login pages under `sony.com`, `sonyentertainmentnetwork.com` and `playstation.com`, including their login-page resources. Navigation outside these domains closes the sign-in window, but this is not a network-level redirect blocker. The plugin does not add a proxy or backend.

## PlayStation integration disclaimer

PlayStation support is unofficial. Sony does not provide a public consumer API for this use case. The integration depends on undocumented PlayStation Network behavior and may break when Sony changes it. Do not treat this integration as affiliated with or endorsed by Sony or PlayStation.

## Limitations

- Synchronization is provider → Obsidian only; there is no write-back.
- Game Sync never automatically deletes, moves, renames or merges existing notes.
- One Steam account and one PlayStation account are supported per vault.
- Purchase history, RAWG and providers other than GameTrack, Steam and PlayStation are outside this release.
- GameTrack requires an official ZIP export; imports are explicit and manual.
- This release is desktop-only. The GameTrack file picker and export reader use Electron and Node APIs; mobile support is not claimed.
- Uncertain cross-provider matches remain review/conflict items. **Manage game matches** provides Merged, Kept separate and Unresolved views. It can prepare and apply a reviewed split/unmerge, allow matching again for kept-separate pairs and resolve unresolved candidates with merge, keep-separate or skip.

## Troubleshooting

### Steam returns no games

Check the SteamID64, API key and profile/Game Details visibility. Run **Force refresh all data** after correcting the account.

### PlayStation asks you to connect again

The refresh session may have expired or been revoked. Reconnect through the PlayStation connection dialog. Existing Markdown notes are not removed by disconnecting.

### A note is not changed

Inspect the preview. The game may be ignored, matched ambiguously, or waiting for explicit review. Do not force a merge when the candidates are not clearly the same game.

If the note, settings, property mapping or template changed after the preview, prepare a new preview. Invalid or ambiguous YAML, including duplicate keys and unsafe anchor changes, blocks synchronization rather than guessing the note's identity. Managed frontmatter updates are atomic and preserve user-owned properties, nested YAML, comments and the Markdown body.

### Diagnostics

Use **Copy diagnostic information** and share the generated report only after checking that it contains no private context. Never paste credentials or tokens into an issue.

## Development

Requirements: Node.js `>=20.19.0`.

```bash
npm ci
npm run check
npm run dev
```

The check runs lint, typecheck, the full Vitest suite, the production build and the release gate. The optional `check:mobile-bundle` scanner is not proof of mobile compatibility and is not a release gate.

See [publication audit](docs/publication-audit.md) and [runtime verification](docs/runtime-verification.md) for tested scenarios and remaining release checks. `npm audit --omit=dev` covers shipped dependencies; the full audit also includes the Obsidian development SDK's pinned Moment dependency.

## License

MIT. See [LICENSE](LICENSE). Bundled dependencies retain their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The build embeds these notices in `main.js`, so they accompany the standard three-file Obsidian installation.
