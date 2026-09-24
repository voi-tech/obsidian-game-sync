import type { AchievementDetail, AchievementSummary, CanonicalGame, GamePlaytime, PlaytimeObservation } from '../../model/canonical-game';
import type { GameProviderCapabilities, GameProviderDiagnostics, LibraryProvider } from '../../model/canonical-provider';
import type { ProviderGame, ProviderSnapshot } from '../../model/provider';
import type { GameProviderAdapter } from '../provider';
import { createSteamAdapter, type SteamAdapterOptions } from './adapter';

const CAPABILITIES: GameProviderCapabilities = {
	supported: true,
	desktop: true,
	mobile: true,
	automaticSync: true,
	library: true,
	metadata: true,
	platforms: true,
	playtime: true,
	achievementSummary: true,
};

export interface SteamLibraryProviderOptions {
	readonly adapter?: GameProviderAdapter;
	readonly adapterOptions?: SteamAdapterOptions;
}

export function createSteamLibraryProvider(options: SteamLibraryProviderOptions): LibraryProvider {
	const adapter = options.adapter ?? (options.adapterOptions === undefined ? undefined : createSteamAdapter(options.adapterOptions));
	if (adapter === undefined) throw new Error('Steam library provider requires an adapter or adapter options.');
	let diagnostics = emptyDiagnostics();
	return {
		id: 'steam',
		getCapabilities: () => CAPABILITIES,
		async isAvailable() { return (await adapter.getConnectionStatus()).connected; },
		async getSnapshot() {
			const snapshot = await adapter.fetchLibrary({});
			const games = snapshot.games.map(toCanonicalGame);
			diagnostics = toDiagnostics(snapshot, games.length);
			return { status: snapshot.status, games, revision: snapshot.fetchedAt, diagnostics };
		},
		async getLibrary() { return (await this.getSnapshot()).games; },
		getDiagnostics: () => diagnostics,
	};
}

function toCanonicalGame(game: ProviderGame): CanonicalGame {
	const id = game.providerGameId.trim();
	const platforms = game.platforms.map(normalizePlatform).filter((platform) => platform.length > 0 && platform !== 'steam');
	const playtime = toPlaytime(game);
	return {
		identity: { canonicalKey: `steam:${id}`, externalIds: { steam: id } },
		title: game.title,
		metadata: {
			releaseDate: game.releaseDate,
			developers: game.developers,
			publishers: game.publishers,
			genres: game.genres,
			summary: game.description,
			cover: game.cover,
		},
		platforms: platforms.map((platform) => ({ id: platform, source: 'steam', ...(game.owned === undefined ? {} : { owned: game.owned }) })),
		playtime,
		...(game.lastPlayed === undefined ? {} : { lastPlayed: game.lastPlayed, activity: { lastPlayed: { value: game.lastPlayed, source: 'steam', confidence: 'high' as const } } }),
		...(game.achievements === undefined ? {} : { achievements: [toAchievementSummary(game)] }),
		provenance: { provider: 'steam', sourceId: id, schemaSignature: 'steam-api-v1' },
	};
}

function toPlaytime(game: ProviderGame): GamePlaytime {
	if (game.playtimeMinutes === undefined) return { observations: [] };
	const platform = game.platforms.map(normalizePlatform).find((value) => value.length > 0 && value !== 'steam');
	const observation: PlaytimeObservation = { source: 'steam', ...(platform === undefined ? {} : { platform }), rawValue: game.playtimeMinutes, rawUnit: 'minutes', minutes: game.playtimeMinutes, confidence: 'high', valid: true };
	return { canonical: { minutes: game.playtimeMinutes, source: 'steam', confidence: 'high' }, observations: [observation] };
}

function normalizePlatform(value: string): string {
	return value.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, '-');
}

function toAchievementSummary(game: ProviderGame): AchievementSummary {
	const set = game.achievements;
	return {
		source: 'steam',
		platform: 'steam',
		unlocked: set?.earned,
		total: set?.total,
		completionPercent: set?.total === 0 ? undefined : set?.progress,
		confidence: game.freshness.achievements ? 'high' : 'low',
		details: set?.achievements.map(toAchievementDetail),
	};
}

function toAchievementDetail(value: ProviderGame['achievements'] extends infer T ? T extends { achievements: readonly (infer A)[] } ? A : never : never): AchievementDetail {
	return { id: value.id, name: value.name, description: value.description, unlocked: value.unlocked, unlockedAt: value.unlockedAt, hidden: value.hidden, rarityPercent: value.rarityPercent, iconUrl: value.iconUrl, trophyType: value.trophyType };
}

function toDiagnostics(snapshot: ProviderSnapshot, normalized: number): GameProviderDiagnostics {
	return { provider: 'steam', database: 'unavailable', schema: 'unknown', gamesRead: snapshot.games.length, gamesNormalized: normalized, diagnostics: snapshot.error === undefined ? [] : [{ code: snapshot.error.code, message: snapshot.error.message }] };
}

function emptyDiagnostics(): GameProviderDiagnostics {
	return { provider: 'steam', database: 'unavailable', schema: 'unknown', gamesRead: 0, gamesNormalized: 0, diagnostics: [] };
}
