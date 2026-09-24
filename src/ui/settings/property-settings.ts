import { Setting } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import {
	DEFAULT_PROPERTY_MAPPING,
	validatePropertyMapping,
	type ManagedPropertyKey,
	type PropertyMapping,
} from '../../model/property-mapping';

export interface PropertySettingsOptions {
	mapping: PropertyMapping;
	writeMapping: (mapping: PropertyMapping) => void | Promise<void>;
}

type PropertySettingsCallback = PropertySettingsOptions['writeMapping'];

export const PROPERTY_MAPPING_GROUPS = [
	{
		id: 'general',
		labelKey: 'settings.properties.groups.general',
		descriptionKey: 'settings.properties.groupDescriptions.general',
		expanded: true,
		keys: [
			'gameSyncId', 'igdbId', 'gametrackId', 'type', 'title', 'released', 'developers', 'publishers', 'genres', 'cover',
			'platforms', 'providers', 'owned', 'acquisitionType', 'playtime', 'lastPlayed',
		] as const,
	},
	{
		id: 'steam',
		labelKey: 'settings.properties.groups.steam',
		descriptionKey: 'settings.properties.groupDescriptions.steam',
		expanded: false,
		keys: [
			'steamId', 'steamOwned', 'steamPlaytime', 'steamLastPlayed', 'steamAchievementsEarned', 'steamAchievementsTotal', 'steamAchievementsProgress',
		] as const,
	},
	{
		id: 'playstation',
		labelKey: 'settings.properties.groups.playstation',
		descriptionKey: 'settings.properties.groupDescriptions.playstation',
		expanded: false,
		keys: [
			'playstationId', 'playstationOwned', 'playstationPlaytime', 'playstationLastPlayed', 'psnTrophiesEarned', 'psnTrophiesTotal',
			'psnTrophiesProgress', 'psnBronze', 'psnSilver', 'psnGold', 'psnPlatinum',
		] as const,
	},
	{
		id: 'technical',
		labelKey: 'settings.properties.groups.technical',
		descriptionKey: 'settings.properties.groupDescriptions.technical',
		expanded: false,
		keys: ['updated'] as const,
	},
] as const satisfies readonly { id: string; labelKey: string; descriptionKey: string; expanded: boolean; keys: readonly ManagedPropertyKey[] }[];

export const PROPERTY_MAPPING_KEYS: readonly ManagedPropertyKey[] = PROPERTY_MAPPING_GROUPS.flatMap((group) => group.keys);

const propertyMappingKeys = new Set<ManagedPropertyKey>(PROPERTY_MAPPING_KEYS);
if (propertyMappingKeys.size !== PROPERTY_MAPPING_KEYS.length || propertyMappingKeys.size !== Object.keys(DEFAULT_PROPERTY_MAPPING).length) {
	throw new Error('Property mapping groups must contain every managed property key exactly once.');
}

function translation(key: string, params?: Record<string, string | number>): string {
	return t(key as TranslationKey, params as never);
}

function localizedValidationMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/duplicate property mapping destination/i.test(message)) return translation('settings.common.mappingDuplicate');
	if (/invalid property mapping/i.test(message)) return translation('settings.common.mappingEmpty');
	return message;
}

function specialDestinationWarning(key: ManagedPropertyKey, destination: string): string | undefined {
	const special = destination.trim().toLocaleLowerCase();
	if (!['aliases', 'tags', 'cssclasses'].includes(special)) return undefined;
	const arraySources = new Set<ManagedPropertyKey>(['developers', 'publishers', 'genres', 'platforms', 'providers']);
	return arraySources.has(key) ? undefined : translation('settings.common.mappingTypeWarning');
}

export class PropertySettings {
	private readonly mapping: PropertyMapping;
	private statusEl?: HTMLElement;
	private pendingSave: Promise<void> = Promise.resolve();

	constructor(private readonly containerEl: HTMLElement, options: PropertySettingsOptions) {
		this.mapping = { ...options.mapping };
		this.writeMapping = options.writeMapping;
	}

	private readonly writeMapping: PropertySettingsCallback;

	render(): void {
		this.containerEl.replaceChildren();
		this.statusEl = this.containerEl.createEl('p');
		this.statusEl.dataset.propertyMappingStatus = 'true';
		this.containerEl.append(this.statusEl);

		for (const group of PROPERTY_MAPPING_GROUPS) {
			const details = this.containerEl.createEl('details');
			details.dataset.propertyMappingGroup = group.id;
			details.open = group.expanded;
			const summary = details.createEl('summary');
			summary.textContent = translation(group.labelKey);
			const description = details.createEl('p');
			description.textContent = translation(group.descriptionKey);
			for (const key of group.keys) this.renderField(details, key);
		}
	}

	private renderField(parent: HTMLElement, key: ManagedPropertyKey): void {
		const raw = this.mapping[key];
		const disabled = raw === null || raw === false;
		const destination = disabled ? '' : typeof raw === 'string' ? raw : DEFAULT_PROPERTY_MAPPING[key];
		const setting = new Setting(parent)
			.setName(translation(`settings.properties.fields.${key}`))
			.setDesc(`${translation(`settings.properties.descriptions.${key}`)} ${translation(`settings.properties.examples.${key}`)}${destination.length > 0 ? ` ${specialDestinationWarning(key, destination) ?? ''}` : ''}`.trim());
		setting.addText((component) => {
			const input = component.inputEl;
			input.dataset.propertyDestination = key;
			input.value = destination;
			component.setPlaceholder?.(destination);
			input.addEventListener('input', () => {
				const value = input.value.trim();
				this.mapping[key] = value.length === 0 ? null : value;
				void this.queuePersist();
			});
		});
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private async persist(): Promise<void> {
		try {
			validatePropertyMapping(this.mapping);
		} catch (error) {
			this.setStatus(translation('settings.common.mappingValidation', { message: localizedValidationMessage(error) }));
			return;
		}
		try {
			await this.writeMapping({ ...this.mapping });
			this.setStatus(translation('settings.common.mappingSaved'));
		} catch {
			this.setStatus(translation('settings.common.mappingSaveError'));
		}
	}

	private queuePersist(): Promise<void> {
		this.pendingSave = this.pendingSave.then(() => this.persist());
		return this.pendingSave;
	}
}
