import type { NormalizedGame } from '../model/game';
import type { PropertyMapping } from '../model/property-mapping';
import { VaultConflictError } from '../network/errors';
import { buildManagedProperties } from '../model/property-mapping';
import { replaceAchievementsBlock } from './managed-block';
import { renderAchievementsBlock, type AchievementRenderOptions } from './achievement-renderer';
import { applyManagedFrontmatter, serializeNote } from './frontmatter';
import { noteFingerprint, type VaultGateway } from './gateway';
import { buildTemplateContext, renderTemplate } from './template';

export interface VaultWriterOptions {
	template?: string;
	propertyMapping?: PropertyMapping;
	achievementOptions?: AchievementRenderOptions;
	revealHidden?: boolean;
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

	private shouldUpdateAchievements(game: NormalizedGame): boolean {
		return Object.values(game.providers).every((provider) => provider?.freshness.achievements === true);
	}

	private async processExisting(input: ExistingNoteInput): Promise<void> {
		if (input.expectedNoteFingerprint.trim().length === 0) throw new VaultConflictError('Existing note mutation requires an expected fingerprint.');
		if (!(await this.gateway.exists(input.path))) throw new VaultConflictError(`Cannot mutate missing note ${input.path}.`);
		const expected = input.expectedNoteFingerprint;
		const current = await this.gateway.read(input.path);
		if (noteFingerprint(current) !== expected) throw new VaultConflictError(`Stale note preview for ${input.path}.`);
		const achievementsFresh = this.shouldUpdateAchievements(input.game);
		const renderedAchievements = achievementsFresh ? renderAchievementsBlock(input.game, this.options.achievementOptions) : '';
		replaceAchievementsBlock(current, renderedAchievements);
		const updatedAt = this.updatedAt(input.updatedAt);
		await this.gateway.processFrontMatter(input.path, (frontmatter) => {
			applyManagedFrontmatter(frontmatter, buildManagedProperties(input.game, this.options.propertyMapping, updatedAt));
		});
		const afterFrontmatter = await this.gateway.read(input.path);
		const expectedAfterFrontmatter = noteFingerprint(afterFrontmatter);
		await this.gateway.process(input.path, (content) => {
			if (noteFingerprint(content) !== expectedAfterFrontmatter) throw new VaultConflictError(`Stale note preview for ${input.path}.`);
			return replaceAchievementsBlock(content, renderedAchievements);
		});
	}

	async createNote(input: CreateNoteInput): Promise<void> {
		if (input.expectedNoteFingerprint !== null) throw new VaultConflictError('Create note requires an absent note fingerprint.');
		if (await this.gateway.exists(input.path)) throw new VaultConflictError(`Cannot create existing note ${input.path}.`);
		const updatedAt = this.updatedAt(input.updatedAt);
		const context = buildTemplateContext(input.game, { updatedAt, revealHidden: this.options.revealHidden });
		const template = input.template ?? this.options.template ?? '';
		const body = renderTemplate(template, context);
		const withProperties = serializeNote(buildManagedProperties(input.game, this.options.propertyMapping, updatedAt), body);
		const renderedAchievements = this.shouldUpdateAchievements(input.game) ? renderAchievementsBlock(input.game, this.options.achievementOptions) : '';
		await this.gateway.create(input.path, replaceAchievementsBlock(withProperties, renderedAchievements));
	}

	async adoptNote(input: ExistingNoteInput): Promise<void> {
		await this.processExisting(input);
	}

	async updateNote(input: ExistingNoteInput): Promise<void> {
		await this.processExisting(input);
	}
}
