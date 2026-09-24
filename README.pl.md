# Game Sync

Game Sync synchronizuje eksporty GameTrack oraz dane Steam i PlayStation do zwykłych notatek Markdown w Obsidianie.

## Funkcje

- biblioteka Steam, czas gry, osiągnięcia i metadane;
- biblioteka PlayStation, czas gry i trofea;
- wieloplatformowa biblioteka GameTrack przez oficjalny eksport ZIP (import ręczny);
- jedna notatka dla jednej logicznej gry, także gdy występuje na obu platformach;
- ostrożne dopasowanie z podglądem przed pierwszym zapisem;
- adopcja istniejących notatek bez przepisywania ręcznej treści;
- mapowane miejsca docelowe i zarządzany blok osiągnięć; niemapowane atrybuty oraz pozostała treść notatki pozostają bez zmian;
- opcjonalny bootstrap `Games.base`, synchronizacja w tle na desktopie, interfejs po angielsku i polsku;
- brak zapisu zwrotnego do źródeł danych, telemetryki, konta Game Sync i własnego backendu.

## Obsługiwane źródła biblioteki

### Steam

Steam wymaga oficjalnego Steam Web API key i publicznego profilu Steam. Okno połączenia przyjmuje adres profilu, nazwę albo SteamID64. Widoczność profilu i Game Details musi pozwalać na odczyt biblioteki.

### PlayStation

Obsługa PlayStation jest nieoficjalna. Korzysta z bootstrapu NPSSO i pakietu `psn-api` do aktualnych przepływów PlayStation Network. Przeczytaj ostrzeżenie przed włączeniem tej funkcji.

### GameTrack

GameTrack jest źródłem dla połączonej biblioteki z wielu platform. Wyeksportuj
bibliotekę z GameTrack, a następnie wybierz oficjalny plik ZIP w Game Sync.
Import jest ręczny i tylko do odczytu: plugin nie korzysta z prywatnej bazy
GameTrack, nie wymaga Full Disk Access i nie modyfikuje eksportu.

## Instalacja

### Community Plugins

Po zatwierdzeniu w katalogu zainstaluj **Game Sync** przez Community Plugins w Obsidianie. Włącz plugin i otwórz **Game Sync: Open Quick Setup**.

### BRAT

Do wersji deweloperskiej lub przed publikacją w katalogu dodaj w BRAT repozytorium:

`https://github.com/voi-tech/obsidian-game-sync`

Po zakończeniu aktualizacji włącz plugin.

### Instalacja ręczna

Umieść zgodne pliki wydania w `.obsidian/plugins/game-sync/`:

- `main.js`
- `manifest.json`
- `styles.css`

Przeładuj Obsidiana, włącz **Game Sync** i otwórz Quick Setup.

## Pierwsza konfiguracja

1. Otwórz paletę poleceń i uruchom **Game Sync: Open Quick Setup**.
2. Wybierz źródło biblioteki. Dla GameTrack wyeksportuj bibliotekę z GameTrack
   i wybierz ZIP, gdy plugin o to poprosi.
3. Obejrzyj **Podgląd pierwszej synchronizacji**.
4. Zastosuj zaakceptowane zmiany.

Domyślnym miejscem zapisu jest `Games/`; zmień je tylko wtedy, gdy chcesz użyć innego folderu. Okna źródeł danych prowadzą przez wymagane kroki, a podgląd pojawia się przed każdym zapisem.

Pierwsza synchronizacja nie może zostać zastosowana po cichu. Późniejsze synchronizacje również mogą wymagać ręcznej decyzji, gdy dopasowanie jest niepewne. Jeśli credentials są nadal dostępne, otwarcie połączenia najpierw próbuje połączenia jednym kliknięciem, a okno źródła danych otwiera dopiero przy potrzebie naprawy.

W podglądzie możesz zaznaczyć tylko wybrane gry i pojedyncze zmieniane atrybuty, zobaczyć szczegóły utworzenia lub aktualizacji notatki i zastosować wyłącznie zaakceptowane zmiany.

## Konfiguracja GameTrack

1. W GameTrack użyj oficjalnej funkcji eksportu biblioteki.
2. W ustawieniach Game Sync wybierz **GameTrack** jako źródło biblioteki.
3. Wybierz wyeksportowany plik ZIP.
4. Uruchom **Podgląd synchronizacji**, sprawdź plan i wykonaj synchronizację.

Import GameTrack jest jawny i ręczny. Samo wybranie eksportu nie uruchamia
synchronizacji w tle, a scheduler nie importuje po cichu starego pliku.

