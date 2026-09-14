import type { AchievementSummary, CanonicalActivityValue, GamePlaytime, PlaytimeObservation } from './canonical-game';
import type { CanonicalLibrarySnapshot } from './canonical-provider';

export type EnrichmentStatus = 'success' | 'partial' | 'failed';

export interface GameEnricherCapabilities {
	readonly playtime: boolean;
	readonly activity: boolean;
	readonly achievementSummary: boolean;
	readonly achievementDetails: boolean;
}

export interface EnrichmentDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly canonicalKey?: string;
}

export interface CanonicalGamePatch {
	lastPlayed?: CanonicalActivityValue;
	playtimeObservation?: PlaytimeObservation;
	achievements?: readonly AchievementSummary[];
}

export interface GameEnrichmentPatch {
	readonly canonicalKey: string;
	readonly source: string;
	readonly patch: CanonicalGamePatch;
}

export interface GameEnrichmentResult {
	readonly source: string;
	readonly status: EnrichmentStatus;
	readonly retrievedAt: string;
	readonly patches: readonly GameEnrichmentPatch[];
	readonly diagnostics: readonly EnrichmentDiagnostic[];
	readonly fingerprint?: string;
}

export interface GameEnricher {
	readonly id: string;
	getCapabilities(): GameEnricherCapabilities;
	enrich(snapshot: CanonicalLibrarySnapshot): Promise<GameEnrichmentResult>;
}

export interface EnrichedCanonicalSnapshot extends CanonicalLibrarySnapshot {
	readonly enrichments: readonly GameEnrichmentResult[];
}

export function applyEnrichmentResult(snapshot: CanonicalLibrarySnapshot, result: GameEnrichmentResult): EnrichedCanonicalSnapshot {
	if (result.patches.length === 0) return { ...snapshot, enrichments: [result] };
	const patches = new Map(result.patches.map((patch) => [patch.canonicalKey, patch]));
	const games = snapshot.games.map((game) => {
		const entry = patches.get(game.identity.canonicalKey);
		if (entry === undefined) return game;
		const playtime = appendObservation(game.playtime, entry.patch.playtimeObservation);
		const achievements = entry.patch.achievements === undefined
			? game.achievements
			: [...(game.achievements ?? []), ...entry.patch.achievements];
		const lastPlayed = entry.patch.lastPlayed?.value ?? game.lastPlayed;
		return {
			...game,
			playtime,
			...(lastPlayed === undefined ? {} : { lastPlayed }),
			...(entry.patch.lastPlayed === undefined ? {} : { activity: { ...game.activity, lastPlayed: entry.patch.lastPlayed } }),
			...(achievements === undefined ? {} : { achievements }),
		};
	});
	return { ...snapshot, games, enrichments: [result] };
}

function appendObservation(playtime: GamePlaytime, observation: PlaytimeObservation | undefined): GamePlaytime {
	return observation === undefined ? playtime : { ...playtime, observations: [...playtime.observations, observation] };
}

export function mergeEnrichmentResults(snapshot: CanonicalLibrarySnapshot, results: readonly GameEnrichmentResult[]): EnrichedCanonicalSnapshot {
	let current: EnrichedCanonicalSnapshot = { ...snapshot, enrichments: [] };
	for (const result of results) current = { ...applyEnrichmentResult(current, result), enrichments: [...current.enrichments, result] };
	return current;
}
