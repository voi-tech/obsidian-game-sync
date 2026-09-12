import type { GameIdentity, ProviderIdentity } from './identity';
import type { NormalizedGame } from './game';
import type { ProviderGame } from './provider';

export type GameOperationKind =
	| 'create-note'
	| 'adopt-note'
	| 'update-properties'
	| 'add-achievement-block'
	| 'update-achievement-block'
	| 'link-providers'
	| 'unlink-providers'
	| 'create-base';

export type OperationRisk = 'safe' | 'review';

export interface OperationInput {
	canonicalGameId: string;
	kind: GameOperationKind;
	risk: OperationRisk;
	path?: string;
	summary: string;
	expectedNoteFingerprint?: string | null;
	planRevision: string;
}

export interface Operation extends OperationInput {
	id: string;
	expectedNoteFingerprint: string | null;
}

export interface SyncPlan {
	id: string;
	planRevision: string;
	operations: Operation[];
	expectedNoteFingerprints: Record<string, string | null>;
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(',')}]`;
	}
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(',')}}`;
}

function deterministicHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createCanonicalGameId(identity: ProviderIdentity | GameIdentity): string {
	if ('canonicalId' in identity) {
		return identity.canonicalId;
	}
	if (identity.provider === 'steam') {
		return `game-sync:steam:${identity.appId}`;
	}
	const concept = identity.conceptId ?? '';
	const titleIds = [...identity.titleIds].sort().join(',');
	const communicationIds = [...identity.npCommunicationIds].sort().join(',');
	return `game-sync:playstation:${concept}:${titleIds}:${communicationIds}`;
}

function copyProviderGame(game: ProviderGame): NormalizedGame['providers'][keyof NormalizedGame['providers']] {
	return {
		providerGameId: game.providerGameId,
		title: game.title,
		originalTitle: game.originalTitle,
		releaseDate: game.releaseDate,
		description: game.description,
		cover: game.cover,
		developers: [...game.developers],
		publishers: [...game.publishers],
		genres: [...game.genres],
		platforms: [...game.platforms],
		owned: game.owned,
		acquisitionType: game.acquisitionType,
		playtimeMinutes: game.playtimeMinutes,
		lastPlayed: game.lastPlayed,
		achievements: game.achievements,
		sourceUrl: game.sourceUrl,
		freshness: { ...game.freshness },
	};
}

export function calculateTotalPlaytime(game: NormalizedGame): number {
	return Object.values(game.providers).reduce((total, providerGame) => total + (providerGame?.playtimeMinutes ?? 0), 0);
}

export function createNormalizedGame(games: readonly ProviderGame[], canonicalId: string): NormalizedGame {
	if (games.length === 0) {
		throw new Error('Cannot normalize an empty provider game set.');
	}
	const first = games[0];
	const providers = Object.fromEntries(games.map((game) => [game.provider, copyProviderGame(game)])) as NormalizedGame['providers'];
	const playtimeMinutes = games.reduce((total, game) => total + (game.playtimeMinutes ?? 0), 0);
	const lastPlayed = games
		.map((game) => game.lastPlayed)
		.filter((value): value is string => value !== undefined)
		.sort()
		.at(-1);
	const steamIdentity = games.find((game) => game.identity.provider === 'steam')?.identity;
	const playstationIdentity = games.find((game) => game.identity.provider === 'playstation')?.identity;
	const identity: GameIdentity = {
		canonicalId,
		steamAppId: steamIdentity?.provider === 'steam' ? steamIdentity.appId : undefined,
		playstation:
			playstationIdentity?.provider === 'playstation'
				? {
						conceptId: playstationIdentity.conceptId,
						titleIds: [...playstationIdentity.titleIds],
						npCommunicationIds: [...playstationIdentity.npCommunicationIds],
				  }
				: undefined,
	};

	return {
		identity,
		canonicalId,
		title: first.title,
		originalTitle: first.originalTitle,
		releaseDate: first.releaseDate,
		description: first.description,
		cover: first.cover,
		developers: [...new Set(games.flatMap((game) => game.developers))],
		publishers: [...new Set(games.flatMap((game) => game.publishers))],
		genres: [...new Set(games.flatMap((game) => game.genres))],
		platforms: [...new Set(games.flatMap((game) => game.platforms))],
		providers,
		owned: games.some((game) => game.owned === true),
		acquisitionType: games.find((game) => game.acquisitionType !== undefined)?.acquisitionType ?? 'unknown',
		playtimeMinutes,
		lastPlayed,
	};
}

export function createOperation(input: OperationInput): Operation {
	const expectedNoteFingerprint = input.expectedNoteFingerprint ?? null;
	const payload = {
		canonicalGameId: input.canonicalGameId,
		kind: input.kind,
		risk: input.risk,
		path: input.path ?? null,
		summary: input.summary,
		expectedNoteFingerprint,
		planRevision: input.planRevision,
	};
	return { ...input, expectedNoteFingerprint, id: `operation:${deterministicHash(stableStringify(payload))}` };
}

export function createSyncPlan(planRevision: string, operations: readonly Operation[]): SyncPlan {
	const expectedNoteFingerprints: Record<string, string | null> = {};
	for (const operation of operations) {
		if (operation.path !== undefined) {
			expectedNoteFingerprints[operation.path] = operation.expectedNoteFingerprint;
		}
	}
	const planPayload = { planRevision, operations, expectedNoteFingerprints };
	return {
		id: `plan:${deterministicHash(stableStringify(planPayload))}`,
		planRevision,
		operations: [...operations],
		expectedNoteFingerprints,
	};
}

export function isSyncPlanStale(
	plan: SyncPlan,
	currentRevision: string,
	currentNoteFingerprints: Readonly<Record<string, string | null | undefined>>,
): boolean {
	if (plan.planRevision !== currentRevision) {
		return true;
	}
	return Object.entries(plan.expectedNoteFingerprints).some(
		([path, expected]) => (currentNoteFingerprints[path] ?? null) !== expected,
	);
}
