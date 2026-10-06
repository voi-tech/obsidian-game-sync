import type { CanonicalGame } from '../model/canonical-game';
import { canonicalGameFingerprint } from './canonical-state';
import { noteFingerprint, type VaultGateway } from '../vault/gateway';
import { buildNoteIndex, type NoteIndex } from '../vault/note-index';
import { matchCanonicalVaultNote, type CanonicalIdentityMapping, type VaultMatch } from '../vault/matcher';
import { buildCanonicalWriteProperties, defaultCanonicalNoteBody, resolveCanonicalPropertyMapping, type CanonicalPropertyMapping } from '../vault/canonical-projection';
import { parseFrontmatter } from '../vault/frontmatter';
import type { CanonicalPropertyKey } from '../vault/canonical-projection';
import { NotePathAllocator } from './note-path-allocator';
import { readCanonicalTemplate, renderCanonicalTemplate } from '../vault/canonical-template';

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
	readonly preview: CanonicalOperationPreview;
}

export interface CanonicalPropertyChange {
	readonly fieldId: string;
	readonly sourceField: CanonicalPropertyKey;
	readonly property: string;
	readonly previous?: unknown;
	readonly next?: unknown;
}

export interface CanonicalOperationPreview {
	readonly properties: Readonly<Record<string, unknown>>;
	readonly body?: string;
	readonly changes: readonly CanonicalPropertyChange[];
	readonly requiredIdentityFieldIds: readonly string[];
}

export interface CanonicalSyncSelection {
	readonly operationIds: readonly string[];
	readonly fieldIdsByOperation: Readonly<Record<string, readonly string[]>>;
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
	readonly templatePath?: string;
	readonly revealHidden?: boolean;
	readonly updatedAt?: string;
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
	return stable(left) === stable(right) || (typeof left === 'string' && typeof right === 'number' && left === String(right)) || (typeof left === 'number' && typeof right === 'string' && String(left) === right) || (left === null && Array.isArray(right) && right.length === 0);
}

function projectedPropertiesEqual(game: CanonicalGame, content: string, mapping: CanonicalPropertyMapping | undefined, protectedProperties: readonly CanonicalPropertyKey[] = [], canonicalKeyOverride?: string): boolean {
	const current = parseFrontmatter(content).frontmatter;
	const expected = buildCanonicalWriteProperties(game, mapping, { protectedProperties, canonicalKeyOverride });
	const resolved = resolveCanonicalPropertyMapping(mapping);
	return Object.entries(expected).filter(([key]) => key !== resolved.updated).every(([key, value]) => valuesEqual(propertyValue(current, key), value));
}

function propertyValue(properties: Record<string, unknown>, destination: string | undefined): unknown {
	if (destination === undefined) return undefined;
	const expected = properties[destination];
	if (expected !== undefined) return expected;
	const entry = Object.entries(properties).find(([key]) => key.toLocaleLowerCase() === destination.toLocaleLowerCase());
	return entry?.[1];
}

function changesFor(current: Record<string, unknown>, expected: Record<string, unknown>, mapping: CanonicalPropertyMapping | undefined): Omit<CanonicalPropertyChange, 'fieldId'>[] {
	const resolved = resolveCanonicalPropertyMapping(mapping);
	const sourceByDestination = new Map(Object.entries(resolved).flatMap(([source, destination]) => destination === undefined ? [] : [[destination, source as CanonicalPropertyKey]]));
	return Object.entries(expected)
		.filter(([property, next]) => !valuesEqual(propertyValue(current, property), next))
		.map(([property, next]) => {
			const previous = propertyValue(current, property);
			return { sourceField: sourceByDestination.get(property) ?? property as CanonicalPropertyKey, property, ...(previous === undefined ? {} : { previous }), next };
		});
}

function addFieldIds(operationIdValue: string, changes: readonly Omit<CanonicalPropertyChange, 'fieldId'>[]): CanonicalPropertyChange[] {
	return changes.map((change) => ({ ...change, fieldId: `canonical-field:${hash(stable({ operationId: operationIdValue, sourceField: change.sourceField, property: change.property }))}` }));
}

function operationId(operation: Omit<CanonicalOperation, 'id'>): string {
	return `canonical-operation:${hash(stable({ kind: operation.kind, canonicalKey: operation.canonicalKey, path: operation.path, expectedNoteFingerprint: operation.expectedNoteFingerprint, game: canonicalGameFingerprint(operation.game) }))}`;
}

function planId(planRevision: string, operations: readonly CanonicalOperation[]): string {
	return `canonical-plan:${hash(stable({ planRevision, operations }))}`;
}

export async function planCanonicalSync(games: readonly CanonicalGame[], options: CanonicalSyncPlannerOptions, planRevision?: string): Promise<CanonicalSyncPlan> {
	const index = options.noteIndex ?? await buildNoteIndex(options.gateway, options.propertyMapping, options.propertyMapping);
	const revision = planRevision ?? `canonical-revision:${hash(games.map(canonicalGameFingerprint).sort().join('|'))}`;
	const updatedAt = options.updatedAt ?? new Date().toISOString();
	let template: string | undefined;
	let templateLoaded = false;
	const loadTemplate = async (): Promise<string | undefined> => {
		if (!templateLoaded) {
			template = await readCanonicalTemplate(options.gateway, options.templatePath);
			templateLoaded = true;
		}
		return template;
	};
	const resolvedMapping = resolveCanonicalPropertyMapping(options.propertyMapping);
	const statuses: CanonicalPlannedGame[] = [];
	const operations: CanonicalOperation[] = [];
	const assignments = new Map<string, string[]>();
	const orderedGames = [...games].sort((left, right) => left.identity.canonicalKey.localeCompare(right.identity.canonicalKey));
	const matches = new Map<string, VaultMatch>();
	const newGames: CanonicalGame[] = [];
	for (const game of orderedGames) {
		const match = matchCanonicalVaultNote(game, index, { canonicalMappings: options.canonicalMappings });
		matches.set(game.identity.canonicalKey, match);
		if (match.status !== 'conflict' && match.status !== 'review' && match.note === undefined) newGames.push(game);
		if (match.note !== undefined) {
			const assigned = assignments.get(match.note.path) ?? [];
			assigned.push(game.identity.canonicalKey);
			assignments.set(match.note.path, assigned);
		}
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
			assignments.set(path, [game.identity.canonicalKey]);
			const properties = buildCanonicalWriteProperties(game, options.propertyMapping, { updatedAt });
			const provisionalId = operationId({ kind: 'create', canonicalKey: game.identity.canonicalKey, path, expectedNoteFingerprint: null, risk: 'safe', summary: `Create ${path}.`, game, preview: { properties, changes: [], requiredIdentityFieldIds: [] } });
			const changes = addFieldIds(provisionalId, changesFor({}, properties, options.propertyMapping));
			const requiredIdentityFieldIds = changes.filter((change) => ['gameSyncId', 'igdbId', 'gametrackId', 'steamId', 'playstationId'].includes(change.sourceField)).map((change) => change.fieldId);
			if (requiredIdentityFieldIds.length === 0) {
				statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'conflict', path, match, reason: 'At least one stable identity property must be enabled for a new note.' });
				continue;
			}
			const canonicalTemplate = await loadTemplate();
			const body = canonicalTemplate === undefined ? defaultCanonicalNoteBody(game) : renderCanonicalTemplate(canonicalTemplate, game, { revealHidden: options.revealHidden, updatedAt });
			const preview = { properties, body, changes, requiredIdentityFieldIds };
			const input: Omit<CanonicalOperation, 'id'> = {
				kind: 'create', canonicalKey: game.identity.canonicalKey, path, expectedNoteFingerprint: null, risk: 'safe', summary: `Create ${path}.`, game,
				preview,
			};
			operations.push({ ...input, id: operationId(input) });
			statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'create', path, match });
			continue;
		}
		const notePath = match.note.path;
		if ((assignments.get(notePath)?.length ?? 0) > 1) {
			statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'conflict', path: notePath, match, reason: 'Multiple games resolve to the same note path.' });
			continue;
		}

		const content = await options.gateway.read(notePath);
		const existingCanonicalIdValue = propertyValue(match.note.properties, resolvedMapping.gameSyncId);
		const existingCanonicalId = typeof existingCanonicalIdValue === 'string' || typeof existingCanonicalIdValue === 'number' ? String(existingCanonicalIdValue) : undefined;
		if (projectedPropertiesEqual(game, content, options.propertyMapping, options.protectedCanonicalProperties, existingCanonicalId)) {
			statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'unchanged', path: notePath, match });
			continue;
		}
		const updatedProperties = buildCanonicalWriteProperties(game, options.propertyMapping, {
			canonicalKeyOverride: existingCanonicalId,
			protectedProperties: options.protectedCanonicalProperties,
			updatedAt,
		});
		const provisionalId = operationId({ kind: 'update', canonicalKey: game.identity.canonicalKey, path: notePath, expectedNoteFingerprint: noteFingerprint(content), risk: 'safe', summary: `Update ${notePath}.`, game, ...(existingCanonicalId === undefined ? {} : { existingCanonicalId }), ...(options.protectedCanonicalProperties === undefined ? {} : { protectedCanonicalProperties: options.protectedCanonicalProperties }), preview: { properties: updatedProperties, changes: [], requiredIdentityFieldIds: [] } });
		const changes = addFieldIds(provisionalId, changesFor(parseFrontmatter(content).frontmatter, updatedProperties, options.propertyMapping));
		const input: Omit<CanonicalOperation, 'id'> = {
			kind: 'update', canonicalKey: game.identity.canonicalKey, path: notePath, expectedNoteFingerprint: noteFingerprint(content), risk: 'safe',
			summary: `Update ${notePath}.`, game, ...(existingCanonicalId === undefined ? {} : { existingCanonicalId }),
			...(options.protectedCanonicalProperties === undefined ? {} : { protectedCanonicalProperties: options.protectedCanonicalProperties }),
			preview: { properties: updatedProperties, changes, requiredIdentityFieldIds: [] },
		};
		operations.push({ ...input, id: operationId(input) });
		statuses.push({ canonicalKey: game.identity.canonicalKey, status: 'update', path: notePath, match });
	}
	return { id: planId(revision, operations), planRevision: revision, operations, statuses, games: [...games] };
}
