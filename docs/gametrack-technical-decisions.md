# GameTrack technical decisions

Data probe: 2026-09-14, macOS, GameTrack 6.1.5 (`CFBundleVersion 1018`).

Ten dokument zamyka Phase 1.5. Nie implementuje `GameTrackProvider`, nie podłącza readera do sync engine i nie zmienia Settings, Setup, commands, Bases ani property mappings.

## Decision summary

| Decyzja | Wynik |
|---|---|
| SQLite runtime | Jednorazowy `/usr/bin/sqlite3`, uruchamiany przez wstrzykiwany process runner; `-readonly -batch -json`, `shell: false`. |
| NSKeyedArchiver | Minimalny, defensywny decoder binary plist/NSKeyedArchiver ograniczony do struktur zaobserwowanych w GameTrack. |
| Game identity | `ZID` jest wysokiej pewności wewnętrznym ID GameTrack; `ZGAMEID` jest potwierdzonym w próbce IGDB numeric ID. |
| Playtime | Wewnętrznie obserwacje per platforma w minutach; canonical scalar preferuje agregat GameTrack, bez sumowania z platformami. |
| Platform support | Tylko macOS desktop dla bezpośredniej bazy SQLite; Windows, Linux i mobile są obecnie unsupported. |

## Scope and evidence

Probe korzystał z istniejącej lokalnej instalacji GameTrack i wyłącznie z odczytu. Nie wykonywano `INSERT`, `UPDATE`, `DELETE`, migracji ani zmian konfiguracji bazy. Fixture w repozytorium jest anonimową, małą bazą utworzoną na podstawie schematu; nie jest kopią bazy użytkownika.

Rzeczywista baza:

```text
~/Library/Containers/com.joekw.gametrack/Data/Library/Application Support/GameTrack/GameData.sqlite
```

W snapshotcie były aktywne sidecary `GameData.sqlite-wal` i `GameData.sqlite-shm`. Odczyt przez CLI zwrócił 207 gier i poprawnie uwzględnił dane z WAL.

Ważne rozróżnienie: samo otwarcie GameTrack spowodowało naturalną zmianę bazy/WAL przed wykonaniem snapshotu dla testu „app open”. Nie przypisuję tej zmiany readerowi. W czasie pasywnej obserwacji trwającej około 10 sekund nie zaobserwowano kolejnego naturalnego zapisu równolegle z odczytem. Nie wymuszano żadnej zmiany w GameTrack.

## ADR-1: SQLite runtime

### Tested approaches

#### `/usr/bin/sqlite3`

Lokalna wersja:

```text
3.54.0 2026-04-09 ... (64-bit)
```

Potwierdzone:

- `-readonly -batch -json` odczytuje rzeczywistą bazę;
- WAL jest czytany z oryginalnego pliku razem z sidecarami;
- `SELECT count(*) FROM ZGAME` zwraca `207`;
- BLOB-y można bezpiecznie pobrać jako `hex(column)` zamiast używać tekstowej reprezentacji CLI;
- process runner używa `spawn`, `shell: false`, argumentów przekazywanych jako tablica i kończy proces po zamknięciu strumieni;
- wartości SQL są przekazywane przez CLI parameter table, a stringi są serializowane jako wartości JSON-quoted; test apostrofu (`O'Reilly`) przeszedł;
- reader wykonuje jednorazowy proces na zapytanie i nie utrzymuje połączenia przez lifecycle Obsidiana;
- brak zapisu do celu jest wymuszony podwójnie: reader dopuszcza tylko pojedyncze `SELECT`/read-only `PRAGMA`, a proces dostaje `-readonly`; ścieżka bazy jest przekazana jako argument, bez shell interpolation.

Reader ma granicę:

```ts
export interface SqliteReader {
  query<T>(sql: string, params?: readonly SqliteParameter[] | Readonly<Record<string, SqliteParameter>>): Promise<T[]>;
}
```

`SqliteCliReader` zna tylko argumenty CLI, structured JSON i błędy. Process runner jest wstrzykiwany, więc dalszy provider nie zależy od `child_process` ani od konkretnego runtime. W tym spike'u rzeczywisty runner CLI znajduje się w harnessie testowym; nie został jeszcze wpięty do bundla pluginu.

### WAL and file-integrity checks

Przed i po odczycie porównywano rozmiar, mtime i SHA-256 dla:

