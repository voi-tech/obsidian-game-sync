# Game Sync

Game Sync synchronizuje dane gier ze Steam i PlayStation do zwykłych notatek Markdown w Obsidianie.

## Funkcje

- biblioteka Steam, czas gry, osiągnięcia i metadane;
- biblioteka PlayStation, czas gry i trofea;
- jedna notatka dla jednej logicznej gry, także gdy występuje na obu platformach;
- ostrożne dopasowanie z podglądem przed pierwszym zapisem;
- adopcja istniejących notatek bez przepisywania ręcznej treści;
- zarządzane Properties i zarządzany blok osiągnięć; pozostała treść notatki pozostaje własnością użytkownika;
- opcjonalny bootstrap `Games.base`, synchronizacja w tle na desktopie, interfejs po angielsku i polsku;
- brak zapisu zwrotnego do providerów, telemetryki, konta Game Sync i własnego backendu.

## Obsługiwani providerzy

### Steam

Steam wymaga SteamID64 i oficjalnego Steam Web API key. Widoczność profilu i Game Details musi pozwalać na odczyt biblioteki.

### PlayStation

Obsługa PlayStation jest nieoficjalna. Korzysta z bootstrapu NPSSO i pakietu `psn-api` do aktualnych przepływów PlayStation Network. Przeczytaj ostrzeżenie przed włączeniem tej funkcji.

## Instalacja

### Community Plugins

Po zatwierdzeniu w katalogu zainstaluj **Game Sync** przez Community Plugins w Obsidianie. Włącz plugin i uruchom **Game Sync: Run setup wizard**.

### BRAT

Do wersji deweloperskiej lub przed publikacją w katalogu dodaj w BRAT repozytorium:

`https://github.com/voi-tech/obsidian-game-sync`

Po zakończeniu aktualizacji włącz plugin.

### Instalacja ręczna

Umieść zgodne pliki wydania w `.obsidian/plugins/game-sync/`:

- `main.js`
- `manifest.json`
- `styles.css`

Przeładuj Obsidiana, włącz **Game Sync** i uruchom kreator konfiguracji.

## Pierwsza konfiguracja

1. Otwórz paletę poleceń i uruchom **Game Sync: Run setup wizard**.
2. Włącz co najmniej jednego providera.
3. Połącz Steam i/lub PlayStation.
4. Wybierz folder notatek, wzorzec nazwy, opcjonalny szablon i opcjonalny plik `Games.base`.
5. Ustaw filtry biblioteki oraz zachowanie synchronizacji.
6. Pobierz pierwszą bibliotekę i obejrzyj pełny podgląd.
7. Zastosuj tylko zaakceptowane zmiany.

Pierwsza synchronizacja nie może zostać zastosowana po cichu. Późniejsze synchronizacje również mogą wymagać ręcznej decyzji, gdy dopasowanie jest niepewne.

## Konfiguracja Steam

Utwórz oficjalny Steam Web API key, podaj go razem ze SteamID64 w oknie połączenia Steam i ustaw widoczność profilu oraz Game Details tak, aby wybrane dane były dostępne. Klucz jest przechowywany przez Obsidian SecretStorage; nie trafia do danych sejfu ani stanu pluginu.

## Konfiguracja PlayStation

Okno połączenia otwiera oficjalne strony PlayStation i NPSSO. Wklej jednorazową wartość NPSSO do pola typu hasło i zatwierdź. Game Sync wymienia ją na sesję i przechowuje refresh token w Obsidian SecretStorage. NPSSO nie jest przechowywane po bootstrapie.

Obsługa PlayStation jest nieoficjalna. Sony nie udostępnia publicznego konsumenckiego API do tego zastosowania. Integracja zależy od nieudokumentowanego zachowania PlayStation Network i może przestać działać po zmianach po stronie Sony.

## Notatki i Properties

Game Sync zapisuje zwykłe notatki Markdown. Domyślne nazwy zarządzanych Properties to między innymi `game-sync-id`, `steam-id`, `playstation-id`, `playtime` oraz pola czasu gry dla providerów. Miejsca docelowe Properties można zmieniać lub wyłączać w Settings; klucze szablonu są niezależne od mapowania Properties.

W istniejącej notatce Game Sync zachowuje ręczną treść, niezależny frontmatter i istniejącą tożsamość notatki. Szablon renderuje body tylko podczas tworzenia nowej notatki. Zarządzany blok osiągnięć ma markery:

