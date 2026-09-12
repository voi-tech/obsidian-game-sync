import type { ProviderGame } from '../../model/provider';
import type { SteamAppDetails, SteamOwnedGame } from './types';

const NON_GAME_MARKERS = ['demo', 'trial', 'beta', 'test', 'soundtrack', 'tool', 'launcher', 'dlc'];

function values(value: string | string[] | undefined): string[] {
	return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export function isSteamNonGameApp(details: SteamAppDetails | undefined): boolean {
	const evidence = [details?.type, ...values(details?.categories?.flatMap((category) => typeof category === 'string' ? [category] : category.description === undefined ? [] : [category.description]))].filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase());
	return evidence.some((value) => NON_GAME_MARKERS.some((marker) => value === marker || value.includes(marker)));
}

function integerMinutes(value: number | undefined): number | undefined {
	return value === undefined || !Number.isFinite(value) ? undefined : Math.max(0, Math.floor(value));
}

function lastPlayed(game: SteamOwnedGame): string | undefined {
	if (game.last_played !== undefined) return game.last_played;
	if (game.rtime_last_played === undefined || game.rtime_last_played <= 0) return undefined;
	return new Date(game.rtime_last_played * 1000).toISOString();
}

function list(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry: unknown) => {
		if (typeof entry === 'string') return [entry];
		if (typeof entry !== 'object' || entry === null) return [];
		const description = (entry as { description?: unknown }).description;
		return typeof description === 'string' ? [description] : [];
	});
}

function platforms(details: SteamAppDetails | undefined): string[] {
	if (details?.platforms !== undefined) return Object.entries(details.platforms).filter(([, enabled]) => enabled).map(([platform]) => platform.toLowerCase());
	return ['pc'];
}

export function normalizeSteamGame(game: SteamOwnedGame, details?: SteamAppDetails): ProviderGame | null {
	if (isSteamNonGameApp(details)) return null;
	const title = game.name?.trim();
	if (title === undefined || title.length === 0) return null;
	const playtimeMinutes = integerMinutes(game.playtime_forever);
	return {
		provider: 'steam',
		providerGameId: String(game.appid),
		title,
		originalTitle: title,
		description: details?.detailed_description ?? details?.short_description,
		cover: details?.header_image,
		developers: details?.developers ?? [],
		publishers: details?.publishers ?? [],
		genres: list(details?.genres),
		platforms: platforms(details),
		owned: true,
		acquisitionType: details?.is_free === true ? 'free' : 'unknown',
		playtimeMinutes,
		lastPlayed: lastPlayed(game),
		achievements: undefined,
		freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
		identity: { provider: 'steam', appId: game.appid },
	};
}

export function normalizeSteamGames(games: readonly SteamOwnedGame[], details: ReadonlyMap<number, SteamAppDetails> = new Map()): ProviderGame[] {
	return games.map((game) => normalizeSteamGame(game, details.get(game.appid))).filter((game): game is ProviderGame => game !== null);
}
