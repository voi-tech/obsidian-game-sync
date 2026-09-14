export type PlaytimeSource = 'steam' | 'playstation' | 'xbox' | 'gametrack';
export type PlaytimeUnit = 'minutes' | 'hours' | 'unknown';
export type PlaytimeConfidence = 'high' | 'medium' | 'low';

export interface PlaytimeInput {
	readonly source: PlaytimeSource;
	readonly rawValue: number | null;
	readonly rawUnit: PlaytimeUnit;
	readonly recordId?: string;
}

export interface PlaytimeObservation {
	readonly source: PlaytimeSource;
	readonly rawValue: number | null;
	readonly rawUnit: PlaytimeUnit;
	readonly normalizedMinutes?: number;
	readonly confidence: PlaytimeConfidence;
	readonly valid: boolean;
	readonly recordId?: string;
}

export interface CanonicalPlaytime {
	readonly minutes?: number;
	readonly source?: PlaytimeSource;
	readonly confidence?: PlaytimeConfidence;
	readonly observations: readonly PlaytimeObservation[];
	readonly anomalies: readonly PlaytimeAnomaly[];
}

export interface PlaytimeAnomaly {
	readonly code: 'aggregate-platform-disagreement';
	readonly aggregateMinutes: number;
	readonly platformMinutes: number;
	readonly deltaMinutes: number;
}

export function normalizePlaytimeObservation(input: PlaytimeInput): PlaytimeObservation {
	if (input.rawValue === null || !Number.isFinite(input.rawValue) || input.rawValue < 0 || input.rawUnit === 'unknown') return { ...input, confidence: 'low', valid: false };
	const normalizedMinutes = input.rawUnit === 'hours' ? input.rawValue * 60 : input.rawValue;
	if (!Number.isFinite(normalizedMinutes) || normalizedMinutes < 0) return { ...input, confidence: 'low', valid: false };
	return { ...input, normalizedMinutes, confidence: input.source === 'gametrack' || input.source === 'steam' ? 'high' : 'medium', valid: true };
}

export function chooseCanonicalPlaytime(observations: readonly PlaytimeObservation[]): CanonicalPlaytime {
	const valid = observations.filter((observation) => observation.valid && observation.normalizedMinutes !== undefined);
	const anomalies = findAnomalies(valid);
	const aggregate = valid.find((observation) => observation.source === 'gametrack');
	if (aggregate) return { minutes: aggregate.normalizedMinutes, source: aggregate.source, confidence: aggregate.confidence, observations, anomalies };
	const platforms = valid.filter((observation) => observation.source !== 'gametrack');
	if (platforms.length === 1) return { minutes: platforms[0].normalizedMinutes, source: platforms[0].source, confidence: platforms[0].confidence, observations, anomalies };
	return { observations, anomalies };
}

function findAnomalies(observations: readonly PlaytimeObservation[]): PlaytimeAnomaly[] {
	const aggregate = observations.find((observation) => observation.source === 'gametrack');
	const platforms = observations.filter((observation) => observation.source !== 'gametrack' && observation.normalizedMinutes !== undefined);
	if (!aggregate || aggregate.normalizedMinutes === undefined || platforms.length < 2) return [];
	const platformMinutes = platforms.reduce((total, observation) => total + (observation.normalizedMinutes ?? 0), 0);
	const deltaMinutes = Math.abs(aggregate.normalizedMinutes - platformMinutes);
	return deltaMinutes > 1 ? [{ code: 'aggregate-platform-disagreement', aggregateMinutes: aggregate.normalizedMinutes, platformMinutes, deltaMinutes }] : [];
}
