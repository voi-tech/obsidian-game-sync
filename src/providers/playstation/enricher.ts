import type { AchievementDetail, CanonicalGame } from '../../model/canonical-game';
import type { CanonicalLibrarySnapshot } from '../../model/canonical-provider';
import type { CanonicalGamePatch, GameEnricher, GameEnricherCapabilities, GameEnrichmentResult } from '../../model/enrichment';
import { normalizePlayStationTrophies, choosePlayStationNpServiceName } from './trophies';
import type { PlayStationApi, PlayStationAuthService, PlayStationPlayedGame } from './types';

export interface PlayStationEnricherOptions {
	readonly auth: PlayStationAuthService;
	readonly api: PlayStationApi;
	readonly now?: () => string;
}

const CAPABILITIES: GameEnricherCapabilities = { playtime: true, activity: true, achievementSummary: true, achievementDetails: true };

export function createPlayStationEnricher(options: PlayStationEnricherOptions): GameEnricher {
	return { id: 'playstation', getCapabilities: () => CAPABILITIES, enrich: async (snapshot) => enrichPlayStation(snapshot, options) };
}

async function enrichPlayStation(snapshot: CanonicalLibrarySnapshot, options: PlayStationEnricherOptions): Promise<GameEnrichmentResult> {
	const retrievedAt = options.now?.() ?? new Date().toISOString();
	if (snapshot.status !== 'complete') return { source: 'playstation', status: 'failed', retrievedAt, patches: [], diagnostics: [{ code: 'LIBRARY_SNAPSHOT_INCOMPLETE', message: 'PlayStation enrichment requires a complete library snapshot.' }] };
	try {
		await options.auth.getAccessToken();
		const played = await options.api.getUserPlayedGames();
		const diagnostics: GameEnrichmentResult['diagnostics'][number][] = [];
		const patches: NonNullable<GameEnrichmentResult['patches'][number]>[] = [];
		let trophyFailure = false;
		for (const canonical of snapshot.games) {
			if (canonical.identity.externalIds.playstation === undefined && !hasPlayStationPlatform(canonical)) continue;
			const candidate = findPlayedGame(canonical, played.titles);
			const patch: CanonicalGamePatch = {};
			if (candidate !== undefined) {
				const minutes = parseDuration(candidate.playDuration);
				if (minutes !== undefined) patch.playtimeObservation = { source: 'playstation', platform: playStationPlatform(canonical), rawValue: minutes, rawUnit: 'minutes', minutes, confidence: 'high', valid: true };
				if (candidate.lastPlayedDateTime !== undefined) patch.lastPlayed = { value: candidate.lastPlayedDateTime, source: 'playstation', confidence: 'high' };
			}
			const communicationId = canonical.identity.externalIds.playstation;
			if (communicationId !== undefined) {
				const service = choosePlayStationNpServiceName(canonical.platforms.flatMap((platform) => platform.id === 'playstation-5' ? ['ps5'] : platform.id === 'playstation-4' ? ['ps4'] : []));
				if (service === undefined) {
					diagnostics.push({ code: 'TROPHY_SERVICE_UNKNOWN', message: 'PlayStation trophy service could not be determined safely.', canonicalKey: canonical.identity.canonicalKey });
					trophyFailure = true;
				} else {
					try {
						const metadata = await options.api.getTitleTrophies(communicationId, { npServiceName: service });
						const earned = await options.api.getUserTrophiesEarnedForTitle(communicationId, { npServiceName: service });
						if (!metadata.complete || !earned.complete) throw new Error('incomplete trophy snapshot');
						const set = normalizePlayStationTrophies(metadata, earned);
						patch.achievements = [{ source: 'playstation', platform: playStationPlatform(canonical), unlocked: set.earned, total: set.total, completionPercent: set.total === 0 ? undefined : set.progress, confidence: 'high', details: set.achievements.map(toDetail) }];
					} catch {
						trophyFailure = true;
						diagnostics.push({ code: 'TROPHY_REFRESH_FAILED', message: 'PlayStation trophies could not be refreshed; existing values were retained.', canonicalKey: canonical.identity.canonicalKey });
					}
				}
			}
			if (Object.keys(patch).length > 0) patches.push({ canonicalKey: canonical.identity.canonicalKey, source: 'playstation', patch });
		}
		if (!played.complete) diagnostics.push({ code: 'PLAYSTATION_ACTIVITY_PARTIAL', message: 'PlayStation activity pagination was incomplete.' });
		return { source: 'playstation', status: trophyFailure || !played.complete ? 'partial' : 'success', retrievedAt, patches, diagnostics, fingerprint: fingerprint(patches) };
	} catch {
		return { source: 'playstation', status: 'failed', retrievedAt, patches: [], diagnostics: [{ code: 'PLAYSTATION_ENRICHMENT_FAILED', message: 'PlayStation enrichment could not be refreshed.' }] };
	}
}

function findPlayedGame(canonical: CanonicalGame, played: readonly PlayStationPlayedGame[]): PlayStationPlayedGame | undefined {
	const id = canonical.identity.externalIds.playstation;
	const direct = played.filter((entry) => entry.titleId === id || entry.concept?.titleIds?.includes(id ?? ''));
	if (direct.length === 1) return direct[0];
	const title = titleKey(canonical.title);
	const byTitle = played.filter((entry) => titleKey(entry.concept?.name ?? entry.localizedName ?? entry.name) === title);
	return byTitle.length === 1 ? byTitle[0] : undefined;
}

function hasPlayStationPlatform(game: CanonicalGame): boolean { return game.platforms.some((platform) => platform.id === 'playstation-4' || platform.id === 'playstation-5'); }
function playStationPlatform(game: CanonicalGame): string { return game.platforms.some((platform) => platform.id === 'playstation-5') ? 'playstation-5' : 'playstation-4'; }
function titleKey(value: string): string { return value.toLocaleLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/gu, ' ').trim(); }
function parseDuration(value: string | undefined): number | undefined { if (value === undefined) return undefined; const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(value); if (match === null) return undefined; const result = Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) + Number(match[4] ?? 0) / 60; return Number.isFinite(result) ? Math.floor(result) : undefined; }
function toDetail(value: { id: string; name?: string; description?: string; unlocked: boolean; unlockedAt?: string; hidden?: boolean; iconUrl?: string; rarityPercent?: number; trophyType?: string }): AchievementDetail { return { id: value.id, name: value.name, description: value.description, unlocked: value.unlocked, unlockedAt: value.unlockedAt, hidden: value.hidden, iconUrl: value.iconUrl, rarityPercent: value.rarityPercent, trophyType: value.trophyType }; }
function fingerprint(value: unknown): string { let hash = 2166136261; for (const character of JSON.stringify(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }
