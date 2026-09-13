import type { IdentityMapping } from '../model/identity';
import type { NormalizedGame } from '../model/game';
import { createOperation, createSyncPlan, type OperationInput, type SyncPlan } from '../model/operations';
import { resolvePropertyMapping, type PropertyMapping } from '../model/property-mapping';
import { noteFingerprint, type VaultGateway } from '../vault/gateway';
import { matchVaultNote, type VaultMatch } from '../vault/matcher';
import { buildNoteIndex, type NoteIndex } from '../vault/note-index';
import { buildTemplateContext, renderFilename } from '../vault/template';
import { diffNote } from './diff';

export type PlannedGameStatus = 'create' | 'adopt' | 'update' | 'unchanged' | 'review' | 'conflict' | 'ignored';

export interface PlannedGame {
	canonicalGameId: string;
	status: PlannedGameStatus;
	path?: string;
	match?: VaultMatch;
	reason?: string;
}

export interface PlannedSyncPlan extends SyncPlan {
	statuses: PlannedGame[];
	games: NormalizedGame[];
}

export interface SyncPlannerOptions {
	gateway: VaultGateway;
	noteIndex: NoteIndex;
	notesFolder?: string;
	filenamePattern?: string;
	mappings?: readonly IdentityMapping[];
	ignoredCanonicalIds?: readonly string[];
	ignoredProviderRefs?: readonly string[];
	propertyMapping?: PropertyMapping;
}

export interface SyncPlannerState {
	identityMappings?: readonly IdentityMapping[];
	ignoredCanonicalIds?: readonly string[];
	ignoredProviderRefs?: readonly string[];
}

