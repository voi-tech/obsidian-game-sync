import type { AchievementDetail, AchievementSummary, CanonicalGame, GamePlaytime, PlaytimeObservation } from '../../model/canonical-game';
import type { GameProviderCapabilities, GameProviderDiagnostics, LibraryProvider } from '../../model/canonical-provider';
import type { ProviderGame, ProviderSnapshot } from '../../model/provider';
import type { GameProviderAdapter } from '../provider';
import { createPlayStationAdapter } from './adapter';
import type { PlayStationAdapterOptions } from './types';

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

export interface PlayStationLibraryProviderOptions {
	readonly adapter?: GameProviderAdapter;
	readonly adapterOptions?: PlayStationAdapterOptions;
}

export function createPlayStationLibraryProvider(options: PlayStationLibraryProviderOptions): LibraryProvider {
	const adapter = options.adapter ?? (options.adapterOptions === undefined ? undefined : createPlayStationAdapter(options.adapterOptions));
	if (adapter === undefined) throw new Error('PlayStation library provider requires an adapter or adapter options.');
	let diagnostics = emptyDiagnostics();
	return {
		id: 'playstation',
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

function normalizePlatform(value: string): string {
	const normalized = value.trim().toLocaleLowerCase('en-US');
	if (normalized.includes('ps5') || normalized.includes('playstation 5')) return 'playstation-5';
	if (normalized.includes('ps4') || normalized.includes('playstation 4')) return 'playstation-4';
	return normalized.replace(/[^a-z0-9]+/gu, '-') || 'playstation';
}

function toCanonicalGame(game: ProviderGame): CanonicalGame {
	const id = game.providerGameId.trim();
	const platform = normalizePlatform(game.platforms[0] ?? 'playstation');
	return {
		identity: { canonicalKey: `playstation:${id}`, externalIds: { playstation: id } },
		title: game.title,
		metadata: { releaseDate: game.releaseDate, developers: game.developers, publishers: game.publishers, genres: game.genres, summary: game.description, cover: game.cover },
		platforms: [{ id: platform, owned: game.owned, source: 'playstation' }],
		playtime: toPlaytime(game, platform),
		...(game.lastPlayed === undefined ? {} : { lastPlayed: game.lastPlayed, activity: { lastPlayed: { value: game.lastPlayed, source: 'playstation', confidence: 'high' as const } } }),
		...(game.achievements === undefined ? {} : { achievements: [toAchievementSummary(game, platform)] }),
		provenance: { provider: 'playstation', sourceId: id, schemaSignature: 'playstation-api-v1' },
	};
}

function toPlaytime(game: ProviderGame, platform: string): GamePlaytime {
	if (game.playtimeMinutes === undefined) return { observations: [] };
	const observation: PlaytimeObservation = { source: 'playstation', platform, rawValue: game.playtimeMinutes, rawUnit: 'minutes', minutes: game.playtimeMinutes, confidence: 'high', valid: true };
	return { canonical: { minutes: game.playtimeMinutes, source: 'playstation', confidence: 'high' }, observations: [observation] };
}

function toAchievementSummary(game: ProviderGame, platform: string): AchievementSummary {
	const set = game.achievements;
	return { source: 'playstation', platform, unlocked: set?.earned, total: set?.total, completionPercent: set?.total === 0 ? undefined : set?.progress, confidence: game.freshness.achievements ? 'high' : 'low', details: set?.achievements.map(toAchievementDetail) };
}

function toAchievementDetail(value: ProviderGame['achievements'] extends infer T ? T extends { achievements: readonly (infer A)[] } ? A : never : never): AchievementDetail {
	return { id: value.id, name: value.name, description: value.description, unlocked: value.unlocked, unlockedAt: value.unlockedAt, hidden: value.hidden, rarityPercent: value.rarityPercent, iconUrl: value.iconUrl, trophyType: value.trophyType };
}

function toDiagnostics(snapshot: ProviderSnapshot, normalized: number): GameProviderDiagnostics {
	return { provider: 'playstation', database: 'unavailable', schema: 'unknown', gamesRead: snapshot.games.length, gamesNormalized: normalized, diagnostics: snapshot.error === undefined ? [] : [{ code: snapshot.error.code, message: snapshot.error.message }] };
}

function emptyDiagnostics(): GameProviderDiagnostics {
	return { provider: 'playstation', database: 'unavailable', schema: 'unknown', gamesRead: 0, gamesNormalized: 0, diagnostics: [] };
}