```md
%% game-sync:achievements %%

...

%% /game-sync:achievements %%
```

Czas gry jest zapisywany w minutach. Postęp ma wartość liczbową `0–100`. Daty używają formatu `YYYY-MM-DD`, a znaczniki techniczne ISO 8601.

## Szablony

Ustaw ścieżkę szablonu w Settings albo w kreatorze. Klucze obejmują `title`, `released`, `description`, `cover`, `providers`, `owned`, `playtime`, `lastPlayed`, `steamId`, `steamAchievements`, `playstationId` i `playstationTrophies`.

Dostępne helpery to `join`, `hours`, `percent` i `date`. Partiale obejmują `achievements`, `steamAchievements` i `playstationTrophies`. Akcja **Template keys** w Settings pokazuje pełną aktualną listę.

## Osiągnięcia i trofea

Osiągnięcia Steam i trofea PlayStation pozostają osobnymi danymi providerów. Game Sync nie tworzy wspólnego procentu osiągnięć. Ukryte elementy domyślnie nie ujawniają spoilerów. Gdy pobranie osiągnięć jest częściowe, znane dane są zachowywane, a nieznane pozostają nieznane.

## Games.base

`Games.base` jest opcjonalne. Po włączeniu Game Sync tworzy je raz z widokami dla biblioteki, Steam, PlayStation, gier wspólnych i osiągnięć/trofeów. Późniejsza synchronizacja go nie nadpisuje.

## Synchronizacja w tle

Synchronizacja w tle jest domyślnie wyłączona i nie działa na mobile. Obsługiwane interwały to 30 minut, 1 godzina, 6 godzin, 12 godzin i 24 godziny. W tle wykonywane są tylko operacje bezpieczne; konflikty, niepewne dopasowania i pierwsza synchronizacja pozostają pracą z jawnym podglądem.

## Prywatność i sieć

- Nie ma backendu Game Sync, telemetryki ani konta Game Sync.
- Treść sejfu i pełne body notatek nie są wysyłane.
- Żądania providerów idą bezpośrednio z Obsidiana do usług providerów.
- Dane uwierzytelniające są przechowywane przez Obsidian SecretStorage.
- Raport diagnostyczny korzysta z allowlisty i nie zawiera credentials, tokenów, odpowiedzi API ani treści notatek.

Aktualny bundle produkcyjny zawiera następujące hosty związane z providerami:

| Cel | Hosty |
| --- | --- |
| Steam Web API i metadane sklepu | `api.steampowered.com`, `store.steampowered.com` |
| Uwierzytelnianie Sony | `ca.account.sony.com` |
| Biblioteka i trofea PlayStation | `web.np.playstation.com`, `m.np.playstation.com` |

Hosty PlayStation są używane przez odizolowaną zależność `psn-api`. Plugin nie dodaje proxy ani backendu.

## Zastrzeżenie dotyczące PlayStation

Obsługa PlayStation jest nieoficjalna. Sony nie udostępnia publicznego konsumenckiego API do tego zastosowania. Integracja zależy od nieudokumentowanego zachowania PlayStation Network i może przestać działać po zmianach po stronie Sony. Nie jest to integracja afiliowana przez Sony ani PlayStation.

## Ograniczenia

- Synchronizacja działa wyłącznie provider → Obsidian; nie ma zapisu zwrotnego.
- Game Sync nigdy automatycznie nie usuwa, nie przenosi, nie zmienia nazw ani nie scala istniejących notatek.
- Na jeden sejf przypada jedno konto Steam i jedno konto PlayStation.
- Historia zakupów, IGDB/RAWG i providerzy inni niż Steam oraz PlayStation są poza tym wydaniem.
- Pełne connect/sync/background jest gwarantowane na desktopie; ładowanie bundle, ustawienia i dostęp do Markdown działają na mobile, ale synchronizacja w tle jest wyłączona.
- Niepewne dopasowania pozostają elementami review/conflict. Polecenie match managera pozostaje niedostępne do czasu bezpiecznej implementacji split/unmerge.

## Rozwiązywanie problemów

### Steam nie zwraca gier

Sprawdź SteamID64, API key oraz widoczność profilu i Game Details. Po poprawieniu konta uruchom **Force refresh all data**.

### PlayStation ponownie prosi o NPSSO

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
