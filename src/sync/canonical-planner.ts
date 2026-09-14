import type { CanonicalGame } from '../model/canonical-game';
import { canonicalGameFingerprint } from './canonical-state';
import { noteFingerprint, type VaultGateway } from '../vault/gateway';
import { buildNoteIndex, type NoteIndex } from '../vault/note-index';
import { matchCanonicalVaultNote, type CanonicalIdentityMapping, type VaultMatch } from '../vault/matcher';
import { buildCanonicalManagedProperties, type CanonicalPropertyMapping } from '../vault/canonical-projection';
import { parseFrontmatter } from '../vault/frontmatter';
import type { CanonicalPropertyKey } from '../vault/canonical-projection';
import { NotePathAllocator } from './note-path-allocator';

export type CanonicalPlanStatus = 'create' | 'update' | 'unchanged' | 'conflict' | 'skip';

export interface CanonicalPlannedGame {
	readonly canonicalKey: string;
	readonly status: CanonicalPlanStatus;
	readonly path?: string;
	readonly match?: VaultMatch;
	readonly reason?: string;
}

export interface CanonicalOperation {
	readonly id: string;
	readonly kind: 'create' | 'update';
	readonly canonicalKey: string;
	readonly path: string;
	readonly expectedNoteFingerprint: string | null;
	readonly risk: 'safe' | 'review';
	readonly summary: string;
	readonly game: CanonicalGame;
	readonly existingCanonicalId?: string;
	readonly protectedCanonicalProperties?: readonly CanonicalPropertyKey[];
}

export interface CanonicalSyncPlan {
	readonly id: string;
	readonly planRevision: string;
	readonly operations: readonly CanonicalOperation[];
	readonly statuses: readonly CanonicalPlannedGame[];
	readonly games: readonly CanonicalGame[];
}

export interface CanonicalSyncPlannerOptions {
	readonly gateway: VaultGateway;
	readonly noteIndex?: NoteIndex;
	readonly notesFolder?: string;
	readonly canonicalMappings?: readonly CanonicalIdentityMapping[];
	readonly propertyMapping?: CanonicalPropertyMapping;
	readonly protectedCanonicalProperties?: readonly CanonicalPropertyKey[];
	readonly pathAllocator?: NotePathAllocator;
}

function hash(value: string): string {
	let result = 2166136261;
	for (const character of value) {
		result ^= character.charCodeAt(0);
		result = Math.imul(result, 16777619);
	}
	return (result >>> 0).toString(16).padStart(8, '0');
}

