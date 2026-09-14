import type { CanonicalGame, AchievementDetail } from '../../model/canonical-game';
import type { CanonicalLibrarySnapshot } from '../../model/canonical-provider';
import type { CanonicalGamePatch, GameEnricher, GameEnricherCapabilities, GameEnrichmentResult } from '../../model/enrichment';
import { normalizeSteamAchievements } from './achievements';
import type { SteamApi, SteamAuthService, SteamOwnedGame } from './types';

export interface SteamEnricherOptions {
	readonly auth: SteamAuthService;
	readonly api: SteamApi;
	readonly now?: () => string;
}

const CAPABILITIES: GameEnricherCapabilities = { playtime: true, activity: true, achievementSummary: true, achievementDetails: true };

export function createSteamEnricher(options: SteamEnricherOptions): GameEnricher {
	return {
		id: 'steam',
		getCapabilities: () => CAPABILITIES,
		enrich: async (snapshot) => enrichSteam(snapshot, options),
	};
}

async function enrichSteam(snapshot: CanonicalLibrarySnapshot, options: SteamEnricherOptions): Promise<GameEnrichmentResult> {
	const retrievedAt = options.now?.() ?? new Date().toISOString();
	if (snapshot.status !== 'complete') return { source: 'steam', status: 'failed', retrievedAt, patches: [], diagnostics: [{ code: 'LIBRARY_SNAPSHOT_INCOMPLETE', message: 'Steam enrichment requires a complete library snapshot.' }] };
	try {
		const steamId = await options.auth.resolveSteamId64();
		const response = await options.api.getOwnedGames(steamId);
		if (response.games === undefined) return { source: 'steam', status: 'failed', retrievedAt, patches: [], diagnostics: [{ code: 'STEAM_LIBRARY_UNAVAILABLE', message: 'Steam did not return a readable owned-games list.' }] };
		const diagnostics: GameEnrichmentResult['diagnostics'][number][] = [];
		const patches: NonNullable<GameEnrichmentResult['patches'][number]>[] = [];
		const matched = matchGames(snapshot.games, response.games, diagnostics);
		let achievementFailure = false;
		for (const [canonical, external] of matched) {
			const patch: CanonicalGamePatch = {};
			const minutes = finiteNonNegative(external.playtime_forever);
			if (minutes !== undefined) patch.playtimeObservation = { source: 'steam', platform: 'steam', rawValue: minutes, rawUnit: 'minutes', minutes, confidence: 'high', valid: true };
			const lastPlayed = steamDate(external);
			if (lastPlayed !== undefined) patch.lastPlayed = { value: lastPlayed, source: 'steam', confidence: 'high' };
			if (options.api.getPlayerAchievements !== undefined && external.has_community_visible_stats !== false) {
				try {
					const achievementSet = normalizeSteamAchievements((await options.api.getPlayerAchievements(steamId, external.appid)).achievements ?? []);
					patch.achievements = [{ source: 'steam', platform: 'steam', unlocked: achievementSet.earned, total: achievementSet.total, completionPercent: achievementSet.total === 0 ? undefined : achievementSet.progress, confidence: 'high', details: achievementSet.achievements.map(toDetail) }];
				} catch {
					achievementFailure = true;
					diagnostics.push({ code: 'ACHIEVEMENT_REFRESH_FAILED', message: 'Steam achievements could not be refreshed; existing values were retained.', canonicalKey: canonical.identity.canonicalKey });
				}
			}
			if (Object.keys(patch).length > 0) patches.push({ canonicalKey: canonical.identity.canonicalKey, source: 'steam', patch });
		}
		return { source: 'steam', status: achievementFailure || diagnostics.length > 0 ? 'partial' : 'success', retrievedAt, patches, diagnostics, fingerprint: fingerprint(patches) };
	} catch (error) {
		return { source: 'steam', status: 'failed', retrievedAt, patches: [], diagnostics: [{ code: errorCode(error), message: 'Steam enrichment could not be refreshed.' }] };
	}
}

function matchGames(games: readonly CanonicalGame[], externalGames: readonly SteamOwnedGame[], diagnostics: NonNullable<GameEnrichmentResult['diagnostics'][number]>[]): Array<[CanonicalGame, SteamOwnedGame]> {
	const bySteam = new Map<string, CanonicalGame[]>();
	for (const game of games) {
		const id = game.identity.externalIds.steam;
		if (id !== undefined) bySteam.set(id, [...(bySteam.get(id) ?? []), game]);
	}
	const byTitle = new Map<string, CanonicalGame[]>();
	for (const game of games) if (game.platforms.some((platform) => platform.id === 'steam')) byTitle.set(titleKey(game.title), [...(byTitle.get(titleKey(game.title)) ?? []), game]);
	const used = new Set<string>();
	const matched: Array<[CanonicalGame, SteamOwnedGame]> = [];
	for (const external of externalGames) {
		const direct = bySteam.get(String(external.appid)) ?? [];
		const titleMatches = byTitle.get(titleKey(external.name ?? '')) ?? [];
		const candidates = direct.length > 0 ? direct : titleMatches;
		if (candidates.length !== 1 || used.has(candidates[0]?.identity.canonicalKey ?? '')) {
			diagnostics.push({ code: candidates.length > 1 ? 'AMBIGUOUS_EXTERNAL_GAME' : 'UNMATCHED_EXTERNAL_GAME', message: candidates.length > 1 ? 'Steam game matched more than one canonical game.' : 'Steam game is not present in the library provider snapshot.' });
			continue;
		}
		const canonical = candidates[0];
		if (canonical === undefined) continue;
		used.add(canonical.identity.canonicalKey);
		matched.push([canonical, external]);
	}
	return matched;
}

function titleKey(value: string): string { return value.toLocaleLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/gu, ' ').trim(); }
function finiteNonNegative(value: number | undefined): number | undefined { return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined; }
function steamDate(game: SteamOwnedGame): string | undefined { if (game.last_played !== undefined) return game.last_played; return game.rtime_last_played === undefined || game.rtime_last_played <= 0 ? undefined : new Date(game.rtime_last_played * 1000).toISOString(); }
function toDetail(value: { id: string; name?: string; description?: string; unlocked: boolean; unlockedAt?: string; hidden?: boolean; iconUrl?: string }): AchievementDetail { return { id: value.id, name: value.name, description: value.description, unlocked: value.unlocked, unlockedAt: value.unlockedAt, hidden: value.hidden, iconUrl: value.iconUrl }; }
function errorCode(error: unknown): string { return error instanceof Error && 'code' in error ? String(error.code) : 'STEAM_ENRICHMENT_FAILED'; }
function fingerprint(value: unknown): string { let hash = 2166136261; for (const character of JSON.stringify(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }
