import type { NormalizedGame } from '../model/game';
import type { PropertyMapping } from '../model/property-mapping';
import { VaultConflictError } from '../network/errors';
import { buildManagedProperties } from '../model/property-mapping';
import { replaceAchievementsBlock } from './managed-block';
import { renderAchievementsBlock, type AchievementRenderOptions } from './achievement-renderer';
import { applyManagedProperties, serializeNote } from './frontmatter';
import { noteFingerprint, type VaultGateway } from './gateway';
import { buildTemplateContext, renderTemplate } from './template';

export interface VaultWriterOptions {
	template?: string;
	propertyMapping?: PropertyMapping;
	achievementOptions?: AchievementRenderOptions;
}

export interface CreateNoteInput {
	path: string;
	game: NormalizedGame;
	expectedNoteFingerprint: null;
	template?: string;
	updatedAt?: string;
}

export interface ExistingNoteInput {
	path: string;
	game: NormalizedGame;
	expectedNoteFingerprint: string;
	updatedAt?: string;
}

export class VaultWriter {
	constructor(private readonly gateway: VaultGateway, private readonly options: VaultWriterOptions = {}) {}

	private updatedAt(value: string | undefined): string {
		return value ?? new Date().toISOString();
	}

	private managedContent(content: string, game: NormalizedGame, updatedAt: string): string {
		const withProperties = applyManagedProperties(content, buildManagedProperties(game, this.options.propertyMapping, updatedAt));
		return replaceAchievementsBlock(withProperties, renderAchievementsBlock(game, this.options.achievementOptions));
	}

	private async processExisting(input: ExistingNoteInput): Promise<void> {
		if (input.expectedNoteFingerprint.trim().length === 0) throw new VaultConflictError('Existing note mutation requires an expected fingerprint.');
		if (!(await this.gateway.exists(input.path))) throw new VaultConflictError(`Cannot mutate missing note ${input.path}.`);
		const expected = input.expectedNoteFingerprint;
		await this.gateway.process(input.path, (content) => {
			if (noteFingerprint(content) !== expected) throw new VaultConflictError(`Stale note preview for ${input.path}.`);
			return this.managedContent(content, input.game, this.updatedAt(input.updatedAt));
		});
	}

	async createNote(input: CreateNoteInput): Promise<void> {
		if (input.expectedNoteFingerprint !== null) throw new VaultConflictError('Create note requires an absent note fingerprint.');
		if (await this.gateway.exists(input.path)) throw new VaultConflictError(`Cannot create existing note ${input.path}.`);
		const context = buildTemplateContext(input.game, { updatedAt: this.updatedAt(input.updatedAt) });
		const template = input.template ?? this.options.template ?? '';
		const body = renderTemplate(template, context);
		const withProperties = serializeNote(buildManagedProperties(input.game, this.options.propertyMapping, this.updatedAt(input.updatedAt)), body);
		await this.gateway.create(input.path, replaceAchievementsBlock(withProperties, renderAchievementsBlock(input.game, this.options.achievementOptions)));
	}

	async adoptNote(input: ExistingNoteInput): Promise<void> {
		await this.processExisting(input);
	}

	async updateNote(input: ExistingNoteInput): Promise<void> {
		await this.processExisting(input);
	}
}