Dla wcześniej zaimportowanej biblioteki GameTrack można w Dodatkowych
ustawieniach włączyć opcjonalne odświeżanie aktywności i osiągnięć Steam oraz
aktywności i trofeów PlayStation. Enrichery aktualizują tylko dopasowane gry i
nie dodają gier, których nie ma w wybranej bibliotece GameTrack.

## Konfiguracja Steam

Utwórz oficjalny Steam Web API key na [stronie klucza Steam](https://steamcommunity.com/dev/apikey), a następnie podaj go razem z adresem profilu, nazwą vanity albo SteamID64 w oknie połączenia Steam. Przy kolejnych połączeniach zostaw pole API key puste, aby użyć klucza z Obsidian SecretStorage. Ustaw widoczność profilu oraz Game Details tak, aby wybrane dane były dostępne. Klucz nigdy nie trafia do danych sejfu ani stanu pluginu.

## Konfiguracja PlayStation

Okno połączenia otwiera oficjalną stronę logowania PlayStation oraz stronę z kodem połączenia. Zaloguj się, pobierz kod, wklej go w oknie i połącz konto. Game Sync wymienia go na ponownie używaną sesję i przechowuje credentials w Obsidian SecretStorage; jednorazowy kod nie jest zapisywany.

Obsługa PlayStation jest nieoficjalna. Sony nie udostępnia publicznego konsumenckiego API do tego zastosowania. Integracja zależy od nieudokumentowanego zachowania PlayStation Network i może przestać działać po zmianach po stronie Sony.

## Notatki i atrybuty

Game Sync zapisuje zwykłe notatki Markdown. Każdemu zarządzanemu polu źródłowemu można przypisać własną nazwę docelowego atrybutu albo wyłączyć mapowanie przez wyczyszczenie nazwy w ustawieniach. Atrybuty użytkownika — `status`, `rating`, `favorite`, `start`, `end`, `review`, `notes` i `tags` — są chronione: nie można wybrać ich jako miejsc docelowych i pozostają pod kontrolą użytkownika. Klucze szablonu są niezależne od mapowania atrybutów.

W istniejącej notatce Game Sync zachowuje ręczną treść, niezależny frontmatter i istniejącą tożsamość notatki. Szablon renderuje body tylko podczas tworzenia nowej notatki. Zarządzany blok osiągnięć ma markery:

```md
%% game-sync:achievements %%

...

%% /game-sync:achievements %%
```

Czas gry jest zapisywany w minutach. Postęp ma wartość liczbową `0–100`. Daty używają formatu `YYYY-MM-DD`, a znaczniki techniczne ISO 8601.

## Szablony

Ustaw ścieżkę szablonu w ustawieniach. Płaski kontekst szablonu udostępnia pełny publiczny katalog kluczy:

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

Klucze tablicowe `developers`, `publishers`, `genres`, `platforms` i `providers` można wyświetlać przez `join`. Wartości platform są znormalizowanymi identyfikatorami, takimi jak `pc` i `playstation-5`; `platformsText` jest gotową formą tekstową rozdzieloną przecinkami. Obecne źródła danych nie określają wiarygodnie, w jaki sposób gra została pozyskana, dlatego `acquisitionType` ma wartość `unknown`.

Dostępne helpery to `join`, `hours`, `percent` i `date`. `join` łączy tablicę, `hours` przelicza minuty na godziny, `percent` formatuje liczbę do dwóch miejsc po przecinku, a `date` formatuje datę z domyślnym wzorem `YYYY-MM-DD`. Implementacja rejestruje również `renderAchievementList` na potrzeby wbudowanych partiali osiągnięć. Podczas renderowania rozwiązywane są także obiekty zastępcze Obsidiana, na przykład `{{date:YYYY-MM-DD}}` i `{{time:HH:mm}}`.

Partiale to `achievements` (oba źródła), `steamAchievements` i `playstationTrophies`. Renderują odpowiednie listy osiągnięć lub trofeów, zachowując ukryte szczegóły zablokowanych elementów jako nieujawnione, dopóki nie włączysz ujawniania spoilerów.

## Osiągnięcia i trofea

Osiągnięcia Steam i trofea PlayStation pozostają osobnymi danymi źródeł. Game Sync nie tworzy wspólnego procentu osiągnięć. Ukryte elementy domyślnie nie ujawniają spoilerów. Gdy pobranie osiągnięć jest częściowe, znane dane są zachowywane, a nieznane pozostają nieznane.

## Games.base

`Games.base` jest opcjonalne. Po włączeniu Game Sync tworzy je raz z widokami dla biblioteki, Steam, PlayStation, gier wspólnych i osiągnięć/trofeów. Późniejsza synchronizacja go nie nadpisuje.

## Synchronizacja w tle

Synchronizacja w tle jest domyślnie wyłączona i nie działa na mobile. Obsługiwane interwały to 30 minut, 1 godzina, 6 godzin, 12 godzin i 24 godziny. W tle wykonywane są tylko operacje bezpieczne; konflikty, niepewne dopasowania i pierwsza synchronizacja pozostają pracą z jawnym podglądem.

## Prywatność i sieć

- Nie ma backendu Game Sync, telemetryki ani konta Game Sync.
- Treść sejfu i pełne body notatek nie są wysyłane.
- Żądania źródeł danych idą bezpośrednio z Obsidiana do odpowiednich usług.
- Dane uwierzytelniające są przechowywane przez Obsidian SecretStorage.
- Raport diagnostyczny korzysta z allowlisty i nie zawiera credentials, tokenów, odpowiedzi API ani treści notatek.

Aktualny bundle produkcyjny zawiera następujące hosty związane ze źródłami danych:

| Cel | Hosty |
| --- | --- |
| Steam Web API i metadane sklepu | `api.steampowered.com`, `store.steampowered.com` |
| Uwierzytelnianie Sony | `ca.account.sony.com` |
| Biblioteka i trofea PlayStation | `web.np.playstation.com`, `m.np.playstation.com` |

Hosty PlayStation są używane przez odizolowaną zależność `psn-api`. Plugin nie dodaje proxy ani backendu.

## Zastrzeżenie dotyczące PlayStation

Obsługa PlayStation jest nieoficjalna. Sony nie udostępnia publicznego konsumenckiego API do tego zastosowania. Integracja zależy od nieudokumentowanego zachowania PlayStation Network i może przestać działać po zmianach po stronie Sony. Nie jest to integracja afiliowana przez Sony ani PlayStation.

## Ograniczenia

- Synchronizacja działa wyłącznie źródło danych → Obsidian; nie ma zapisu zwrotnego.
- Game Sync nigdy automatycznie nie usuwa, nie przenosi, nie zmienia nazw ani nie scala istniejących notatek.
- Na jeden sejf przypada jedno konto Steam i jedno konto PlayStation.
- Historia zakupów, RAWG i źródła inne niż GameTrack, Steam oraz PlayStation są poza tym wydaniem.
- GameTrack wymaga oficjalnego eksportu ZIP; import jest jawny i ręczny.
- Pełne connect/sync/background jest gwarantowane na desktopie; ładowanie bundle, ustawienia i dostęp do Markdown działają na mobile, ale synchronizacja w tle jest wyłączona.
- Niepewne dopasowania pozostają elementami review/conflict. **Manage game matches** udostępnia widoki Scalone, Zachowane osobno i Nierozstrzygnięte. Można w nim przygotować i zastosować rozdzielenie po podglądzie, ponownie zezwolić na dopasowanie par zachowanych osobno oraz rozstrzygać nierozstrzygnięte kandydatury przez merge, keep-separate albo skip.

## Rozwiązywanie problemów

### Steam nie zwraca gier

Sprawdź SteamID64, API key oraz widoczność profilu i Game Details. Po poprawieniu konta uruchom **Force refresh all data**.

### PlayStation ponownie prosi o połączenie

Sesja odświeżania mogła wygasnąć albo zostać unieważniona. Połącz konto ponownie przez okno PlayStation. Istniejące notatki Markdown nie są usuwane przez rozłączenie.

### Notatka nie została zmieniona

Obejrzyj podgląd. Gra może być ignorowana, dopasowanie może być niejednoznaczne albo zmiana czekać na jawną decyzję. Nie wymuszaj scalenia, jeśli kandydaci nie są bezsprzecznie tą samą grą.

### Diagnostyka

Użyj **Copy diagnostic information** i przed udostępnieniem sprawdź raport pod kątem prywatnego kontekstu. Nigdy nie wklejaj do zgłoszenia credentials ani tokenów.

## Rozwój

Wymagany Node.js `>=20.19.0`.

```bash
npm ci
npm run check
npm run dev
```

Check uruchamia lint, typecheck, pełny zestaw Vitest, build produkcyjny, kontrolę mobile bundle i release gate.

## Licencja

MIT. Zobacz [LICENSE](LICENSE).
