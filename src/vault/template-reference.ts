export const TEMPLATE_PUBLIC_KEYS = [
	'id', 'title', 'original', 'year', 'released', 'description', 'cover', 'developers', 'publishers', 'genres', 'platforms', 'providers',
	'owned', 'acquisitionType', 'playtime', 'playtimeHours', 'lastPlayed', 'updated', 'steamId', 'steamUrl', 'steamOwned',
	'steamPlaytime', 'steamPlaytimeHours', 'steamLastPlayed', 'steamAchievementsEarned', 'steamAchievementsTotal', 'steamAchievementsProgress',
	'steamAchievements', 'playstationId', 'playstationUrl', 'playstationOwned', 'playstationPlaytime', 'playstationPlaytimeHours',
	'playstationLastPlayed', 'psnTrophiesEarned', 'psnTrophiesTotal', 'psnTrophiesProgress', 'psnBronze', 'psnSilver', 'psnGold',
	'psnPlatinum', 'playstationTrophies', 'purchaseDate', 'purchasePrice', 'purchaseCurrency', 'purchaseSource', 'developersText',
	'publishersText', 'genresText', 'platformsText', 'providersText',
] as const;

export const TEMPLATE_HELPERS = ['join', 'hours', 'percent', 'date'] as const;
export const TEMPLATE_PARTIALS = ['achievements', 'steamAchievements', 'playstationTrophies'] as const;

export type TemplatePublicKey = (typeof TEMPLATE_PUBLIC_KEYS)[number];
