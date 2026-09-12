# Game Sync 26.9.0 Specification

## Product

Game Sync synchronizes Steam and PlayStation game library data into ordinary Obsidian Markdown notes.

## Guarantees

- One-way provider → Obsidian.
- No telemetry.
- No custom backend.
- No automatic delete/move/rename of existing notes.
- One logical game can contain Steam and PlayStation sources.
- Cross-provider merges that change existing vault structure require review.
- User content outside managed Properties and the Game Sync achievements block is preserved.
- Templates run only on note creation.
- Secrets use Obsidian SecretStorage.
- PlayStation integration is unofficial and isolated.

## Release scope

## Compatibility

- `minAppVersion` is `1.13.7`.
- The planned API surface includes `SecretStorage`, `SecretComponent`, `requestUrl`, and `FileManager.processFrontMatter`. The official API documentation and guides do not establish reliable introduction versions for every one of these APIs. The official plugin submission requirements therefore permit using the latest stable build when the appropriate minimum cannot be determined reliably.
- The official Obsidian changelog records public Obsidian Desktop `1.13.7` and public Mobile `1.13.7` on 2026-08-12. This public release is the compatibility floor for the initial package scaffold. Obsidian `1.14.1` was a Catalyst build and is not selected as the floor.
- Official references: [submission requirements for plugins](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), [SecretStorage and SecretComponent](https://docs.obsidian.md/plugins/guides/secret-storage), [`requestUrl`](https://docs.obsidian.md/Reference/TypeScript%20API/requestUrl), [frontmatter processing guidance](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Prefer+%60FileManager.processFrontMatter%60+to+modify+frontmatter+of+a+note), [Obsidian 1.13.7 Desktop Public changelog](https://obsidian.md/changelog/2026-08-12-desktop-v1.13.7/), and [Obsidian 1.13.7 Mobile Public changelog](https://obsidian.md/changelog/2026-08-12-mobile-v1.13.7/). The non-selected Catalyst references are [Obsidian 1.14.1 Desktop](https://obsidian.md/changelog/2026-09-08-desktop-v1.14.1/) and [Obsidian 1.14.1 Mobile](https://obsidian.md/changelog/2026-09-08-mobile-v1.14.1/).
- Approved architectural ruling: mobile bundle validation runs now and at final release. The mobile bundle must load without Node or Electron imports; `isDesktopOnly` remains `false`.

## Global Constraints

- Repozytorium: `voi-tech/obsidian-game-sync`.
- Plugin name: `Game Sync`.
- Plugin ID: `game-sync`.
- Package name: `obsidian-game-sync`.
- License: MIT.
- Initial release: `26.9.0`.
- Versioning: `YY.M.PATCH`, zawsze poprawny SemVer.
- Default branch: `main`.
- `isDesktopOnly: false`.
- Desktop jest platformą gwarantowaną dla pełnego connect/sync/background sync.
- Mobile bundle musi się ładować bez Node/Electron dependencies.
- Kierunek synchronizacji wyłącznie provider → Obsidian.
- Nigdy nie implementować write-back do Steam/PlayStation.
- Brak telemetryki.
- Brak własnego backendu.
- Brak własnego konta Game Sync.
- Brak wysyłania treści vaulta gdziekolwiek.
- Secrets wyłącznie przez `SecretStorage`.
- Steam 1.0: własny SteamID64 + oficjalny Steam Web API key.
- PlayStation 1.0: unofficial NPSSO → tokens flow poprzez izolowany `psn-api`.
- NPSSO traktować jak hasło i nie przechowywać po bootstrapie sesji.
- Jeden Steam account i jeden PlayStation account per vault.
- Jedna logiczna gra = jedna notatka niezależnie od providerów.
- Nigdy automatycznie nie usuwać notatek.
- Nigdy automatycznie nie przenosić notatek.
- Nigdy automatycznie nie zmieniać nazw istniejących notatek.
- Nigdy automatycznie nie scalać dwóch istniejących notatek.
- Template renderuje body wyłącznie podczas tworzenia notatki.
- Po utworzeniu body jest user-owned poza managed achievements block.
- Wszystkie zarządzane Property names są konfigurowalne i możliwe do wyłączenia.
- Template keys są stabilne i niezależne od Property mappings.
- `playtime` i provider-specific playtime zapisujemy w minutach.
- Progress zapisujemy jako numeric `0–100`, bez `%`.
- Calendar dates: `YYYY-MM-DD`.
- Technical timestamps: ISO 8601.
- `game-sync-id` domyślnie włączone.
- `status`, `rating`, `favorite`, `start`, `end`, `review`, `notes`, `tags` są user-owned.
- Steam achievements i PlayStation trophies pozostają osobnymi systemami.
- Nie tworzyć globalnego achievement percentage łączącego oba systemy.
- `playtime` globalne = suma znanych provider playtimes.
- Hidden/unearned achievements domyślnie nie ujawniają spoilerów.
- Covers pozostają URL-ami; brak lokalnego downloadu w 26.9.0.
- Metadata language: Follow Obsidian / English / Polish; fallback English.
- UI: pełne English + Polish.
- `Games.base` jest opcjonalnym bootstrapem tworzonym tylko raz; później user-owned.
- Background sync default OFF i desktop-only.
- Event history JSONL default OFF.
- Purchase-history importer nie należy do 26.9.0.
- IGDB/RAWG nie należą do 26.9.0.
- GOG/Epic/Xbox/RetroAchievements nie należą do 26.9.0.
- Nie budować custom library dashboardu.
- Nie budować multi-account modelu.
- Nie tworzyć shared package/core z Watch Sync w 26.9.0.
- Można adaptować wzorce z `voi-tech/obsidian-watch-sync`, ale nie robić mechanicznego forka.
- Przed każdym znaczącym commitem uruchamiać adekwatne testy.
- Przed każdym milestone commitem uruchamiać `npm run check`.
- Nie claimować ukończenia funkcji bez przejścia jej testów.
- Nie publikować release bez pełnego release gate.

---

# Approved Product Contract

Przed implementacją przeczytaj całą sekcję. To są wymagania, nie sugestie.

## Library filtering

Domyślne ustawienia:

```ts
includeUnplayed = true;
includeFreeToPlay = true;
includePreviouslyPlayedNoLongerOwned = true;
includeDemosTrials = false;
includeBetasTestApps = false;
```

Nie importuj jako osobnych gier:

- soundtracków,
- launcherów,
- tools,
- DLC,
- season passów.

Osobnymi grami pozostają:

- remastery,
- remake'i,
- odrębne editions, jeśli provider traktuje je jako odrębny produkt,
- semantycznie różne gry o tej samej nazwie.

PS4/PS5 rekordy mogą zostać scalone wewnątrz PlayStation, jeśli provider metadata jednoznacznie wskazują ten sam concept.

## Provider ownership

Provider-specific:

```ts
steamOwned?: boolean;
playstationOwned?: boolean;
```

Common:

```ts
owned = steamOwned === true || playstationOwned === true;
```

Brak gry w pojedynczym snapshot nie oznacza utraty ownership.

Przejście do `owned: false` wymaga dwóch kolejnych **pełnych, udanych** snapshotów danego providera, w których gry brakuje.

Provider failure nie zwiększa licznika missing.

## Acquisition type

```ts
type AcquisitionType =
  | "purchased"
  | "subscription"
  | "free"
  | "key"
  | "gift"
  | "unknown";
```

Nie zgaduj. Jeżeli provider nie daje wiarygodnej informacji, użyj `unknown`.

## Cross-provider identity

Priorytet:

1. explicit positive mapping,
2. `game-sync-id`,
3. provider IDs,
4. local durable identity index,
5. exact/high-confidence metadata evidence,
6. likely candidate → review,
7. ambiguous → conflict.

`Keep separate` zapisuje durable negative mapping.

`Skip` nie zapisuje mappingu.

## Preview

Pierwszy sync zawsze pełny preview.

Późniejsze tryby:

```ts
type PreviewMode =
  | "always"
  | "first-and-review"
  | "review-only";
```

Review-required operacja zawsze wymaga jawnej decyzji niezależnie od ustawienia.

## Disconnect

Disconnect usuwa credentials i techniczny provider session state.

Nie usuwa:

- notatek,
- Properties,
- achievements,
- provider IDs,
- historii JSONL.

## Ignore

Odznaczenie w preview = skip once.

`Ignore game` = durable logical-game exclusion.

Ignored games mają manager z możliwością restore.

## Managed achievements block

Markery:

```md
%% game-sync:achievements %%

...

%% /game-sync:achievements %%
```

Dwa bloki tego samego typu w jednej notatce = konflikt, nie zgaduj.

## Template behavior

Template renderuje body tylko przy tworzeniu notatki.

Przy adopcji istniejącej notatki template nie jest wykonywany.

Publiczne Handlebars keys działają niezależnie od Property mapping.

Required minimum public keys:

```text
id
title
original
year
released
description
cover
developers
publishers
genres
platforms
providers
owned
acquisitionType
playtime
playtimeHours
lastPlayed
updated

steamId
steamUrl
steamOwned
steamPlaytime
steamPlaytimeHours
steamLastPlayed
steamAchievementsEarned
steamAchievementsTotal
steamAchievementsProgress
steamAchievements

playstationId
playstationUrl
playstationOwned
playstationPlaytime
playstationPlaytimeHours
playstationLastPlayed
psnTrophiesEarned
psnTrophiesTotal
psnTrophiesProgress
psnBronze
psnSilver
psnGold
psnPlatinum
playstationTrophies

purchaseDate
purchasePrice
purchaseCurrency
purchaseSource

developersText
publishersText
genresText
platformsText
providersText
```

Required helpers:

```text
join
hours
percent
date
```

Required partials:

```text
achievements
steamAchievements
playstationTrophies
```

## Default Properties

```yaml
game-sync-id: "..."
type: game
title: Cyberpunk 2077
released: 2020-12-10
developers:
  - CD PROJEKT RED
publishers:
  - CD PROJEKT
genres:
  - RPG
cover: https://...
platforms:
  - pc
  - ps5
providers:
  - steam
  - playstation
owned: true
acquisition-type: unknown
playtime: 8420
last-played: 2026-09-11

steam-id: "1091500"
steam-owned: true
steam-playtime: 3120
steam-last-played: 2026-07-20
steam-achievements-earned: 31
steam-achievements-total: 44
steam-achievements-progress: 70.45

playstation-id: "..."
playstation-owned: true
playstation-playtime: 5300
playstation-last-played: 2026-09-11
psn-trophies-earned: 38
psn-trophies-total: 45
psn-trophies-progress: 84.44
psn-bronze: 28
psn-silver: 7
psn-gold: 3
psn-platinum: 0

game-sync-updated: 2026-09-12T12:30:00+02:00
```

Important semantic correction:

```text
providers = data sources such as steam/playstation
platforms = actual platforms such as pc/ps4/ps5
```

Nie wpisuj `steam` do `platforms`.

---