```text
GameData.sqlite
GameData.sqlite-wal
GameData.sqlite-shm
```

Wyniki:

- test przy zamkniętym GameTrack: `REAL_DB_FILE_STATE=UNCHANGED`;
- test przy uruchomionym GameTrack: `OPEN_APP_READER_FILE_STATE=UNCHANGED`;
- końcowy przebieg realnej bazy: wszystkie 14 testów przeszło, a świeży snapshot przed/po zachował identyczne wartości:

```text
sqlite  91d797c5b6ced43f36df866ef6f51336b5c43cac97da9af6ed3993b47f7d4f35
wal     92b2858803b2b7e9dfa9aaec11a85d47f44e47d532fb5e595cb81018bebe1f32
shm     3fa8a8034b8d7aa54b939453e923a330e08b15a9f3855f45556b3e60a5a2560d
```

Wartości przed i po były też identyczne dla każdego z wcześniejszych snapshotów zamkniętej i otwartej aplikacji. Próba systemowego sprawdzenia listy procesów (`pgrep`/`ps`) była ograniczona przez sandbox systemowy; nie zaobserwowano orphan processów, a testowy runner otrzymał zdarzenie `close` dla każdego procesu.

### Pure JS / WASM

Wariant odrzucony dla v1. Nie dodano zależności i nie wykonano na niej odczytu realnej bazy, więc ta część jest oceną techniczną na podstawie dokumentacji, nie wynikiem benchmarku.