function deterministicRevision(games: readonly NormalizedGame[]): string {
	const source = games.map((game) => `${game.canonicalId}:${game.title}:${Object.entries(game.providers).map(([provider, value]) => `${provider}:${value?.providerGameId ?? ''}`).join(',')}`).sort().join('|');
	let hash = 2166136261;
	for (const character of source) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return `revision:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function notePath(game: NormalizedGame, options: SyncPlannerOptions): string {
	const filename = renderFilename(options.filenamePattern ?? '{{title}}', buildTemplateContext(game));
	const folder = (options.notesFolder ?? 'Games').replace(/\/+$/u, '');
	return folder.length > 0 ? `${folder}/${filename}.md` : `${filename}.md`;
}

function createPlannedOperation(input: OperationInput) {
	if (input.kind === 'create-note') return createOperation(input);
	if (input.kind === 'create-base') return createOperation(input);
	return createOperation(input);
}

export class SyncPlanner {
	constructor(private readonly options: SyncPlannerOptions) {}

	async currentNoteFingerprints(): Promise<Readonly<Record<string, string | null>>> {
		const result: Record<string, string | null> = {};
		for (const ref of await this.options.gateway.listMarkdownFiles()) result[ref.path] = noteFingerprint(await this.options.gateway.read(ref.path));
		return result;
	}

	async plan(
		games: readonly NormalizedGame[],
		planRevision = deterministicRevision(games),
		state: SyncPlannerState = {},
	): Promise<PlannedSyncPlan> {
		const noteIndex = await buildNoteIndex(this.options.gateway, this.options.propertyMapping);
		const gameSyncIdKey = resolvePropertyMapping(this.options.propertyMapping).gameSyncId;
		const ignoredCanonicalIds = state.ignoredCanonicalIds ?? this.options.ignoredCanonicalIds;
		const ignoredProviderRefs = new Set(state.ignoredProviderRefs ?? this.options.ignoredProviderRefs);
		const mappings = state.identityMappings ?? this.options.mappings;
		type PathAssignment = { canonicalGameId: string; path: string; statusIndex: number; operationInput?: OperationInput };
		const pathAssignments: PathAssignment[] = [];
		const statuses: PlannedGame[] = [];
		const orderedGames = [...games].sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
		const createCandidates: Array<{ game: NormalizedGame; targetPath: string; match: VaultMatch }> = [];
		for (const game of orderedGames) {
			const targetPath = notePath(game, this.options);
			const hasIgnoredProviderRef = Object.entries(game.providers).some(([provider, providerGame]) => providerGame !== undefined
				&& ignoredProviderRefs.has(`${provider}:${providerGame.providerGameId}`));
			if (ignoredCanonicalIds?.includes(game.canonicalId) || hasIgnoredProviderRef) {
				statuses.push({ canonicalGameId: game.canonicalId, status: 'ignored', path: targetPath });
				continue;
			}
			const match = matchVaultNote(game, noteIndex, {
				targetPath,
				mappings,
				propertyMapping: this.options.propertyMapping,
			});
			if (match.status === 'conflict') {
				statuses.push({ canonicalGameId: game.canonicalId, status: 'conflict', path: targetPath, match, reason: match.reason });
				continue;
			}
			if (match.status === 'review') {
				statuses.push({ canonicalGameId: game.canonicalId, status: 'review', path: match.note?.path ?? targetPath, match, reason: 'The candidate requires explicit review.' });
				continue;
			}
			if (match.note === undefined) {
				createCandidates.push({ game, targetPath, match });
				continue;
			}
			const content = await this.options.gateway.read(match.note.path);
			const diff = diffNote(game, content, this.options.propertyMapping);
			const isAdoption = gameSyncIdKey === undefined || match.note.properties[gameSyncIdKey] !== game.canonicalId;
			if (!diff.changed) {
				statuses.push({ canonicalGameId: game.canonicalId, status: 'unchanged', path: match.note.path, match });
				pathAssignments.push({ canonicalGameId: game.canonicalId, path: match.note.path, statusIndex: statuses.length - 1 });
				continue;
			}
			const kind = isAdoption ? 'adopt-note' : 'update-properties';
			const operationInput: OperationInput = {
				canonicalGameId: game.canonicalId,
				kind,
				path: match.note.path,
				risk: 'safe',
				summary: `${isAdoption ? 'Adopt' : 'Update'} ${match.note.path}.`,
				planRevision,
				expectedNoteFingerprint: noteFingerprint(content),
			};
			statuses.push({ canonicalGameId: game.canonicalId, status: isAdoption ? 'adopt' : 'update', path: match.note.path, match });
			pathAssignments.push({ canonicalGameId: game.canonicalId, path: match.note.path, statusIndex: statuses.length - 1, operationInput });
		}
		for (const candidate of createCandidates) {
			statuses.push({ canonicalGameId: candidate.game.canonicalId, status: 'create', path: candidate.targetPath, match: candidate.match });
			pathAssignments.push({
				canonicalGameId: candidate.game.canonicalId,
				path: candidate.targetPath,
				statusIndex: statuses.length - 1,
				operationInput: {
					canonicalGameId: candidate.game.canonicalId,
					kind: 'create-note',
					path: candidate.targetPath,
					risk: 'safe',
					summary: `Create ${candidate.targetPath}.`,
					planRevision,
					expectedNoteFingerprint: null,
				},
			});
		}
		const assignmentsByPath = new Map<string, PathAssignment[]>();
		for (const assignment of pathAssignments) {
			const list = assignmentsByPath.get(assignment.path) ?? [];
			list.push(assignment);
			assignmentsByPath.set(assignment.path, list);
		}
		const conflictingCanonicalIds = new Set<string>();
		for (const assignments of assignmentsByPath.values()) {
			const canonicalIds = new Set(assignments.map((assignment) => assignment.canonicalGameId));
			if (canonicalIds.size < 2) continue;
			for (const assignment of assignments) {
				conflictingCanonicalIds.add(assignment.canonicalGameId);
				const status = statuses[assignment.statusIndex];
				if (status !== undefined) statuses[assignment.statusIndex] = { ...status, status: 'conflict', reason: 'Multiple games resolve to the same note path.' };
			}
		}
		const operations = pathAssignments.flatMap((assignment) => {
			if (assignment.operationInput === undefined || conflictingCanonicalIds.has(assignment.canonicalGameId)) return [];
			return [createPlannedOperation(assignment.operationInput)];
		});
		return {
			...createSyncPlan(planRevision, operations),
			statuses,
			games: [...games],
		};
	}
}

export function createSyncPlanner(options: SyncPlannerOptions): SyncPlanner {
	return new SyncPlanner(options);
}

export async function planSync(games: readonly NormalizedGame[], options: Omit<SyncPlannerOptions, 'noteIndex'> & { noteIndex?: NoteIndex }): Promise<PlannedSyncPlan> {
	const noteIndex = options.noteIndex ?? await buildNoteIndex(options.gateway);
	return createSyncPlanner({ ...options, noteIndex }).plan(games);
}
