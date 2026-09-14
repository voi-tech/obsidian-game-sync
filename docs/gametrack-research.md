# GameTrack research

Data audytu: 2026-09-14, macOS, lokalna instalacja GameTrack 6.1.5 (`CFBundleVersion 1018`).

Zakres tego dokumentu obejmuje wyłącznie research. Nie zmieniano kodu wtyczki, ustawień, vaulta ani bazy GameTrack.

## Executive summary

- GameTrack może być potraktowany jako jeden provider: `gametrack`.
- Lokalna baza istnieje pod ścieżką:
  `~/Library/Containers/com.joekw.gametrack/Data/Library/Application Support/GameTrack/GameData.sqlite`.
- Baza jest aktualnie otwarta w trybie WAL i ma aktywne pliki `-wal` oraz `-shm`. Odczyt musi uwzględniać WAL.
- To baza Core Data/CloudKit, nie publiczny kontrakt aplikacji. `PRAGMA user_version` wynosi `0`, więc nie nadaje się do wykrywania wersji schematu.
- `ZGAME.ZID` jest unikalnym 16-bajtowym identyfikatorem każdej z 207 gier. `ZGAME.ZGAMEID` jest bardzo prawdopodobnie IGDB ID: wszystkie 207 wartości są unikalne i mają odpowiadające im URL-e IGDB w `ZPOSTERURL`. Nie ma jednak oficjalnej dokumentacji tego kontraktu; implementacja musi to wykrywać i walidować.
- GameTrack zawiera dane wystarczające do prototypu `CanonicalGame`: tytuł, IGDB ID, identyfikator GameTrack, platformy, identyfikatory platformowe, ownership hint, playtime, część dat aktywności, metadata i summary achievementów.
- Nie wszystkie dane są kompletne: brak Steam `last played`, pełne PS trophies są obecne tylko dla jednej gry, RetroAchievements/Epic/GOG są puste w tym snapshotcie, a część pól ma wartości sentinelowe lub niejawne enumy.
- Największe zmiany po researchu dotyczą nie UI, lecz modelu źródła: obecne `GameProvider` i `NormalizedGame` są providerowo/platformowe oraz ograniczone do Steam/PlayStation. Trzeba wprowadzić źródło `gametrack` i neutralny model kanoniczny, zachowując obecny planner, matcher i writer tam, gdzie nie wymuszają one provider-specific pól.
- Direct SQLite jest wykonalne, ale wymaga świadomego wyboru sterownika SQLite dla runtime Obsidiana oraz dekodera `NSKeyedArchiver` dla blobów platform i artworków. Bez tych dwóch decyzji nie należy zaczynać implementacji.

## Current architecture

### Model i provider layer

Obecny kod jest zaprojektowany wokół osobnych providerów Steam i PlayStation:

- `src/model/provider.ts` definiuje `GameProvider` jako union `'steam' | 'playstation'`, a nie interfejs źródła biblioteki.
- `src/providers/provider.ts` zawiera adapter z operacjami połączenia, testu połączenia, pobierania biblioteki i rozłączenia.
- `src/model/game.ts` trzyma `NormalizedProviderGame` oraz `NormalizedGame.providers`, czyli osobne stany per provider.
- `src/model/identity.ts` zna Steam App ID i kilka wariantów identyfikatorów PlayStation. Nie zna GameTrack UUID, IGDB ID ani Xbox.
- `src/model/achievement.ts` już ma neutralny kształt achievementu, ale obecny renderer i cache rozdzielają dane na Steam achievements i PlayStation trophies.

### Sync pipeline

Aktualny przepływ jest następujący:

```text
Steam/PlayStation adapter
  -> provider snapshots
  -> providerGameToNormalized()
  -> mergeProviderStates()
  -> SyncPlanner
  -> SyncExecutor
  -> Vault writer / history / cache / state
```

Najważniejsze elementy:

- `src/runtime/composition.ts` hardcoduje listę providerów Steam/PlayStation oraz ich adaptery.
- `src/runtime/actions.ts` i `src/runtime/commands.ts` mają komendy globalne oraz osobne komendy Steam/PlayStation.
- `src/sync/service.ts` jest głównym miejscem logiki provider snapshots, kompletności synchronizacji, ownership reduction, achievement cache, merge i freshness. To największy punkt refaktoru.
- `src/sync/planner.ts` buduje plan operacji na podstawie indeksu vaulta i fingerprintów.
- `src/sync/executor.ts` stosuje plan z kontrolą fingerprintu, aktualizuje state, history, cache i dziennik operacji.
- `src/vault/note-index.ts` indeksuje `game-sync-id`, Steam ID i warianty identyfikatora PlayStation. Brakuje IGDB ID, GameTrack ID i Xbox ID.
- `src/vault/matcher.ts` ma kolejność dopasowania: istniejące `game-sync-id`, provider ID, durable mapping, tytuł, nazwa pliku i tytuł z rokiem. Provider candidates są ograniczone do Steam/PlayStation.
- `src/vault/frontmatter.ts` oraz `src/vault/writer.ts` mają dobrą właściwość ochrony danych lokalnych: zapisują tylko przekazane managed properties i zachowują body oraz unmanaged frontmatter.
- `src/vault/managed-block.ts` i `src/vault/achievement-renderer.ts` mają osobne bloki Steam/PlayStation. Będzie potrzebny jeden blok GameTrack lub neutralny blok źródłowy, przy zachowaniu opcjonalnego poziomu szczegółowości.

### Mapping, state, metadata, Bases i UI

- `src/model/property-mapping.ts` ma wiele hardcoded pól providerowych: `steam-id`, `steam-owned`, `steam-playtime`, pola Steam achievements oraz analogiczne pola PlayStation. Aktualny walidator chroni pola użytkownika (`status`, `rating`, `favorite`, `review`, `notes`, `tags`) przed nadpisaniem.
- Domyślne properties obejmują zarówno pola neutralne (`platforms`, `playtime`, `last-played`, `owned`), jak i providerowe. Mapowanie trzeba uprościć, ale nie usuwać istniejących właściwości z notatek.
- `src/state/schema.ts`, `src/state/defaults.ts` i `src/state/migrations.ts` mają restrykcyjne uniony oraz allowlisty Steam/PlayStation. Migracja ustawień będzie zmianą schematu state, nie prostą podmianą stringa.
- `src/sync/cache.ts` używa kluczy `provider:key`; potrzebny będzie fingerprint znormalizowanego rekordu GameTrack oraz stan bazy (`mtime`, ewentualnie sygnatura schematu).
- `src/vault/history.ts` zapisuje provider-specific eventy i też ogranicza union do Steam/PlayStation.
- `src/vault/bases.ts` tworzy widoki Steam/PlayStation. Należy zachować integrację Bases, ale przeprojektować widoki na neutralne pola albo `gametrack`.
- `src/ui/settings/game-sync-settings.ts`, `src/ui/setup/setup-modal.ts`, `src/ui/settings/additional-settings-modal.ts` oraz diagnostyka są zbudowane wokół kont i połączeń Steam/PlayStation. Po migracji główną konfiguracją powinny być wykrywanie/ścieżka bazy, folder, zakres importu i mapping properties.
- `src/main.ts` rejestruje sieciowe adaptery, auth i modale połączeń. Te zależności powinny zniknąć z głównej ścieżki GameTrack, ale nie wolno usuwać ich przed decyzją o migracji ustawień i kompatybilności notatek.

### Obecne zasady własności danych

Obecny writer rozróżnia managed frontmatter od danych użytkownika i zachowuje ręcznie pisaną treść notatki. To należy zachować.

Ważne ograniczenie: `ZGAME.ZSTATUS` GameTrack ma wartości `Collection` i `Wanted`, ale nie jest odpowiednikiem lokalnego `status`. Nie można mapować go bezpośrednio na `status`, `rating`, `priority`, `favorite`, `review` ani `notes`.

## Current providers

W kodzie produkcyjnym obecnie występują:

| Provider w kodzie | Rola | Stan po migracji GameTrack |
|---|---|---|
| `steam` | API, auth, metadata, playtime i achievements | usunąć z głównej ścieżki lub zdeprecjonować etapowo |
| `playstation` | API, auth, playtime i trophies | usunąć z głównej ścieżki lub zdeprecjonować etapowo |
| `gametrack` | brak implementacji | główny provider odczytu |

W bazie GameTrack występują dodatkowo platformowe encje `XboxGame`, `EpicGame`, `GOGGame` i `RetroGame`. Nie należy tworzyć z nich providerów Game Sync. Są danymi platformowymi wewnątrz jednego źródła `gametrack`.

## GameTrack database discovery

### Wykryty plik

```text
~/Library/Containers/com.joekw.gametrack/Data/Library/Application Support/GameTrack/GameData.sqlite
```

Plik istnieje i ma rozmiar około 16.5 MB. Obok niego w czasie audytu były obecne:

```text
GameData.sqlite-wal  około 470 KB
GameData.sqlite-shm  32 KB
GameData_ckAssets/   katalog assetów
```

Alternatywna ścieżka bez sandbox container:

```text
~/Library/Application Support/GameTrack/GameData.sqlite
```

nie istniała.

W implementacji nie wolno przyjąć tej jednej ścieżki jako stałego kontraktu. Należy sprawdzać znane lokalizacje, ograniczony wzorzec kontenera GameTrack i ustawioną przez użytkownika ścieżkę ręczną. Każdą kandydaturę trzeba zweryfikować nagłówkiem SQLite, odczytem tabel i integrity check; nie wykonywać szerokiego skanowania przy każdej synchronizacji.

### Stan techniczny bazy

Potwierdzone read-only:

```text
journal_mode = wal
user_version  = 0
schema_version = 245
foreign_keys  = 0
auto_vacuum   = 2
quick_check   = ok
```

Baza ma metadane Core Data:

- `Z_METADATA` wskazuje `NSStoreType = SQLite`, wersję persistence framework 1629 i model Core Data zapisany jako binary plist.
- `Z_MODELCACHE` przechowuje cache modelu.
- `Z_PRIMARYKEY` mapuje encje Core Data na tabele `Z...`.
- `ANSCK...`, `ATRANSACTION`, `ATRANSACTIONSTRING` i `ACHANGE` są tabelami synchronizacji CloudKit/Core Data, a nie bezpośrednim modelem gier.

Wniosek: `PRAGMA user_version` nie daje wersji GameTrack. `detectGameTrackSchema()` musi rozpoznawać sygnaturę tabel, kolumn i model metadata. Przy nieznanej sygnaturze synchronizacja ma zakończyć się przed dotknięciem vaulta.

## Complete schema inventory

Pełny `.tables` oraz `.schema` zostały odczytane w aktualnym snapshotcie. Tabele są następujące:

```text
ACHANGE
ANSCKDATABASEMETADATA
ANSCKEVENT
ANSCKEXPORTEDOBJECT
ANSCKEXPORTMETADATA
ANSCKEXPORTOPERATION
ANSCKHISTORYANALYZERSTATE
ANSCKIMPORTOPERATION
ANSCKIMPORTPENDINGRELATIONSHIP
ANSCKMETADATAENTRY
ANSCKMIRROREDRELATIONSHIP
ANSCKMIRROREDRELATIONSHIPSYSTEMFIELDSASSET
ANSCKRECORDMETADATA
ANSCKRECORDMETADATAENCODEDRECORDASSET
ANSCKRECORDMETADATASYSTEMFIELDSASSET
ANSCKRECORDZONEMETADATA
ANSCKRECORDZONEMETADATAENCODEDSHAREASSET
ANSCKRECORDZONEMOVERECEIPT
ANSCKRECORDZONEQUERY
ATRANSACTION
ATRANSACTIONSTRING
ZCHALLENGE
ZEPICGAME
ZFRANCHISE
ZGAME
ZGAMEGRID
ZGAMEGRIDENTRY
ZGAMELINK
ZGAMERELEASE
ZGAMETAG
ZGENRE
ZGOGGAME
ZHIDDENGAME
ZHIDDENNEWSSOURCE
ZLINKEDGAME
ZLIST
ZPLAYSTATIONGAME
ZPLAYTHROUGH
ZPOSITION
ZRETROACHIEVEMENT
ZRETROGAME
ZSHAREDLIST
ZSHAREDLISTGAME
ZSMARTFILTER
ZSTEAMACHIEVEMENT
ZSTEAMGAME
ZSTOREDNEWSARTICLE
ZTRACKEDEVENT
ZTROPHIES
ZXBOXACHIEVEMENT
ZXBOXGAME
Z_4GAMEGENRES
Z_4GAMETAGS
Z_4LIST
Z_METADATA
Z_MODELCACHE
Z_PRIMARYKEY
```

Tabele Core Data service oraz `Z_PRIMARYKEY` również zostały uwzględnione w audycie, ale nie są źródłem kanonicznego modelu gry.

### Tabele domenowe i relacje

| Tabela | Rola i istotne pola | Liczba wierszy |
|---|---|---:|
| `ZGAME` | gra główna, `ZID`, `ZGAMEID`, tytuł, summary, daty, playtime, status, ocena, metadata, bloby i relacje do providerów | 207 |
| `ZSTEAMGAME` | Steam App ID, `ZPLAYTIMEFOREVER`, nazwa, icon/logo, ostatni unlock achievementu | 135 |
| `ZPLAYSTATIONGAME` | PS `ZSTOREID`, progress, play count, duration, first/last played, trophy relations i IDs usług | 97 |
| `ZXBOXGAME` | Xbox title/catalog IDs, achievements, gamerscore, progress, last played | 12 |
| `ZEPICGAME` | Epic catalog/product/namespace/acquisition | 0 |
| `ZGOGGAME` | GOG product/slug, playtime, macOS support | 0 |
| `ZRETROGAME` | RetroAchievements console/game IDs, earned/max counts | 0 |
| `ZSTEAMACHIEVEMENT` | indywidualne Steam achievements, unlock time, hidden, rarity i ikony | 1152 |
| `ZGAMETROPHY` | indywidualne PS trophies, earn date, type, hidden/rare i ikona | 58 |
| `ZXBOXACHIEVEMENT` | indywidualne Xbox achievements, score, secret, progress i unlock time | 225 |
| `ZTROPHIES` | podsumowanie typów PS trophies przez relacje `ZDEFINEDGAME`/`ZEARNEDGAME` | 435 |
| `ZGAMERELEASE` | wydania gry per platforma/region, data i rok | 202 |
| `ZPLAYTHROUGH` | playthrough, progress i daty start/finish | 207 |
| `ZGENRE` + `Z_4GAMEGENRES` | słownik i relacja gatunków | 20 + 601 |
| `ZGAMEGRID` + `ZGAMEGRIDENTRY` | grid; `ZIGDBGAMEID` istnieje, ale aktualnie brak wierszy | 0 + 0 |
| `ZGAMELINK`, `ZFRANCHISE`, `ZLINKEDGAME` | linkowanie/franczyzy | 0 / 0 / 0 |
| `Z_4GAMETAGS`, `Z_4LIST`, listy i filtry | tagi i organizacja biblioteki | obecnie brak relacji gier |
| `ZSTOREDNEWSARTICLE` | zapisane artykuły/news | 42 |
| `ZTRACKEDEVENT` | eventy śledzone | 0 |
| `ZRETROACHIEVEMENT` | indywidualne RetroAchievements | 0 |

Istotne kolumny `ZGAME`:

```text
Z_PK, Z_ENT, Z_OPT
ZGAMEID, ZID
ZTITLE, ZSUMMARY, ZDEVELOPER, ZPUBLISHER
ZSTEAMID, ZPLAYSTATIONID, ZXBOXID, ZOWNEDPLATFORM
ZSTATUS, ZUSERRATING, ZPRIORITY, ZCOMPLETION
ZHOURSPLAYED, ZADDITIONALPLAYTIME
ZADDEDDATE, ZSTARTDATE, ZFINISHDATE, ZPSNLASTUPDATED, ZRELEASEDATE, ZUPDATEDAT
ZRELEASEYEAR
ZPOSTERURL, ZBANNERURL, ZSITEURL
ZPLATFORMS, ZADDITIONALPLATFORMS, ZGENRES, ZARTWORK, ZSCREENSHOTS, ZVIDEOS
ZGAMESTATE, ZCOMPLETIONSTATE, ZSTEAMDECKSTATUS
ZSTEAMGAME, ZPLAYSTATIONGAME, ZXBOXGAME, ZEPICGAME, ZGOGGAME, ZRETROGAME
```

Wartości Core Data `TIMESTAMP` są sekundami od 2001-01-01, a nie Unix epoch. Dekoder musi konwertować je jawnie i tolerować `NULL` oraz wartości sentinelowe.

## Data availability

### Games and stable IDs

Potwierdzone:

- 207/207 gier ma tytuł `ZTITLE`.
- `ZGAME.ZID` jest obecne dla 207/207, ma 16 bajtów i jest unikalne.
- `ZGAME.ZGAMEID` jest obecne i unikalne dla 207/207. W połączeniu z nazwą pola oraz 207/207 URL-ami `images.igdb.com` w `ZPOSTERURL` jest to mocny dowód, że pole jest IGDB ID.
- `Z_PK` jest lokalnym kluczem Core Data i nie może stać się stabilnym ID notatki.
- `ZGAME.ZID` nie powinno być bezpośrednio serializowane jako nieczytelny blob. Trzeba potwierdzić encoding UUID na fixture i zapisać jako stabilny string.

Rekomendacja identyfikacji:

```text
1. istniejące mapowanie z notatki / state
2. GameTrack ZID
3. IGDB ZGAMEID
4. identyfikator platformowy jako pomoc w matchingu
5. tytuł + rok wyłącznie jako kandydat, nigdy jako automatyczne ID
```

### Platforms

`ZPLATFORMS` jest blobem binary plist `NSKeyedArchiver` zawierającym tablicę stringów. W snapshotcie występowały między innymi:

```text
PC, Steam, PS4, PS5, Switch, Series X, XONE, Stadia,
Android, WiiU, iOS, 3DS, Mac, Linux, X360, Win Phone, PS3, Vita
```

`ZPLATFORMS` występuje dla wszystkich 207 gier. `ZADDITIONALPLATFORMS` jest obecnie puste.

Należy wprowadzić jeden centralny mapping, np.:

```text
PS5       -> playstation-5
PS4       -> playstation-4
Switch    -> nintendo-switch
Series X  -> xbox-series
XONE      -> xbox-one
PC        -> pc
Mac       -> mac
Linux     -> linux
```

Nieznane wartości muszą być zachowane w formie stabilnego fallbacku i zgłoszone diagnostycznie, a nie cicho odrzucane.

### Ownership

Źródła danych:

- `ZOWNEDPLATFORM`: 202 niepuste wartości; najczęściej `PC` (122), `PS5` (54), `PS4` (25), `XONE` (1), 5 pustych.
- `ZSTATUS`: `Collection` (108), `Wanted` (27), 72 puste.
- relacje do `ZSTEAMGAME`, `ZPLAYSTATIONGAME` i `ZXBOXGAME` wskazują, że GameTrack ma powiązanie z platformą, ale samo powiązanie nie jest wystarczającym dowodem ownership.

Do modelu kanonicznego można przenieść `ownedPlatforms` jako fakt GameTrack, ale trzeba odróżnić:

```text
owned platform      = informacja źródłowa, jeżeli pole jest określone
Wanted              = status GameTrack, nie lokalny status notatki
provider relation   = obecność danych platformy, nie automatycznie ownership
```

Nie mapować `ZSTATUS` na użytkownikowe `status`.

### Playtime

Potwierdzone jednostki:

| Pole | Jednostka | Pokrycie | Uwagi |
|---|---|---:|---|
| `ZGAME.ZHOURSPLAYED` | godziny | 207/207 | wygląda na agregat; trzeba przeliczyć na minuty |
| `ZSTEAMGAME.ZPLAYTIMEFOREVER` | minuty | 135/135 | zgodne z konwencją Steam |
| `ZPLAYSTATIONGAME.ZPLAYDURATION` | godziny | 97/97 | wartości dziesiętne, dodatnie dla 71 gier |
| `ZXBOXGAME` | brak czasu gry | 12/12 | jest tylko last played |

W 198/207 rekordów `ZHOURSPLAYED` zgadza się z sumą platformowych wartości Steam + PlayStation. W 9 rekordach występują odchylenia, w tym duże anomalie dla Path of Exile 2, Path of Exile i No Man’s Sky. Nie wolno więc dodawać agregatu GameTrack do wartości platformowych.

Canonical representation powinna pozostać:

```ts
playtimeMinutes: number
```

Przed implementacją trzeba ustalić politykę konfliktu:

1. preferować `ZHOURSPLAYED` jako agregat GameTrack,
2. użyć wartości platformowych tylko jako fallbacku, gdy agregat jest brakujący,
3. nie sumować agregatu z platformami,
4. oznaczać anomalię w diagnostyce, nie nadpisywać nią po cichu lokalnej wartości.

### Last played and activity

- PS: `ZLASTPLAYED` ma wartości dla 68/97 gier; `ZFIRSTPLAYED` jest puste.
- Xbox: `ZLASTTIMEPLAYED` jest obecne dla 12/12, jako tekst ISO-8601 z `Z`.
- Steam: brak właściwego pola last played. `ZRECENTACHIEVEMENTUNLOCKTIME` jest obecne tylko dla 9 gier i nie może być traktowane jako last played.
- `ZPLAYTHROUGH` ma 207 wierszy, ale obecnie `ZDURATION=0`, brak dat start/finish i `ZPROGRESS=-1`; nie jest użytecznym źródłem historii aktywności.
- `ZADDEDDATE` jest obecne tylko dla 43 gier. `ZSTARTDATE`, `ZFINISHDATE` i `ZPSNLASTUPDATED` są puste w tym snapshotcie.

Można wyznaczyć `lastPlayed` jako najpóźniejszą znaną datę PS/Xbox, ale trzeba zachować `undefined`, gdy GameTrack nie ma danych. Nie wolno uzupełniać Steam achievement timestampem.

### Achievements and trophies

| Źródło | Dane | Pokrycie |
|---|---|---:|
| `ZSTEAMACHIEVEMENT` | nazwa, opis, unlocked, unlock time, hidden, rarity, ikony | 1152 rekordy / 18 gier |
| `ZGAMETROPHY` | typ, earned, earn date, hidden, rare, detail, ikona | 58 rekordów / 1 gra |
| `ZTROPHIES` | agregat PS bronze/silver/gold/platinum przez relacje | 435 rekordów; 27 gier ma defined/earned summary |
| `ZXBOXACHIEVEMENT` | score, secret, progress state, unlock time, ikona | 225 rekordów / 4 gry |
| `ZRETROACHIEVEMENT` | brak rekordów | 0 |

Steam:

- 57/1152 achievements ma `ZACHIEVED=1` i timestamp unlocku.
- Wszystkie rekordy mają nazwę/display name.
- `ZSYNCID` nie jest samodzielnie bezpiecznym kluczem: w snapshotcie występują powtórzenia. Używać klucza złożonego z gry i danych achievementu.

PlayStation:

- `ZPROGRESS` jest dostępne dla 97 gier.
- `ZDEFINEDTROPHIES` i `ZEARNEDTROPHIES` są zbudowane jako relacje do obiektów `ZTROPHIES`; `ZTOTAL` ma wartość sentinelową `0`, więc całkowity count trzeba wyznaczać z typów bronze/silver/gold/platinum.
- Indywidualny `ZGAMETROPHY` nie jest pełnym katalogiem PS w aktualnej bazie, bo dotyczy tylko jednej gry.

W pierwszej wersji należy synchronizować summary:

```yaml
achievements:
  unlocked: 31
  total: 50
  completion: 62
```

Indywidualne rekordy powinny mieć osobny, opcjonalny blok i jawnie wskazywać źródło/platformę. Nie należy zakładać, że brak szczegółów oznacza zero achievementów.

### Status, ratings and user metadata

- `ZSTATUS`: `Collection`/`Wanted`; to status GameTrack i nie może nadpisać lokalnego `status`.
- `ZUSERRATING=0` dla wszystkich 207 gier; traktować jako unset, nie jako ocenę zero.
- `ZPRIORITY=-1` dla wszystkich; sentinel, nie przenosić bez potwierdzenia semantyki.
- `ZCOMPLETION` jest dodatnie dla 49 gier, ale znaczenie enumów/semantyki nie zostało potwierdzone niezależnie.
- `ZNOTES`, `ZREVIEW` i `ZREVIEWID` są puste w tym snapshotcie.
- `ZGAMESTATE`, `ZCOMPLETIONSTATE`, `ZSTEAMDECKSTATUS` zawierają wartości enum/sentinel, których nie należy mapować bez testów z kontrolowanymi danymi.

Wniosek: pierwsza wersja nie importuje statusu, ratingu, priority, review ani notes do pól użytkownika. Mapping tych pól pozostaje możliwy, ale validator ma nadal odrzucać mapping źródłowy do user-owned properties.

### Metadata, artwork and auxiliary fields

Potwierdzone:

- `ZSUMMARY`: 207/207.
- `ZDEVELOPER`: 203/207; pojedynczy string.
- `ZPUBLISHER`: 200/207; pojedynczy string.
- `ZRELEASEDATE`: 202/207; timestamp Core Data.
- `ZRELEASEYEAR`: wartości głównie `0`, z outlierami `2026` i `3000`; nie używać bez walidacji jako głównego release year.
- `ZGENRE` blob jest pusty, ale relacja `Z_4GAMEGENRES -> ZGENRE` ma 601 wpisów i obejmuje wszystkie gry.
- `ZPOSTERURL` i `ZBANNERURL`: 207/207; URL-e IGDB.
- `ZARTWORK` i `ZSCREENSHOTS` są blobami binary plist `NSKeyedArchiver` zawierającymi listy URL-i IGDB.
- `ZVIDEOS` jest blobem listy identyfikatorów YouTube.
- `ZSITEURL` i `ZFIREGAMEID` są puste.
- HowLongToBeat: `ZTIMETOBEATSTORY` i `ZTIMETOBEATCOMPLETE` mają dodatnie wartości dla 88 gier, `ZTIMETOBEATEXTRAS` dla 86. Jest to opcjonalna metadata, nie część minimalnego modelu.

Nie wolno parsować blobów jako dowolnego JSON. Potrzebny jest izolowany decoder `NSKeyedArchiver` z testami fixture; przy nieznanym lub uszkodzonym blobie należy zgłosić ostrzeżenie i zachować rekord bez tej części metadata.

## Mapping GameTrack -> current Game Sync model

### Mapping docelowy

| GameTrack | Docelowy `CanonicalGame` | Obecny Game Sync | Decyzja |
|---|---|---|---|
| `ZID` | `externalIds.gametrack` | brak | dodać do indeksu i frontmatter |
| `ZGAMEID` | `externalIds.igdb` | brak | preferowany external ID, po walidacji |
| `ZTITLE` | `title` | `title` | zachować |
| `ZPLATFORMS` | `platforms[]` | `platforms` | centralny normalizer |
| `ZOWNEDPLATFORM` | `ownership[]` | `owned`, częściowo provider fields | nie mapować na lokalny status |
| provider relation + child IDs | `platformIds` / `externalIds` | Steam/PS identity | przechować jako dane platformowe źródła `gametrack` |
| `ZHOURSPLAYED` | `activity.playtimeMinutes` | `playtime` | godziny -> minuty; bez podwójnego sumowania |
| PS `ZLASTPLAYED`, Xbox `ZLASTTIMEPLAYED` | `activity.lastPlayed` | `last-played` | max znanej daty; Steam timestamp nie jest fallbackiem |
| achievement relations/children | `achievements` summary | provider achievement props/block | summary domyślnie; details opcjonalnie |
| `ZRELEASEDATE` | `metadata.releaseDate` | `released` | preferować datę, odrzucać sentinel |
| `ZDEVELOPER` | `metadata.developer[]` | `developers` | split/one-element normalizacja |
| `ZPUBLISHER` | `metadata.publisher[]` | `publishers` | split/one-element normalizacja |
| `ZGENRE` relation | `metadata.genres[]` | `genres` | join table, nie pusty blob |
| `ZSUMMARY` | `metadata.summary` | `description` | mapowanie neutralne |
| poster/artwork URLs | `metadata.cover` / assets | `cover` | zachować obecny cover support |
| `ZSTATUS`, `ZUSERRATING`, `ZNOTES`, `ZREVIEW` | brak domyślnego mapowania | user-owned fields | nie nadpisywać |

Proponowane rozszerzenie neutralnego modelu:

```ts
interface CanonicalGame {
  id: string;
  externalIds: {
    gametrack?: string;
    igdb?: number;
    steam?: string;
    playstation?: string;
    xbox?: string;
  };
  title: string;
  platforms: string[];
  ownership: { platform: string; owned: boolean }[];
  activity?: { playtimeMinutes?: number; lastPlayed?: string };
  achievements?: { total?: number; unlocked?: number; completion?: number };
  metadata?: {
    releaseDate?: string;
    developer?: string[];
    publisher?: string[];
    genres?: string[];
    summary?: string;
    cover?: string;
  };
}
```

To jest model źródłowo-neutralny. GameTrack-specific typy i dekoder nie powinny wyjść poza `src/providers/gametrack/`.

### Existing model gaps

Najważniejsze niezgodności:

1. `GameProvider` jest unionem dwóch platformowych providerów, więc nie można tylko dopisać `gametrack` bez zmiany semantyki.
2. `NormalizedGame.providers` wymusza osobny stan Steam/PlayStation, podczas gdy nowym źródłem ma być jeden provider zawierający platformy.
3. `NormalizedProviderGame` nie ma GameTrack UUID ani IGDB ID jako pierwszorzędnej tożsamości.
4. `createNormalizedGame()` sumuje playtime providerów; dla GameTrack byłoby to podwójne liczenie względem `ZHOURSPLAYED`.
5. `note-index`, `matcher`, durable mappings, history, cache i migrations mają allowlisty Steam/PlayStation.
6. Obecne identity mapping generuje losowy canonical ID, gdy nie ma mappingu. GameTrack daje lepszy stabilny identyfikator i nie wolno wracać do tytułu jako ID.
7. Achievements są renderowane per platforma; trzeba obsłużyć summary GameTrack bez udawania kompletnej listy.
8. `manifest.json` ma `isDesktopOnly: false`, a direct SQLite jest funkcją desktopową. Trzeba wybrać politykę: desktop-only albo bezpieczne ukrycie/wyłączenie GameTrack poza desktopem.

## Proposed architecture

```text
GameTrack GameData.sqlite (read-only, desktop)
  -> GameTrackPath
  -> GameTrackDatabase (SQL only)
  -> GameTrackSchema (detect + version adapter)
  -> GameTrackNormalizer (dates, IDs, plist blobs, platforms)
  -> CanonicalGame[]
  -> existing matching/planning/writing pipeline
  -> Obsidian Markdown
```

Proponowane granice:

```text
src/providers/gametrack/
  gametrack-provider.ts    # GameProvider/GameSource -> CanonicalGame[]
  gametrack-database.ts    # wyłącznie read-only queries
  gametrack-schema.ts      # signature, compatibility, version adapter
  gametrack-normalizer.ts  # GameTrackGame -> CanonicalGame
  gametrack-types.ts       # rows, relationships, raw blobs
  gametrack-path.ts        # discovery i walidacja ścieżki

src/core/
  game.ts                  # neutralny CanonicalGame
  provider.ts              # źródło biblioteki, nie platforma
  matching.ts              # ID-first matching
  sync-engine.ts           # niezależny od GameTrack i platform

src/sync/
  property-mapping.ts
  note-writer.ts
  sync-state.ts
```

Nie należy mechanicznie tworzyć wszystkich katalogów. Istniejące planner/executor/writer można zachować, jeżeli otrzymają neutralny model i provider source zamiast platformowego snapshotu.

### Provider interface

Obecny alias `GameProvider` należy rozdzielić od identyfikatorów źródła. Proponowane kierunki:

```ts
type ProviderId = 'gametrack';

interface GameProvider {
  readonly id: ProviderId;
  getLibrary(): Promise<CanonicalGame[]>;
}
```

Jeżeli kompatybilność z istniejącym adapter contract wymaga etapów, można wprowadzić `GameSourceAdapter`, ale UI i sync engine nie powinny znać Steam/PS jako niezależnych źródeł.

### Read-only SQLite policy

Każda synchronizacja:

```text
discover/validate path
  -> open read-only
  -> read transaction
  -> execute only SELECT / PRAGMA read-only checks
  -> close connection
```

Nie wykonywać `INSERT`, `UPDATE`, `DELETE`, migracji ani operacji zmieniających journal. Połączenie nie powinno żyć przez lifecycle Obsidiana. WAL musi być odczytywany z oryginalnym plikiem i sidecarami, bez kopiowania bazy, chyba że wybrany driver wymusi bezpieczną strategię.

## Files to modify

### Prawdopodobnie wymagane

- `src/model/provider.ts` — neutralny `ProviderId`/interfejs źródła.
- `src/model/game.ts`, `src/model/identity.ts`, `src/model/achievement.ts` — GameTrack/IGDB IDs, source-neutral activity i achievement summary.
- `src/model/operations.ts` — brak sumowania agregatu GameTrack z platformami; neutralne operacje.
- `src/providers/provider.ts` — adapter read-only GameTrack.
- nowy `src/providers/gametrack/*` — cała integracja SQLite i normalizacja.
- `src/sync/service.ts`, `src/sync/planner.ts`, `src/sync/executor.ts` — pobranie jednego źródła, fingerprint i incremental sync.
- `src/sync/cache.ts`, `src/sync/freshness.ts` — klucze i freshness dla GameTrack/bazy.
- `src/vault/note-index.ts`, `src/vault/matcher.ts` — `gametrack-id`, `igdb-id`, platform IDs, matching exact/ambiguous.
- `src/vault/frontmatter.ts`, `src/vault/writer.ts`, `src/vault/managed-block.ts` — neutralne pola, zachowanie user-owned properties i opcjonalny achievement block.
- `src/model/property-mapping.ts` — uproszczony mapping z kompatybilnością starych nazw.
- `src/state/schema.ts`, `src/state/defaults.ts`, `src/state/migrations.ts` — ustawienia GameTrack, migracja starego state, reset sync state.
- `src/vault/history.ts` — `gametrack`/neutral eventy przy zachowaniu istniejącej historii.
- `src/vault/bases.ts` — neutralne widoki i brak provider-specific filtrów jako głównej ścieżki.
- `src/runtime/composition.ts`, `src/runtime/actions.ts`, `src/runtime/commands.ts`, `src/runtime/registry.ts` — GameTrack provider, commands i diagnostics.
- `src/main.ts` — desktop capability, wykrywanie bazy, settings/setup/diagnostics i usunięcie obowiązkowych network auth.
- `src/ui/settings/game-sync-settings.ts`, `src/ui/settings/additional-settings-modal.ts`, `src/ui/setup/setup-modal.ts` — konfiguracja bazy, preview, opcje importu i diagnostics.
- `src/diagnostics/report.ts` — status bazy bez automatycznego ujawniania prywatnej ścieżki.
- `README.md`, `README.pl.md`, `manifest.json`, i18n oraz `styles.css` — dopiero po działającym adapterze i UI cleanup.

### Testy i fixtures

- nowe fixture SQLite z anonimowym, minimalnym schematem obejmującym: Steam, PS, Xbox, multi-platform, achievements i brakujące metadata;
- testy parsera schematu, `NSKeyedArchiver`, dat Core Data, platform mapping, playtime, matching, frontmatter merge i schema mismatch;
- testy integracyjne: pusty vault, istniejące notatki, partial/ambiguous matches, user properties, niedostępna baza i fingerprint unchanged.

## Files to remove or deprecate

Nie usuwać ich w Phase 1. Po przejściu migracji i testach:

- `src/providers/steam/*` — API, auth, metadata i achievement clients, jeżeli nie zostanie tryb legacy.
- `src/providers/playstation/*` — API, auth i trophy clients, jeżeli nie zostanie tryb legacy.
- provider-specific connect modals: `src/ui/steam-connect-modal.ts`, `src/ui/playstation-connect-modal.ts`.
- provider-specific settings, credentials i connection state z `src/main.ts` oraz UI.
- osobne commands `sync-steam`, `sync-playstation` i ich preview variants.
- provider-specific mapping keys, CSS i achievement rendering, jeżeli nie będą potrzebne do kompatybilności starych notatek.

Przed usunięciem trzeba zachować read-only migrator ustawień oraz rozpoznać stare properties. Nie usuwać żadnej właściwości z istniejącej notatki. Jeżeli kompatybilność wymaga okresu przejściowego, oznaczyć kod jako deprecated i usunąć dopiero w kolejnym kontrolowanym kroku.

## Migration strategy

1. Dodać wykrywanie `gametrack` i nowe ustawienia bez zmiany dotychczasowego sync behavior.
2. Zmigrować stare ustawienia providerów do jednego źródła tylko wtedy, gdy istnieje jednoznaczny stan; nie przenosić credentials ani network auth.
3. Rozszerzyć note index o `gametrack-id` i `igdb-id`, zachowując stare `steam-id`/PlayStation properties jako legacy matching aids.
4. Matchować w kolejności: istniejące mapping, GameTrack UUID, IGDB ID, platform ID, dokładny tytuł + rok. Nie scalać automatycznie kandydatów niepewnych.
5. Preview musi pokazać co najmniej: created, updated, unchanged, conflicts/possible matches.
6. Przy update writer przekazuje wyłącznie provider-managed fields. Nie dotyka `status`, `rating`, `priority`, `favorite`, `review`, `notes`, `tags` ani body.
7. Przy pierwszym imporcie można zachować dotychczasowe neutralne property names, a stare provider-specific properties nie usuwać automatycznie.
8. Dopiero po udanym imporcie i odczycie zwrotnym przełączyć domyślne komendy na `Game Sync: Sync library`.
9. Dopiero wtedy wykonać dead-code cleanup providerów i uproszczenie Settings.

Ważny warunek: zmiana `NormalizedGame.providers` na source-level `gametrack` może być breaking change dla state. Migracja musi zachować canonical mappings, ignored games, history i fingerprints albo jawnie oznaczyć pierwszą synchronizację jako pełny preview.

## Risks and stop conditions

### 1. Brak stabilnego, publicznego schematu

GameTrack może zmienić model Core Data bez zmiany `user_version`. Potrzebna jest sygnatura kolumn/relacji oraz adapter wersji. Unknown schema = stop, bez częściowego importu.

### 2. Runtime SQLite

Repo nie ma obecnie zależności SQLite. Należy zweryfikować, czy wybrany driver działa w wersji Electron/Node używanej przez Obsidiana i na macOS bez niekontrolowanego native ABI. To decyzja przed Phase 2.

### 3. NSKeyedArchiver

Platformy, artwork, screenshots i videos są binary plistami `NSKeyedArchiver`. Potrzebny jest testowany decoder. Nie wolno przyjąć, że każdy blob jest JSON-em albo pominąć go bez diagnostyki.

### 4. WAL i aktywny GameTrack

W czasie audytu baza miała świeży `-wal`. Testy muszą uruchamiać odczyt, gdy GameTrack działa, oraz potwierdzić brak locków i brak zmian w plikach bazy po synchronizacji.

### 5. Niejednoznaczne identyfikatory platform

- Steam: jeden orphan `ZSTEAMGAME`; dwa attached rows mają App ID różniące się od tekstowego `ZSTEAMID`, a dwa kolejne nie mają core `ZSTEAMID`.
- PS: `ZSTOREID` jest kompletnym i unikalnym ID child rows; `ZNPCOMMUNICATIONID` jest opcjonalne i ma duplikat, więc nie może być jedynym kluczem.
- Xbox ma osobne title/modern IDs oraz core catalog ID.

Te identyfikatory są pomocnicze w matchingu; GameTrack UUID/IGDB mają wyższy priorytet.

### 6. Playtime anomalies

9 rekordów nie zgadza się z prostą sumą platform. Należy oprzeć canonical playtime na agregacie GameTrack i raportować outliery.

### 7. Niekompletne achievements

Brak PS full listy dla większości gier, brak RetroAchievements w tym snapshotcie i częściowe Xbox/Steam coverage. Summary musi rozróżniać `unknown` od zero.

### 8. Desktop-only capability

Direct local SQLite nie pasuje do `isDesktopOnly: false`. Trzeba uzgodnić zachowanie web/mobile przed publikacją: feature unavailable z czytelnym komunikatem albo zmiana manifestu, jeśli cały plugin wymaga desktopu.

### 9. Obecny technical debt state

Uniony providerów są powielone w state, history, cache, migrations, runtime i UI. Jest też niespójność między obsługą operacji unmerge a restrykcyjnym parserem migracji. Refactor GameTrack powinien objąć te miejsca testami, ale nie wykorzystywać tej migracji do niepowiązanego cleanupu.

## Implementation sequence after research

### Phase 1 — research (completed)

- audyt repozytorium;
- wykrycie aplikacji i bazy;
- pełny inventory `.tables`/`.schema`;
- odczyt coverage, relacji, jednostek i sentinel values;
- mapping i lista breaking changes.

### Phase 2 — provider prototype

- najpierw wybrać i zweryfikować SQLite runtime oraz decoder plist;
- dodać `GameTrackSchema` z wykrywaniem sygnatury;
- zaimplementować read-only `GameTrackDatabase` z krótką transakcją;
- zaimplementować `GameTrackNormalizer` i platform mapping;
- test `SQLite fixture -> CanonicalGame[]`;
- bez UI i bez zapisu do vaulta.

### Phase 3 — sync integration

- podłączyć canonical source do obecnego planner/executor;
- rozszerzyć index i matching o GameTrack/IGDB;
- dodać merge frontmatter zachowujący user-owned data;
- fingerprint i skip unchanged;
- preview i raport konfliktów;
- integracyjne testy vaulta.

### Phase 4 — settings, setup, diagnostics

- autodetection + ręczna ścieżka;
- setup z liczbą gier/platform/achievementów;
- ustawienia zakresu sync;
- diagnostics i copy diagnostics z redakcją prywatnej ścieżki;
- komendy neutralne: sync library, preview, selected game, open in GameTrack, rebuild Base.

### Phase 5 — migration and cleanup

- migracja state/settings;
- okres kompatybilności starych properties;
- dopiero po potwierdzonym działaniu usunięcie providerów Steam/PlayStation, credentials, auth i UI;
- cleanup CSS, typów, dokumentacji i testów.

### Phase 6 — achievements

- summary jako domyślny zakres;
- szczegóły za opcją, dopiero gdy schema/coverage są wystarczające;
- brak scrapingowych obejść.

## Acceptance status after research

| Kryterium | Status | Dowód / brak |
|---|---|---|
| automatyczne wykrywanie GameTrack | częściowo potwierdzone | plik istnieje; brak implementacji |
| read-only odczyt biblioteki | potwierdzone na poziomie narzędzia | SQLite `-readonly`, `quick_check=ok`; brak adaptera |
| poprawny `CanonicalGame` | do implementacji | dane są dostępne, model jeszcze nie |
| import do Obsidiana | nie rozpoczęto | zgodnie z zakresem research |
| brak duplikatów | obecny matcher częściowy | brak GameTrack/IGDB indexu |
| playtime/platforms | dane dostępne z wyjątkami | jednostki i 9 anomalii opisane wyżej |
| achievement summary | dostępny częściowo | Steam/PS/Xbox; PS details niepełne |
| ochrona danych użytkownika | obecny writer spełnia założenie | trzeba zachować w integracji |
| Preview Sync | istniejący mechanizm do rozszerzenia | brak GameTrack source |
| unchanged skip | istniejące fingerprinty do rozszerzenia | potrzebny fingerprint GameTrack |
| unknown schema stop | brak | wymaga `detectGameTrackSchema()` |
| cleanup providerów | nie wykonano | cel późniejszej fazy |
| wszystkie testy | nie uruchamiano | brak zmian kodu w tym etapie |

## Finding końcowy

Najlepszy kierunek to zachowanie istniejących planner/matcher/writer/executor jako infrastruktury synchronizacji i wymiana provider layer na jeden read-only adapter GameTrack. Nie należy przepisywać całej wtyczki ani przenosić logiki platform do UI.

Jednocześnie direct SQLite nie jest jeszcze bezwarunkowo gotowy do implementacji: przed Phase 2 trzeba zamknąć decyzję o sterowniku SQLite, decoderze `NSKeyedArchiver`, desktop capability i polityce dla dziewięciu anomalii playtime. Do czasu tych decyzji bezpieczny stan to research-only oraz ewentualny późniejszy prototyp na anonimowym fixture.

GameTrack ma również oficjalny mechanizm CSV export/import od wersji 6.0, ale kształt CSV nie był częścią tego audytu. Warto zweryfikować go jako awaryjny/importowy provider w osobnym etapie; nie zmienia to priorytetu direct SQLite w tym planie. Źródło: [GameTrack Release Notes](https://gametrack.app/change-log).
