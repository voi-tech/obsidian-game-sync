import type { GameIdentity } from './identity';
import type { NormalizedGame } from './game';
import type { ProviderGame } from './provider';
import type { GameProvider } from './provider';

export { createCanonicalGameId, resolveCanonicalGameId } from './identity';

export type GameOperationKind =
	| 'create-note'
	| 'adopt-note'
	| 'update-properties'
	| 'add-achievement-block'
	| 'update-achievement-block'
	| 'link-providers'
	| 'unlink-providers'
	| 'unmerge'
	| 'create-base';

export type OperationRisk = 'safe' | 'review';

type OperationBase = {
	canonicalGameId: string;
	risk: OperationRisk;
	path?: string;
	summary: string;
	planRevision: string;
};

type NoteOperationBase = Omit<OperationBase, 'path'> & {
	path: string;
};

export type CreateOperationInput =
	| (NoteOperationBase & {
			kind: 'create-note';
			expectedNoteFingerprint?: null;
	  })
	| (OperationBase & {
			kind: 'create-base';
			expectedNoteFingerprint?: null;
		});

export type UnmergeOperationInput = NoteOperationBase & {
	kind: 'unmerge';
	expectedNoteFingerprint: string;
	newPath: string;
	expectedNewNoteFingerprint: null;
	providerToKeep: GameProvider;
	providerToSplit: GameProvider;
	providerToKeepId: string;
	providerToSplitId: string;
	removeManagedProperties: string[];
};

export type ExistingNoteOperationInput = NoteOperationBase & {
	kind: Exclude<GameOperationKind, 'create-note' | 'create-base' | 'unmerge'>;
	expectedNoteFingerprint: string;
};

export type OperationInput = CreateOperationInput | ExistingNoteOperationInput | UnmergeOperationInput;

export type CreateOperation = CreateOperationInput & {
	id: string;
	expectedNoteFingerprint: null;
};

export type ExistingNoteOperation = ExistingNoteOperationInput & {
	id: string;
};

export type UnmergeOperation = UnmergeOperationInput & { id: string };

export type Operation = CreateOperation | ExistingNoteOperation | UnmergeOperation;

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

export function createOperation(input: CreateOperationInput): CreateOperation;
export function createOperation(input: ExistingNoteOperationInput): ExistingNoteOperation;
export function createOperation(input: UnmergeOperationInput): UnmergeOperation;
export function createOperation(input: OperationInput): Operation {
	const isCreate = input.kind === 'create-note' || input.kind === 'create-base';
	if (input.kind !== 'create-base' && (typeof input.path !== 'string' || input.path.trim().length === 0)) {
		throw new Error(`${input.kind} requires a non-empty note path.`);
	}
	if (isCreate && input.expectedNoteFingerprint !== undefined && input.expectedNoteFingerprint !== null) {
		throw new Error(`${input.kind} requires an absent note fingerprint.`);
	}
	if (!isCreate && (typeof input.expectedNoteFingerprint !== 'string' || input.expectedNoteFingerprint.trim().length === 0)) {
		throw new Error(`${input.kind} requires a non-empty note fingerprint.`);
	}
	if (input.kind === 'unmerge') {
		if (input.providerToKeep === input.providerToSplit) throw new Error('Unmerge providers must be different.');
		if (input.newPath.trim().length === 0 || input.expectedNewNoteFingerprint !== null) throw new Error('Unmerge requires an absent new note.');
		if (input.providerToKeepId.trim().length === 0 || input.providerToSplitId.trim().length === 0) throw new Error('Unmerge provider IDs must not be empty.');
	}
	const expectedNoteFingerprint = input.expectedNoteFingerprint ?? null;
	const payload = {
		canonicalGameId: input.canonicalGameId,
		kind: input.kind,
		risk: input.risk,
		path: input.path ?? null,
		summary: input.summary,
		expectedNoteFingerprint,
		planRevision: input.planRevision,
		...(input.kind === 'unmerge' ? {
			newPath: input.newPath,
			expectedNewNoteFingerprint: input.expectedNewNoteFingerprint,
			providerToKeep: input.providerToKeep,
			providerToSplit: input.providerToSplit,
			providerToKeepId: input.providerToKeepId,
			providerToSplitId: input.providerToSplitId,
			removeManagedProperties: input.removeManagedProperties,
		} : {}),
	};
	if (isCreate) {
		return { ...input, expectedNoteFingerprint: null, id: `operation:${deterministicHash(stableStringify(payload))}` };
	}
	if (typeof input.expectedNoteFingerprint !== 'string') {
		throw new Error('Existing note operation requires a non-empty note fingerprint.');
	}
	return {
		...input,
		expectedNoteFingerprint: input.expectedNoteFingerprint,
		id: `operation:${deterministicHash(stableStringify(payload))}`,
	};
}

export function createSyncPlan(planRevision: string, operations: readonly Operation[]): SyncPlan {
	if (planRevision.trim().length === 0) {
		throw new Error('Sync plan revision must not be empty.');
	}
	const expectedNoteFingerprints: Record<string, string | null> = {};
	for (const operation of operations) {
		if (operation.planRevision !== planRevision) {
			throw new Error('Sync plan operations must use one plan revision.');
		}
		if (operation.kind !== 'create-base') {
			const path = operation.path;
			const previous = expectedNoteFingerprints[path];
			if (previous !== undefined && previous !== operation.expectedNoteFingerprint) {
				throw new Error(`Conflicting note fingerprints for ${path}.`);
			}
			expectedNoteFingerprints[path] = operation.expectedNoteFingerprint;
			if (operation.kind === 'unmerge') expectedNoteFingerprints[operation.newPath] = operation.expectedNewNoteFingerprint;
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