- [sql.js](https://github.com/sql-js/sql.js/) ładuje plik SQLite do pamięci i wymaga dostarczenia modułu WASM. Jego typowy model nie daje bezpośredniego dostępu do pliku wraz z aktywnym WAL; potrzebny byłby dodatkowy VFS/bezpieczny snapshot sidecarów.
- Oficjalny [SQLite WASM wrapper](https://github.com/sqlite/sqlite-wasm) ma w aktualnym modelu Node ograniczenia dotyczące trwałego dostępu do pliku i wymaga dodatkowej konfiguracji workerów/VFS. Nie rozwiązuje prosto odczytu istniejącej bazy GameTrack otwartej przez Core Data.
- Kopiowanie aktywnej bazy nie jest akceptowalnym domyślnym obejściem: wymagałoby poprawnego snapshotu `sqlite` + WAL/SHM i zwiększałoby powierzchnię błędu.

Wniosek: pure JS/WASM jest potencjalnym późniejszym fallbackiem tylko po osobnym dowodzie poprawnej obsługi WAL, nie dla pierwszej wersji.

### Native Node SQLite

| Opcja | Ocena |
|---|---|
| `better-sqlite3` | Technicznie wygodny, ale jest native addonem (`.node`). Dystrybucja community pluginu wymaga zgodnych binariów macOS ARM/x86 i odporności na zmiany Electron ABI. Odrzucony. |
| `sqlite3` | Ma prebuilt targets, w tym macOS ARM/x86, ale nadal dystrybuuje native binaries i wprowadza cykl zgodności z Electron/Node. Odrzucony. |
| `node:sqlite` | Odczyt realnej bazy przeszedł lokalnie w Node `v26.8.1` z `readOnly: true`, ale API jest zależne od wersji wbudowanego Node/Electron. Nie ma potwierdzenia dostępności w każdej wspieranej wersji Obsidiana. Nie wybieram go jako minimalnego runtime v1. |

Oficjalne materiały: [Node.js SQLite](https://nodejs.org/api/sqlite.html), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [node-sqlite3](https://github.com/TryGhost/node-sqlite3).

### Chosen approach

Na v1 wybieramy jednorazowy `/usr/bin/sqlite3` przez mały, testowalny `SqliteReader` i wstrzykiwany runner. Każde zapytanie ma być `SELECT`/read-only check, proces ma być zamykany po odczycie, a WAL ma być czytany z oryginalnej lokalizacji.

Fallback v1: jeśli CLI nie istnieje albo zwraca błąd, provider kończy się czytelnym błędem diagnostycznym i nie modyfikuje vaulta. Nie dodajemy native addonów ani nie kopiujemy aktywnej bazy. `node:sqlite` może wrócić jako wariant po ustaleniu minimalnego runtime Obsidiana; CSV pozostaje osobnym przyszłym providerem.

### Remaining runtime blocker

Nie wykonano jeszcze testu end-to-end z kodem readera załadowanym przez rzeczywisty embedded runtime Obsidian Desktop. To jest blokada przed Phase 2, nie powód do rozszerzania spike'u.

## ADR-2: NSKeyedArchiver decoding

### Fields requiring decoding

| Tabela | Kolumna | Zaobserwowany typ | Przykładowa wartość semantyczna | Wymagana v1 |
|---|---|---|---|---|
| `ZGAME` | `ZPLATFORMS` | BLOB, binary plist, `NSKeyedArchiver`, root `NSArray<NSString>` | `['PC']`, `['PS5']`, `['Steam', 'PC']` | Tak |
| `ZGAME` | `ZARTWORK` | BLOB, binary plist, `NSKeyedArchiver`, root array stringów | URL-e artworków IGDB | Opcjonalnie, cover |
| `ZGAME` | `ZSCREENSHOTS` | BLOB, binary plist, `NSKeyedArchiver`, root array stringów | URL-e screenshotów IGDB | Opcjonalnie |
| `ZGAME` | `ZVIDEOS` | BLOB, binary plist, `NSKeyedArchiver`, root array stringów | identyfikatory YouTube | Opcjonalnie |
| `ZGAME` | `ZADDITIONALPLATFORMS` | BLOB/NULL; w snapshotcie puste | brak dodatkowych platform | Nie w snapshotcie |
| `ZGAME` | `ZGENRES` | BLOB/NULL; w snapshotcie puste | brak wartości do dekodowania | Nie; gatunki są w join table |

Wszystkie cztery użyteczne blob fields `ZPLATFORMS`, `ZARTWORK`, `ZSCREENSHOTS` i `ZVIDEOS` były niepuste w 207/207 rekordach. Ich wartości zaczynały się od `bplist00`; długości były zgodne z binary plist, a nie z JSON-em. `Z_METADATA` i `Z_MODELCACHE` również zawierają dane Core Data, ale nie są rekordowymi polami gry i nie wchodzą do tego decoder prototype.

### Prototype result and scope

`decodeGameTrackValue()`:

- sprawdza nagłówek binary plist i trailer;
- odczytuje wymagane typy binary plist, referencje i UID;
- rozpakowuje `NSKeyedArchiver` tylko do tablicy wartości;
- akceptuje wyłącznie root array primitive stringów, bo taki kształt wystąpił w GameTrack 6.1.5;
- ma limity liczby obiektów, głębokości i rozmiaru kolekcji;
- zwraca `DecodeResult<T>`, a uszkodzone/nieobsługiwane dane nie rzucają wyjątku do całego pipeline'u.

Prototype przeszedł na rzeczywistym `ZPLATFORMS` oraz na rzeczywistych `ZARTWORK`, `ZSCREENSHOTS` i `ZVIDEOS` pobranych jako hex. Fixture ma anonimową wartość `['PC']`. Wartość `bplist00` bez poprawnego archiwum zwraca `invalid-archive`.

Zakres celowo nie obejmuje ogólnego `NSKeyedUnarchiver`, klas Foundation, obiektów modelu Core Data ani dowolnych transformable values. Każdy nowy kształt wymaga osobnego fixture i decyzji.

Reguła użycia:

```text
decode one field
→ on error: preserve record, omit only that field, add diagnostic
→ do not abort the whole library sync
```

Jeśli w przyszłości uszkodzone będzie pole wymagane do identyfikacji rekordu, decyzja o pominięciu rekordu należy do normalizera, ale nie może uszkodzić ani częściowo zapisać vaulta.

## ADR-5: Game identity

### `ZID`

Wszystkie 207 rekordów mają niepuste `ZID` o długości 16 bajtów; wartości są unikalne. `ZID` nie jest traktowane jako `Z_PK` ani jako tekstowy UUID. Prototype serializuje je bez utraty bajtów jako:

```text
gametrack:<lowercase hex>
```

Wniosek: `ZID` ma wysoką pewność jako wewnętrzne, stabilne ID GameTrack. Nie ma podstaw, by przypisywać mu publiczną semantykę UUID.

### `ZGAMEID` and independent sample

`ZGAMEID` jest niepuste i unikalne dla 207/207 rekordów. Hipotezę „`ZGAMEID` = IGDB numeric ID” sprawdzono poza samą korelacją nazw: dla 21 reprezentatywnych gier porównano wartość z niezależnym publicznym rekordem `Internet Game Database numeric game ID` w Wikidata (property P9043).

| Gra w bazie GameTrack | `ZGAMEID` | Relacje platformowe w snapshotcie | Niezależne potwierdzenie |
|---|---:|---|---|
| Dead Space 2 | 38 | Steam | [Wikidata](https://www.wikidata.org/wiki/Q842431) |
| Syberia | 890 | Steam | [Wikidata](https://www.wikidata.org/wiki/Q580202) |
| Dead Space 3 | 1216 | Steam | [Wikidata](https://www.wikidata.org/wiki/Q2501242) |
| Terraria | 1879 | Steam, PlayStation | [Wikidata](https://www.wikidata.org/wiki/Q332697) |
| Fortnite | 1905 | PlayStation, Xbox | [Wikidata](https://www.wikidata.org/wiki/Q113621883) |
| The Last of Us Remastered | 6036 | PlayStation | [Wikidata](https://www.wikidata.org/wiki/Q19057897) |
| Dwarf Fortress | 6341 | Steam | [Wikidata](https://www.wikidata.org/wiki/Q248810) |
| Zombie Night Terror | 9546 | Steam | [Wikidata](https://www.wikidata.org/wiki/Q89409315) |
| Scorn | 19817 | Xbox | [Wikidata](https://www.wikidata.org/wiki/Q48988603) |
| Doom Eternal | 103298 | PlayStation | [Wikidata](https://www.wikidata.org/wiki/Q130721154) |
| Overcooked! 2 | 103341 | Steam, PlayStation | [Wikidata](https://www.wikidata.org/wiki/Q55713667) |
| Minecraft Dungeons | 110474 | PlayStation, Xbox | [Wikidata](https://www.wikidata.org/wiki/Q64624106) |
| God of War Ragnarök | 112875 | PlayStation | [Wikidata](https://www.wikidata.org/wiki/Q130721424) |
| Ghostrunner | 121752 | PlayStation | [Wikidata](https://www.wikidata.org/wiki/Q96035161) |
| Townscaper | 135789 | Steam | [Wikidata](https://www.wikidata.org/wiki/Q97574737) |
| Tetris Effect: Connected | 135999 | PlayStation | [Wikidata](https://www.wikidata.org/wiki/Q121009380) |
| PowerWash Simulator | 138590 | Steam, PlayStation | [Wikidata](https://www.wikidata.org/wiki/Q107303968) |
| Frostpunk 2 | 164290 | Steam | [Wikidata](https://www.wikidata.org/wiki/Q109906111) |
| Marvel Snap | 202279 | Steam | [Wikidata](https://www.wikidata.org/wiki/Q130721420) |
| Pentiment | 204623 | Steam, Xbox | [Wikidata](https://www.wikidata.org/wiki/Q112432074) |
| NBA 2K23 | 207393 | PlayStation | [Wikidata](https://www.wikidata.org/wiki/Q130721411) |

Wynik próbki:

```text
sample size: 21
independent matches: 21
false matches: 0
```

Operacyjna ocena: `ZID` = `high confidence`, `ZGAMEID` = `confirmed for this sample`. To nadal nie jest publiczny kontrakt GameTrack; normalizer musi wykrywać brak/zmianę pola i zachować fallback.

Kolejność identyfikacji dla przyszłego matchera:

```text
1. existing Obsidian mapping
2. GameTrack ZID
3. IGDB ZGAMEID, jeśli schema validator potwierdzi pole
4. platform identifiers as matching evidence
5. normalized title + release year only as ambiguous candidate
```

Nie używać samego tytułu jako stabilnego ID i nie używać `Z_PK`.

## ADR-4: playtime

### Observed sources and units

| Tabela/kolumna | Źródło | Jednostka surowa | Normalizacja | Pewność |
|---|---|---|---|---|
| `ZGAME.ZHOURSPLAYED` | GameTrack aggregate | godziny | `hours * 60` | high |
| `ZSTEAMGAME.ZPLAYTIMEFOREVER` | Steam observation | minuty | bez konwersji | high |
| `ZPLAYSTATIONGAME.ZPLAYDURATION` | PlayStation observation | godziny | `hours * 60` | medium |
| `ZXBOXGAME` | Xbox | brak playtime | brak | n/a |

Pokrycie snapshotu: GameTrack 207/207, Steam 135/135, PlayStation 97/97, Xbox 12/12 bez pola czasu. Wartości nie zostały uznane za równoważne tylko na podstawie podobnej wielkości; jednostki wynikają z nazw/pól i porównania z danymi platformowymi.

### Canonical model

Wewnętrzna reprezentacja to minuty i obserwacje z provenance:

```ts
interface PlaytimeObservation {
  source: 'steam' | 'playstation' | 'xbox' | 'gametrack';
  rawValue: number | null;
  rawUnit: 'minutes' | 'hours' | 'unknown';
  normalizedMinutes?: number;
  confidence: 'high' | 'medium' | 'low';
  valid: boolean;
}

interface CanonicalPlaytime {
  minutes?: number;
  source?: 'steam' | 'playstation' | 'xbox' | 'gametrack';
  confidence?: 'high' | 'medium' | 'low';
  observations: readonly PlaytimeObservation[];
  anomalies: readonly PlaytimeAnomaly[];
}
```

### Compared policies

| Wariant | Ocena |
|---|---|
| A — suma wiarygodnych platform | Odrzucony jako domyślny scalar: miesza obserwacje, może podwójnie liczyć ten sam agregat i zakłada addytywność różnych źródeł. |
| B — maksimum platform | Odrzucony: ukrywa aktywność na innych platformach i nadal nie rozwiązuje konfliktu jednostek/proweniencji. |
| C — tylko per-platform | Zachowany wewnętrznie zawsze; dobry jako szczegółowy model, ale bez agregatu nie daje jednej bezpiecznej wartości `playtime`. |

### Chosen policy

```text
valid GameTrack aggregate → canonical scalar, including zero
no aggregate + exactly one valid platform → that platform as scalar
no aggregate + multiple valid platforms → no scalar; retain observations
aggregate + platform observations → do not sum; retain both and report anomaly if they disagree
```

To jest aggregate-first z bezwarunkowym zachowaniem obserwacji per platforma. Jeśli Markdown potrzebuje pojedynczego `playtime`, pochodzi on z agregatu GameTrack, a nie z `gametrack + Steam + PS`.

### Anomaly policy

- valid and finite value: normalize;
- `null`, negative, non-finite or unknown unit: mark invalid, exclude from canonical scalar, preserve diagnostic observation;
- aggregate plus co najmniej dwie poprawne platform observations: porównaj agregat z sumą wyłącznie diagnostycznie;
- różnica większa niż 1 minuta: `aggregate-platform-disagreement`;
- nie koryguj wartości heurystycznie.

W aktualnym snapshotcie 198/207 rekordów zgadzało się z prostą sumą Steam + PlayStation, ale 9 nie. Przykładowe rozbieżności obejmowały Path of Exile 2, Path of Exile, No Man's Sky, Cyberpunk 2077 i Balatro. To wystarcza, aby odrzucić bezpośrednie sumowanie jako canonical policy.

## Additional observations: activity and achievements boundary

To nie jest osobny wybór wymagany przez spike, ale wpływa na provenance playtime:

- PS `ZLASTPLAYED` i Xbox `ZLASTTIMEPLAYED` mogą dostarczyć `lastPlayed`;
- Steam achievement unlock time nie jest `lastPlayed`;
- `ZSTEAMACHIEVEMENT`, `ZGAMETROPHY`/`ZTROPHIES` i `ZXBOXACHIEVEMENT` dostarczają danych achievementowych, ale coverage jest częściowe;
- w snapshotcie nie ma rekordów `ZRETROACHIEVEMENT`;
- status GameTrack (`ZSTATUS`) i rating (`ZUSERRATING=0`) nie są źródłem lokalnych user-owned properties.

Kontrola `sqlite_master` potwierdziła, że `ZGAMETROPHY` rzeczywiście istnieje obok `ZTROPHIES`, `ZSTEAMACHIEVEMENT`, `ZXBOXACHIEVEMENT` i `ZRETROACHIEVEMENT`. Jej brak w tabelarycznej liście „complete schema” z wcześniejszego researchu jest błędem dokumentacyjnym, nie różnicą w aktualnym schema.

Właściwy `GameTrackProvider` powinien zwracać summary achievements z informacją o nieznanej kompletności, a szczegóły traktować opcjonalnie. Ten spike nie implementuje ich normalizacji.

## ADR-3: Platform and capability support

Direct SQLite provider v1 deklaruje capability, nie rozsypuje checks hosta po UI:

| Host | Desktop | Mobile | Provider supported | Automatic sync | Playtime | Achievements |
|---|---:|---:|---:|---:|---:|---:|
| macOS | yes | no | yes | yes | yes | yes |
| Windows | no | no | no | no | no | no |
| Linux | no | no | no | no | no | no |
| iOS | no | no | no | no | no | no |
| iPadOS | no | no | no | no | no | no |
| Android | no | no | no | no | no | no |

`mobile: false` oznacza brak bezpośredniego dostępu do lokalnej bazy przez ten provider, a nie zakaz istnienia pluginu mobilnego. Późniejszy `GameTrackCsvProvider` może mieć inną macierz capability.

Nie zmieniono `manifest.json` ani mobile bundle. Kod spike'u nie jest importowany przez `src/main`, więc nie rozszerza wymagań runtime obecnej wersji pluginu.

## Risks and blockers before Phase 2

1. Trzeba wykonać test procesu CLI w rzeczywistym embedded runtime Obsidiana Desktop, z zachowaniem `shell: false` i obsługą ścieżki z odstępami.
2. Nie zaobserwowano naturalnego zapisu GameTrack równolegle z readerem; wykonano tylko pasywne okno obserwacji. Nie wolno uznać tego scenariusza za empirycznie potwierdzony.
3. Schema GameTrack jest prywatnym modelem Core Data; `PRAGMA user_version=0` nie identyfikuje wersji. Phase 2 musi dodać schema signature/adapter i stop przy unknown schema.
4. Decoder obsługuje wyłącznie obecny kształt tablic stringów. Zmiana transformable class wymaga nowego adaptera.
5. `ZGAMEID` jest potwierdzone w próbce 21/21, ale nie jest udokumentowanym kontraktem GameTrack. Należy zachować walidację i fallback.
6. Playtime ma znane anomalie oraz źródła o różnej kompletności. Canonical value musi zachować provenance i nie może usuwać observations.
7. Achievements są częściowe: brak RetroAchievements w snapshotcie, pełne PS trophy details tylko dla części danych, a summary nie zawsze oznacza kompletną listę.
8. Brak pure JS/WASM fallbacku w v1 oznacza, że brak `/usr/bin/sqlite3` blokuje bezpośredni provider na macOS.
9. Nie zaimplementowano jeszcze `GameTrackProvider`, schema detectora, ścieżki discovery ani migracji. To świadome zatrzymanie przed Phase 2.

## Files added

- `src/providers/gametrack/spike/sqlite-reader.ts`
- `src/providers/gametrack/spike/transformable.ts`
- `src/providers/gametrack/spike/identity.ts`
- `src/providers/gametrack/spike/playtime.ts`
- `src/providers/gametrack/spike/capabilities.ts`
- `tests/fixtures/gametrack/technical-spike.sql`
- `tests/gametrack-technical-spike.test.ts`
- `docs/gametrack-technical-decisions.md`

Existing unrelated dirty files were left untouched. No real GameTrack database file was added to the repository.

## Tests and verification

| Check | Result |
|---|---|
| focused fixture tests | pass: 10 tests without real DB |
| focused tests with real GameTrack DB | pass: 13 tests |
| real DB closed/open file state | unchanged for `sqlite`, `-wal`, `-shm` |
| `/usr/bin/sqlite3` read-only query | pass: 207 games |
| local `node:sqlite` read-only probe | pass locally in Node v26.8.1; not selected |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run build` | pass |
| `npm test` full suite | pass: 58 files, 366 passed, 3 skipped |
| `npm run check:mobile-bundle` | pass: `main.js` verified |
| `npm run release:check` | pass for `26.9.0` |
| `git diff --check` | pass |

Pełny suite został uruchomiony bez wskazywania prywatnej bazy, dlatego dwa testy realnej bazy pozostają testami opt-in i są uruchamiane osobno z `GAMETRACK_SPIKE_DB`. Przebieg z rzeczywistą bazą zakończył się wynikiem 14/14.

## Stop condition

Technical spike kończy się tutaj. Następny krok wymaga osobnej akceptacji decyzji i dopiero wtedy może rozpocząć implementację:

```text
GameTrackProvider
→ GameTrackDatabase
→ GameTrackNormalizer
→ CanonicalGame
→ existing sync engine
```
