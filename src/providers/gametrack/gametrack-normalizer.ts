import type { AchievementSummary, CanonicalGame, GamePlaytime, PlaytimeObservation } from '../../model/canonical-game';
import { chooseCanonicalPlaytime, normalizePlaytimeObservation } from './playtime-policy';
import { normalizePlatform } from './platforms';
import type { GameTrackRawGame } from './gametrack-types';
import { createGameTrackIdentity } from './gametrack-identity';
import { toIsoDate } from '../../model/iso-date';

export interface GameTrackNormalizationDiagnostics {
	readonly unknownPlatforms: readonly string[];
	readonly warnings: readonly { code: string; message: string; field?: string }[];
}

export interface NormalizedGameTrackResult {
	readonly game: CanonicalGame;
	readonly diagnostics: GameTrackNormalizationDiagnostics;
}

export function normalizeGameTrackGame(raw: GameTrackRawGame, schemaSignature: string): NormalizedGameTrackResult {
	const warnings: Array<{ code: string; message: string; field?: string }> = [];
	const normalizedPlatforms = raw.platforms.map(normalizePlatform);
	const unknownPlatforms = normalizedPlatforms.filter((platform) => !platform.known).map((platform) => platform.rawName);
	for (const name of unknownPlatforms) warnings.push({ code: 'unknown-platform', message: `Unknown GameTrack platform: ${name}.`, field: 'platforms' });
	const owned = raw.ownedPlatform === null || raw.ownedPlatform === undefined ? undefined : normalizePlatform(raw.ownedPlatform).id;
	const observations = [
		normalizePlaytimeObservation({ source: 'gametrack', rawValue: raw.playtimeHours ?? null, rawUnit: 'hours' }),
		...raw.platformPlaytime.map((value) => normalizePlaytimeObservation({
			source: value.source, rawValue: value.value, rawUnit: value.unit, recordId: value.id,
		})),
	];
	const chosen = chooseCanonicalPlaytime(observations);
	for (const observation of chosen.observations) {
		if (!observation.valid) warnings.push({ code: 'invalid-playtime', message: 'Invalid playtime observation was excluded from canonical playtime.', field: 'playtime' });
	}
	for (const anomaly of chosen.anomalies) warnings.push({ code: anomaly.code, message: `GameTrack aggregate differs from platform observations by ${anomaly.deltaMinutes} minutes.`, field: 'playtime' });
	const playtime: GamePlaytime = {
		canonical: chosen.minutes === undefined || chosen.source === undefined || chosen.confidence === undefined ? undefined : {
			minutes: chosen.minutes, source: chosen.source, confidence: chosen.confidence,
		},
		observations: chosen.observations.map((observation, index) => ({
			source: observation.source,
			platform: raw.platformPlaytime[index - 1]?.platform,
			rawValue: observation.rawValue,
			rawUnit: observation.rawUnit,
			minutes: observation.normalizedMinutes,
			confidence: observation.confidence,
			valid: observation.valid,
			anomaly: chosen.anomalies.length > 0 && observation.source === 'gametrack' ? 'aggregate-platform-disagreement' : undefined,
		} satisfies PlaytimeObservation)),
	};
	const achievements = raw.achievements.map(toAchievementSummary).filter((value): value is AchievementSummary => value !== undefined);
	const lastPlayed = raw.lastPlayed.map((value) => toIsoDate(value.value, { numericEpoch: 'apple-seconds' })).filter((value): value is string => value !== undefined).sort().at(-1);
	const game: CanonicalGame = {
		identity: createGameTrackIdentity(raw.gameTrackId, raw.igdbId, {
			steam: raw.steamId ?? raw.platformPlaytime.find((value) => value.source === 'steam')?.id,
			playstation: raw.playstationId ?? raw.platformPlaytime.find((value) => value.source === 'playstation')?.id,
			xbox: raw.xboxId,
		}),
		title: raw.title,
		metadata: {
			releaseDate: toIsoDate(raw.releaseDate),
			developers: nonEmptyList(raw.developer),
			publishers: nonEmptyList(raw.publisher),
			genres: [...new Set(raw.genres.filter((genre) => genre.trim().length > 0))],
			summary: nonEmpty(raw.summary),
			cover: nonEmpty(raw.cover),
		},
		platforms: normalizedPlatforms.map((platform) => ({ id: platform.id, source: 'gametrack', ...(platform.known ? {} : { rawName: platform.rawName }), ...(owned === platform.id ? { owned: true } : {}) })),
		playtime,
		...(achievements.length > 0 ? { achievements } : {}),
		...(lastPlayed === undefined ? {} : { lastPlayed }),
		provenance: { provider: 'gametrack', sourceId: raw.gameTrackId, schemaSignature },
	};
	return { game, diagnostics: { unknownPlatforms, warnings } };
}

function toAchievementSummary(value: GameTrackRawGame['achievements'][number]): AchievementSummary | undefined {
	if (value.unlocked === undefined && value.total === undefined) return undefined;
	const complete = value.complete === true && value.unlocked !== undefined && value.total !== undefined;
	const completionPercent = complete && value.total > 0 ? Math.round((value.unlocked / value.total) * 100) : undefined;
	return {
		source: value.source,
		platform: normalizePlatform(value.platform).id,
		...(value.unlocked === undefined ? {} : { unlocked: value.unlocked }),
		...(value.total === undefined ? {} : { total: value.total }),
		...(completionPercent === undefined ? {} : { completionPercent }),
		confidence: complete ? 'high' : 'low',
	};
}

function nonEmpty(value: string | null | undefined): string | undefined {
	return value !== null && value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}

function nonEmptyList(value: string | null | undefined): string[] {
	const item = nonEmpty(value);
	return item === undefined ? [] : [item];
}