function stable(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(',')}}`;
}

function valuesEqual(left: unknown, right: unknown): boolean {
	return stable(left) === stable(right) || (left === null && Array.isArray(right) && right.length === 0);
}

function projectedPropertiesEqual(game: CanonicalGame, content: string, mapping: CanonicalPropertyMapping | undefined, protectedProperties: readonly CanonicalPropertyKey[] = []): boolean {
	const current = parseFrontmatter(content).frontmatter;
	const expected = buildCanonicalManagedProperties(game, mapping);
	const protectedDestinations = new Set(protectedProperties.flatMap((key) => {
		const value = buildCanonicalManagedProperties(game, { [key]: mapping?.[key] });
		return Object.keys(value);
	}));
	return Object.entries(expected).filter(([key]) => !protectedDestinations.has(key)).every(([key, value]) => valuesEqual(current[key], value));
}

function operationId(operation: Omit<CanonicalOperation, 'id'>): string {
	return `canonical-operation:${hash(stable({ kind: operation.kind, canonicalKey: operation.canonicalKey, path: operation.path, expectedNoteFingerprint: operation.expectedNoteFingerprint, game: canonicalGameFingerprint(operation.game) }))}`;
}

function planId(planRevision: string, operations: readonly CanonicalOperation[]): string {
	return `canonical-plan:${hash(stable({ planRevision, operations }))}`;
}

export async function planCanonicalSync(games: readonly CanonicalGame[], options: CanonicalSyncPlannerOptions, planRevision?: string): Promise<CanonicalSyncPlan> {
	const index = options.noteIndex ?? await buildNoteIndex(options.gateway, undefined, options.propertyMapping);
	const revision = planRevision ?? `canonical-revision:${hash(games.map(canonicalGameFingerprint).sort().join('|'))}`;
	const statuses: CanonicalPlannedGame[] = [];
	const operations: CanonicalOperation[] = [];
	const assignments = new Map<string, string>();
	const orderedGames = [...games].sort((left, right) => left.identity.canonicalKey.localeCompare(right.identity.canonicalKey));
	const matches = new Map<string, VaultMatch>();
	const newGames: CanonicalGame[] = [];
	for (const game of orderedGames) {
		const match = matchCanonicalVaultNote(game, index, { canonicalMappings: options.canonicalMappings });
		matches.set(game.identity.canonicalKey, match);
		if (match.status !== 'conflict' && match.status !== 'review' && match.note === undefined) newGames.push(game);
		if (match.note !== undefined) assignments.set(match.note.path, game.identity.canonicalKey);
	}
	const allocatedPaths = (options.pathAllocator ?? new NotePathAllocator()).allocateBatch(newGames, {
		notesFolder: options.notesFolder,
		existingPaths: index.notes.map((note) => note.path),
		reservedPaths: new Set(assignments.keys()),
	});
	for (const game of orderedGames) {
		const match = matches.get(game.identity.canonicalKey) ?? matchCanonicalVaultNote(game, index, { canonicalMappings: options.canonicalMappings });
		const path = match.note?.path ?? allocatedPaths.get(game.identity.canonicalKey) ?? '';
		if (match.status === 'conflict' || match.status === 'review') {
			statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'conflict', path: match.note?.path ?? path, match, reason: match.reason ?? 'Matching requires explicit review.' });
			continue;
		}
		if (match.note === undefined) {
			if (path.length === 0) {
				statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'conflict', reason: 'Unable to allocate a unique note path.' });
				continue;
			}
			if (assignments.has(path)) throw new Error(`NotePathAllocator returned a duplicate path: ${path}.`);
			assignments.set(path, game.identity.canonicalKey);
			const input: Omit<CanonicalOperation, 'id'> = { kind: 'create', canonicalKey: game.identity.canonicalKey, path, expectedNoteFingerprint: null, risk: 'safe', summary: `Create ${path}.`, game };
			operations.push({ ...input, id: operationId(input) });
			statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'create', path, match });
			continue;
		}
		const notePath = match.note.path;
		if (assignments.has(notePath) && assignments.get(notePath) !== game.identity.canonicalKey) {
			statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'conflict', path: notePath, match, reason: 'Multiple games resolve to the same note path.' });
			continue;
		}
		assignments.set(notePath, game.identity.canonicalKey);
		const content = await options.gateway.read(notePath);
		if (projectedPropertiesEqual(game, content, options.propertyMapping, options.protectedCanonicalProperties)) {
			statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'unchanged', path: notePath, match });
			continue;
		}
		const existingCanonicalId = typeof match.note.properties['game-sync-id'] === 'string' ? match.note.properties['game-sync-id'] : undefined;
		const input: Omit<CanonicalOperation, 'id'> = {
			kind: 'update', canonicalKey: game.identity.canonicalKey, path: notePath, expectedNoteFingerprint: noteFingerprint(content), risk: 'safe',
			summary: `Update ${notePath}.`, game, ...(existingCanonicalId === undefined ? {} : { existingCanonicalId }),
			...(options.protectedCanonicalProperties === undefined ? {} : { protectedCanonicalProperties: options.protectedCanonicalProperties }),
		};
		operations.push({ ...input, id: operationId(input) });
		statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'update', path: notePath, match });
	}
	return { id: planId(revision, operations), planRevision: revision, operations, statuses, games: [...games] };
}
