import type { CanonicalGame } from '../model/canonical-game';
import { VaultConflictError } from '../network/errors';
import { applyManagedFrontmatter, serializeNote } from './frontmatter';
import { noteFingerprint, VaultFolderError, type VaultGateway } from './gateway';
import type { CanonicalPropertyMapping } from './canonical-projection';
import type { CanonicalOperation, CanonicalSyncPlan, CanonicalSyncSelection } from '../sync/canonical-planner';

export interface CanonicalVaultWriterOptions {
	readonly propertyMapping?: CanonicalPropertyMapping;
	readonly template?: (game: CanonicalGame) => string;
}

export class CanonicalVaultWriter {
	constructor(private readonly gateway: VaultGateway, _options: CanonicalVaultWriterOptions = {}) {}

	private validateSelection(plan: CanonicalSyncPlan, selection: CanonicalSyncSelection | undefined): {
		readonly selectedOperationIds: readonly string[];
		readonly fieldsByOperation: ReadonlyMap<string, ReadonlySet<string>>;
	} {
		const selectedOperationIds = selection?.operationIds ?? plan.operations.map((operation) => operation.id);
		const operationById = new Map(plan.operations.map((operation) => [operation.id, operation]));
		const selectedIds = new Set<string>();
		for (const operationId of selectedOperationIds) {
			if (selectedIds.has(operationId)) throw new VaultConflictError(`Duplicate canonical operation selection: ${operationId}.`);
			if (!operationById.has(operationId)) throw new VaultConflictError(`Unknown canonical operation selection: ${operationId}.`);
			selectedIds.add(operationId);
		}

		const fieldsByOperation = new Map<string, ReadonlySet<string>>();
		const changesByOperation = new Map(plan.operations.map((operation) => [operation.id, new Set(operation.preview.changes.map((change) => change.fieldId))]));
		const requestedFieldsByOperation = selection?.fieldIdsByOperation ?? Object.fromEntries(plan.operations.map((operation) => [operation.id, operation.preview.changes.map((change) => change.fieldId)]));
		for (const [operationId, fieldIds] of Object.entries(requestedFieldsByOperation)) {
			if (!selectedIds.has(operationId)) throw new VaultConflictError(`Field selection references an unselected canonical operation: ${operationId}.`);
			const seenFields = new Set<string>();
			const knownFields = changesByOperation.get(operationId) ?? new Set<string>();
			for (const fieldId of fieldIds) {
				if (seenFields.has(fieldId)) throw new VaultConflictError(`Duplicate canonical field selection: ${fieldId}.`);
				if (!knownFields.has(fieldId)) throw new VaultConflictError(`Unknown canonical field selection: ${fieldId}.`);
				seenFields.add(fieldId);
			}
			fieldsByOperation.set(operationId, seenFields);
		}
		for (const operationId of selectedIds) {
			const operation = operationById.get(operationId)!;
			const fields = new Set(fieldsByOperation.get(operationId) ?? []);
			if (fields.size === 0) {
				throw new VaultConflictError(`Cannot apply ${operation.path} without selecting a field.`);
			}
			const selectedNonTechnical = operation.preview.changes.some((change) => fields.has(change.fieldId) && change.sourceField !== 'updated');
			if (fields.size > 0 && !selectedNonTechnical) {
				throw new VaultConflictError(`Cannot apply ${operation.path} by selecting only the technical updated field.`);
			}
			if (selectedNonTechnical) {
				for (const change of operation.preview.changes) if (change.sourceField === 'updated') fields.add(change.fieldId);
			}
			if (operation.kind === 'create' && (operation.preview.requiredIdentityFieldIds.length === 0 || !operation.preview.requiredIdentityFieldIds.some((fieldId) => fields.has(fieldId)))) {
				throw new VaultConflictError(`Cannot create ${operation.path} without a selected stable game identity.`);
			}
			fieldsByOperation.set(operationId, fields);
		}
		return { selectedOperationIds, fieldsByOperation };
	}

	private properties(operation: CanonicalOperation, selectedFieldIds?: ReadonlySet<string>): Record<string, unknown> {
		const properties = operation.preview.properties;
		if (selectedFieldIds === undefined) return { ...properties };
		const selectedProperties = new Set(operation.preview.changes.filter((change) => selectedFieldIds.has(change.fieldId)).map((change) => change.property));
		const hasNonTechnical = operation.preview.changes.some((change) => selectedFieldIds.has(change.fieldId) && change.sourceField !== 'updated');
		if (hasNonTechnical) for (const change of operation.preview.changes) if (change.sourceField === 'updated') selectedProperties.add(change.property);
		return Object.fromEntries(Object.entries(properties).filter(([property]) => selectedProperties.has(property)));
	}

	private async create(operation: CanonicalOperation, selectedFieldIds?: ReadonlySet<string>): Promise<void> {
		if (operation.expectedNoteFingerprint !== null || await this.gateway.exists(operation.path)) {
			throw new VaultConflictError(`Cannot create existing note ${operation.path}.`);
		}
		if (selectedFieldIds !== undefined && (operation.preview.requiredIdentityFieldIds.length === 0 || !operation.preview.requiredIdentityFieldIds.some((fieldId) => selectedFieldIds.has(fieldId)))) {
			throw new VaultConflictError(`Cannot create ${operation.path} without a selected stable game identity.`);
		}
		if (operation.preview.body === undefined) throw new VaultConflictError(`Cannot create ${operation.path} without a preview body.`);
		const body = operation.preview.body;
		await this.gateway.create(operation.path, serializeNote(this.properties(operation, selectedFieldIds), body));
	}

	private async update(operation: CanonicalOperation, selectedFieldIds?: ReadonlySet<string>): Promise<void> {
		if (operation.expectedNoteFingerprint === null || !(await this.gateway.exists(operation.path))) {
			throw new VaultConflictError(`Cannot update missing note ${operation.path}.`);
		}
		const content = await this.gateway.read(operation.path);
		if (noteFingerprint(content) !== operation.expectedNoteFingerprint) throw new VaultConflictError(`Stale note preview for ${operation.path}.`);
		await this.gateway.processFrontMatter(operation.path, (frontmatter) => {
			applyManagedFrontmatter(frontmatter, this.properties(operation, selectedFieldIds));
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

	async apply(plan: CanonicalSyncPlan, selection?: CanonicalSyncSelection): Promise<readonly string[]> {
		const validation = this.validateSelection(plan, selection);
		const selectedOperationIds = validation.selectedOperationIds;
		const selected = new Set(selectedOperationIds);
		await this.ensureCreateFolders(plan.operations.filter((operation) => selected.has(operation.id)));
		const applied: string[] = [];
		for (const operation of plan.operations) {
			if (!selected.has(operation.id)) continue;
			const selectedFields = validation.fieldsByOperation.get(operation.id) ?? new Set<string>();
			if (operation.kind === 'create') await this.create(operation, selectedFields);
			else await this.update(operation, selectedFields);
			applied.push(operation.id);
		}
		return applied;
	}
}
