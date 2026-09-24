export const TEMPLATE_PUBLIC_KEYS = [
	'id', 'title', 'original', 'year', 'released', 'description', 'cover', 'developers', 'publishers', 'genres', 'platforms', 'providers',
	'owned', 'acquisitionType', 'playtime', 'playtimeHours', 'lastPlayed', 'updated', 'steamId', 'steamUrl', 'steamOwned',
	'steamPlaytime', 'steamPlaytimeHours', 'steamLastPlayed', 'steamAchievementsEarned', 'steamAchievementsTotal', 'steamAchievementsProgress',
	'steamAchievements', 'playstationId', 'playstationUrl', 'playstationOwned', 'playstationPlaytime', 'playstationPlaytimeHours',
	'playstationLastPlayed', 'psnTrophiesEarned', 'psnTrophiesTotal', 'psnTrophiesProgress', 'psnBronze', 'psnSilver', 'psnGold',
	'psnPlatinum', 'playstationTrophies', 'purchaseDate', 'purchasePrice', 'purchaseCurrency', 'purchaseSource', 'developersText',
	'publishersText', 'genresText', 'platformsText', 'providersText',
] as const;

export interface TemplateKeyInfo {
	key: TemplatePublicKey;
	description: { en: string; pl: string };
	example: string;
}

function keyInfo(key: TemplatePublicKey, en: string, pl: string, example: string): TemplateKeyInfo {
	return { key, description: { en, pl }, example };
}

/** The user-facing contract for values available in a Markdown template. */
export const TEMPLATE_KEY_CATALOG: readonly TemplateKeyInfo[] = [
	keyInfo('id', 'Stable Game Sync identity.', 'Stabilna tożsamość Game Sync.', 'game-sync:dead-space-2008'),
	keyInfo('title', 'Game title.', 'Tytuł gry.', 'Dead Space'),
	keyInfo('original', 'Original game title when available.', 'Oryginalny tytuł gry, jeśli jest dostępny.', 'Dead Space'),
	keyInfo('year', 'Release year as a number.', 'Rok wydania jako liczba.', '2008'),
	keyInfo('released', 'Release date in ISO format.', 'Data wydania w formacie ISO.', '2008-10-14'),
	keyInfo('description', 'Game description.', 'Opis gry.', 'Survival horror in space.'),
	keyInfo('cover', 'Cover image URL.', 'Adres obrazu okładki.', 'https://images.example/cover.jpg'),
	keyInfo('developers', 'Array of development studios; use join to render it as text.', 'Lista studiów; użyj join, aby wyświetlić ją jako tekst.', 'Motive Studio'),
	keyInfo('publishers', 'Array of publishers; use join to render it as text.', 'Lista wydawców; użyj join, aby wyświetlić ją jako tekst.', 'Electronic Arts'),
	keyInfo('genres', 'Array of game genres; use join to render it as text.', 'Lista gatunków; użyj join, aby wyświetlić ją jako tekst.', 'Horror, Action'),
	keyInfo('platforms', 'Array of normalized platform IDs; use join to render it as text.', 'Lista znormalizowanych identyfikatorów platform; użyj join, aby wyświetlić ją jako tekst.', 'pc, playstation-5'),
	keyInfo('providers', 'Array of data sources; use join to render it as text.', 'Lista źródeł danych; użyj join, aby wyświetlić ją jako tekst.', 'gametrack, steam'),
	keyInfo('owned', 'Whether the game is owned on at least one platform.', 'Informacja, czy gra jest posiadana na co najmniej jednej platformie.', 'true'),
	keyInfo('acquisitionType', 'Acquisition classification when known; otherwise unknown.', 'Klasyfikacja pozyskania gry, jeśli jest znana; w przeciwnym razie unknown.', 'unknown'),
	keyInfo('playtime', 'Total playtime in minutes.', 'Łączny czas gry w minutach.', '2538'),
	keyInfo('playtimeHours', 'Total playtime in hours.', 'Łączny czas gry w godzinach.', '42.3'),
	keyInfo('lastPlayed', 'Date of the most recent activity.', 'Data ostatniej aktywności.', '2026-09-15'),
	keyInfo('updated', 'Date and time when Game Sync generated the note.', 'Data i czas wygenerowania notatki przez Game Sync.', '2026-09-15T12:30:00.000Z'),
	keyInfo('steamId', 'Steam app identifier.', 'Identyfikator aplikacji Steam.', '123456'),
	keyInfo('steamUrl', 'Steam store URL.', 'Adres strony gry w sklepie Steam.', 'https://store.steampowered.com/app/123456'),
	keyInfo('steamOwned', 'Whether the game is owned on Steam.', 'Informacja, czy gra jest posiadana na Steam.', 'true'),
	keyInfo('steamPlaytime', 'Steam playtime in minutes.', 'Czas gry na Steam w minutach.', '2412'),
	keyInfo('steamPlaytimeHours', 'Steam playtime in hours.', 'Czas gry na Steam w godzinach.', '40.2'),
	keyInfo('steamLastPlayed', 'Date of the most recent Steam activity.', 'Data ostatniej aktywności na Steam.', '2026-09-14'),
	keyInfo('steamAchievementsEarned', 'Number of unlocked Steam achievements.', 'Liczba odblokowanych osiągnięć Steam.', '31'),
	keyInfo('steamAchievementsTotal', 'Reliable total number of Steam achievements.', 'Wiarygodna łączna liczba osiągnięć Steam.', '50'),
	keyInfo('steamAchievementsProgress', 'Steam achievement completion percentage.', 'Procent ukończenia osiągnięć Steam.', '62.00'),
	keyInfo('steamAchievements', 'Steam achievement objects; use each or the steamAchievements partial.', 'Obiekty osiągnięć Steam; użyj each lub partialu steamAchievements.', 'The Fool (unlocked)'),
	keyInfo('playstationId', 'PlayStation game identifier.', 'Identyfikator gry PlayStation.', 'concept-123'),
	keyInfo('playstationUrl', 'PlayStation game URL.', 'Adres strony gry w PlayStation.', 'https://store.playstation.com/concept-123'),
	keyInfo('playstationOwned', 'Whether the game is owned on PlayStation.', 'Informacja, czy gra jest posiadana na PlayStation.', 'true'),
	keyInfo('playstationPlaytime', 'PlayStation playtime in minutes.', 'Czas gry na PlayStation w minutach.', '126'),
	keyInfo('playstationPlaytimeHours', 'PlayStation playtime in hours.', 'Czas gry na PlayStation w godzinach.', '2.1'),
	keyInfo('playstationLastPlayed', 'Date of the most recent PlayStation activity.', 'Data ostatniej aktywności na PlayStation.', '2026-09-12'),
	keyInfo('psnTrophiesEarned', 'Number of unlocked PlayStation trophies.', 'Liczba zdobytych trofeów PlayStation.', '18'),
	keyInfo('psnTrophiesTotal', 'Reliable total number of PlayStation trophies.', 'Wiarygodna łączna liczba trofeów PlayStation.', '35'),
	keyInfo('psnTrophiesProgress', 'PlayStation trophy completion percentage.', 'Procent ukończenia trofeów PlayStation.', '51.43'),
	keyInfo('psnBronze', 'Number of bronze trophies.', 'Liczba brązowych trofeów.', '12'),
	keyInfo('psnSilver', 'Number of silver trophies.', 'Liczba srebrnych trofeów.', '4'),
	keyInfo('psnGold', 'Number of gold trophies.', 'Liczba złotych trofeów.', '1'),
	keyInfo('psnPlatinum', 'Number of platinum trophies.', 'Liczba platynowych trofeów.', '1'),
	keyInfo('playstationTrophies', 'PlayStation trophy objects; use each or the playstationTrophies partial.', 'Obiekty trofeów PlayStation; użyj each lub partialu playstationTrophies.', 'First Contact (bronze)'),
	keyInfo('purchaseDate', 'Purchase date when available.', 'Data zakupu, jeśli jest dostępna.', '2026-08-24'),
	keyInfo('purchasePrice', 'Purchase price when available.', 'Cena zakupu, jeśli jest dostępna.', '39.99'),
	keyInfo('purchaseCurrency', 'Purchase currency when available.', 'Waluta zakupu, jeśli jest dostępna.', 'PLN'),
	keyInfo('purchaseSource', 'Purchase source when available.', 'Źródło zakupu, jeśli jest dostępne.', 'Steam'),
	keyInfo('developersText', 'Development studios already joined as text.', 'Studia już połączone w tekst.', 'Motive Studio'),
	keyInfo('publishersText', 'Publishers already joined as text.', 'Wydawcy już połączeni w tekst.', 'Electronic Arts'),
	keyInfo('genresText', 'Genres already joined as text.', 'Gatunki już połączone w tekst.', 'Horror, Action'),
	keyInfo('platformsText', 'Platform IDs already joined as text.', 'Identyfikatory platform połączone już w tekst.', 'pc, playstation-5'),
	keyInfo('providersText', 'Data sources already joined as text.', 'Źródła danych już połączone w tekst.', 'gametrack, steam'),
];

export const TEMPLATE_HELPERS = ['join', 'hours', 'percent', 'date'] as const;
export const TEMPLATE_PARTIALS = ['achievements', 'steamAchievements', 'playstationTrophies'] as const;

export type TemplatePublicKey = (typeof TEMPLATE_PUBLIC_KEYS)[number];
