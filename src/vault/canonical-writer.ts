import type { CanonicalGame } from '../model/canonical-game';
import { VaultConflictError } from '../network/errors';
import { applyManagedFrontmatter, serializeNote } from './frontmatter';
import { noteFingerprint, VaultFolderError, type VaultGateway } from './gateway';
import { buildCanonicalManagedProperties, resolveCanonicalPropertyMapping, type CanonicalPropertyMapping } from './canonical-projection';
import type { CanonicalOperation, CanonicalSyncPlan } from '../sync/canonical-planner';

export interface CanonicalVaultWriterOptions {
	readonly propertyMapping?: CanonicalPropertyMapping;
	readonly template?: (game: CanonicalGame) => string;
}

function defaultBody(game: CanonicalGame): string {
	return `# ${game.title}\n`;
}

export class CanonicalVaultWriter {
	constructor(private readonly gateway: VaultGateway, private readonly options: CanonicalVaultWriterOptions = {}) {}

	private properties(operation: CanonicalOperation): Record<string, unknown> {
		const properties = buildCanonicalManagedProperties(operation.game, this.options.propertyMapping, {
			canonicalKeyOverride: operation.existingCanonicalId,
		});
		const resolved = resolveCanonicalPropertyMapping(this.options.propertyMapping);
		for (const key of operation.protectedCanonicalProperties ?? []) {
			const destination = resolved[key];
			if (destination !== undefined) delete properties[destination];
		}
		return properties;
	}

	private async create(operation: CanonicalOperation): Promise<void> {
		if (operation.expectedNoteFingerprint !== null || await this.gateway.exists(operation.path)) {
			throw new VaultConflictError(`Cannot create existing note ${operation.path}.`);
		}
		const body = this.options.template?.(operation.game) ?? defaultBody(operation.game);
		await this.gateway.create(operation.path, serializeNote(this.properties(operation), body));
	}

	private async update(operation: CanonicalOperation): Promise<void> {
		if (operation.expectedNoteFingerprint === null || !(await this.gateway.exists(operation.path))) {
			throw new VaultConflictError(`Cannot update missing note ${operation.path}.`);
		}
		const content = await this.gateway.read(operation.path);
		if (noteFingerprint(content) !== operation.expectedNoteFingerprint) throw new VaultConflictError(`Stale note preview for ${operation.path}.`);
		await this.gateway.processFrontMatter(operation.path, (frontmatter) => {
			applyManagedFrontmatter(frontmatter, this.properties(operation));
		}, operation.expectedNoteFingerprint);
	}

	private async ensureCreateFolders(operations: readonly CanonicalOperation[]): Promise<void> {
		const folders = new Set<string>();
		for (const operation of operations) {
			if (operation.kind !== 'create') continue;
			const separator = operation.path.lastIndexOf('/');
			if (separator > 0) folders.add(operation.path.slice(0, separator));
		}
		for (const folder of [...folders].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) {
			try {
				await this.gateway.ensureFolder(folder);
			} catch (error) {
				if (error instanceof VaultFolderError) throw error;
				throw new VaultFolderError('TARGET_FOLDER_CREATE_FAILED', `Unable to prepare vault folder: ${folder}.`);
			}
		}
	}

	async apply(plan: CanonicalSyncPlan, selectedOperationIds?: readonly string[]): Promise<readonly string[]> {
		const selected = selectedOperationIds === undefined ? new Set(plan.operations.map((operation) => operation.id)) : new Set(selectedOperationIds);
		await this.ensureCreateFolders(plan.operations.filter((operation) => selected.has(operation.id)));
		const applied: string[] = [];
		for (const operation of plan.operations) {
			if (!selected.has(operation.id)) continue;
			if (operation.kind === 'create') await this.create(operation);
			else await this.update(operation);
			applied.push(operation.id);
		}
		return applied;
	}
}
