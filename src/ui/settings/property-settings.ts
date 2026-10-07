import type { SettingDefinitionGroup } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import {
	DEFAULT_PROPERTY_MAPPING,
	validatePropertyMapping,
	type ManagedPropertyKey,
	type PropertyMapping,
} from '../../model/property-mapping';

export const PROPERTY_MAPPING_GROUPS = [
	{
		id: 'general',
		labelKey: 'settings.properties.groups.general',
		descriptionKey: 'settings.properties.groupDescriptions.general',
		keys: [
			'gameSyncId', 'igdbId', 'gametrackId', 'type', 'title', 'released', 'developers', 'publishers', 'genres', 'cover',
			'platforms', 'providers', 'owned', 'acquisitionType', 'playtime', 'lastPlayed',
		] as const,
	},
	{
		id: 'steam',
		labelKey: 'settings.properties.groups.steam',
		descriptionKey: 'settings.properties.groupDescriptions.steam',
		keys: [
			'steamId', 'steamOwned', 'steamPlaytime', 'steamLastPlayed', 'steamAchievementsEarned', 'steamAchievementsTotal', 'steamAchievementsProgress',
		] as const,
	},
	{
		id: 'playstation',
		labelKey: 'settings.properties.groups.playstation',
		descriptionKey: 'settings.properties.groupDescriptions.playstation',
		keys: [
			'playstationId', 'playstationOwned', 'playstationPlaytime', 'playstationLastPlayed', 'psnTrophiesEarned', 'psnTrophiesTotal',
			'psnTrophiesProgress', 'psnBronze', 'psnSilver', 'psnGold', 'psnPlatinum',
		] as const,
	},
	{
		id: 'technical',
		labelKey: 'settings.properties.groups.technical',
		descriptionKey: 'settings.properties.groupDescriptions.technical',
		keys: ['updated'] as const,
	},
] as const satisfies readonly { id: string; labelKey: string; descriptionKey: string; keys: readonly ManagedPropertyKey[] }[];

export const PROPERTY_MAPPING_KEYS: readonly ManagedPropertyKey[] = PROPERTY_MAPPING_GROUPS.flatMap((group) => group.keys);

const propertyMappingKeys = new Set<ManagedPropertyKey>(PROPERTY_MAPPING_KEYS);
if (propertyMappingKeys.size !== PROPERTY_MAPPING_KEYS.length || propertyMappingKeys.size !== Object.keys(DEFAULT_PROPERTY_MAPPING).length) {
	throw new Error('Property mapping groups must contain every managed property key exactly once.');
}

/** Control keys for mapping fields are namespaced so the settings tab can route them away from plugin settings. */
export const PROPERTY_CONTROL_PREFIX = 'property:';

function translation(key: string, params?: Record<string, string | number>): string {
	return t(key as TranslationKey, params as never);
}

function isManagedKey(key: string): key is ManagedPropertyKey {
	return propertyMappingKeys.has(key as ManagedPropertyKey);
}

function localizedValidationMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/duplicate property mapping destination/i.test(message)) return translation('settings.common.mappingDuplicate');
	if (/invalid property mapping/i.test(message)) return translation('settings.common.mappingEmpty');
	return message;
}

const ARRAY_SOURCES = new Set<ManagedPropertyKey>(['developers', 'publishers', 'genres', 'platforms', 'providers']);

export function specialDestinationWarning(key: ManagedPropertyKey, destination: string): string | undefined {
	const special = destination.trim().toLocaleLowerCase();
	if (!['aliases', 'tags', 'cssclasses'].includes(special)) return undefined;
	return ARRAY_SOURCES.has(key) ? undefined : translation('settings.common.mappingTypeWarning');
}

/** In-memory property mapping with validation and serialized persistence. */
export class PropertyMappingStore {
	private mapping: PropertyMapping = {};
	private pendingSave: Promise<boolean> = Promise.resolve(true);

	constructor(private readonly write: (mapping: PropertyMapping) => void | Promise<void>) {}

	reset(mapping: PropertyMapping): void {
		this.mapping = { ...mapping };
	}

	/** Current destination; an empty string means the property is not written. */
	destination(key: string): string {
		if (!isManagedKey(key)) return '';
		const raw = this.mapping[key];
		if (raw === null || raw === false) return '';
		return typeof raw === 'string' ? raw : DEFAULT_PROPERTY_MAPPING[key];
	}

	/** Returns a localized error when the candidate destination would make the mapping invalid. */
	validate(key: string, value: string): string | undefined {
		if (!isManagedKey(key)) return undefined;
		try {
			validatePropertyMapping(this.candidate(key, value));
			return undefined;
		} catch (error) {
			return localizedValidationMessage(error);
		}
	}

	set(key: string, value: string): Promise<boolean> {
		if (!isManagedKey(key) || this.validate(key, value) !== undefined) return Promise.resolve(false);
		this.mapping = this.candidate(key, value);
		const snapshot = { ...this.mapping };
		this.pendingSave = this.pendingSave.then(async () => {
			try { await this.write(snapshot); return true; }
			catch { return false; }
		});
		return this.pendingSave;
	}

	private candidate(key: ManagedPropertyKey, value: string): PropertyMapping {
		const trimmed = value.trim();
		return { ...this.mapping, [key]: trimmed.length === 0 ? null : trimmed };
	}
}

export function propertyMappingGroups(store: PropertyMappingStore): SettingDefinitionGroup[] {
	return PROPERTY_MAPPING_GROUPS.map((group): SettingDefinitionGroup => ({
		type: 'group',
		heading: translation(group.labelKey),
		items: [
			{ name: '', desc: translation(group.descriptionKey), searchable: false },
			...group.keys.map((key) => {
				const warning = specialDestinationWarning(key, store.destination(key));
				return {
					name: translation(`settings.properties.fields.${key}`),
					desc: [translation(`settings.properties.descriptions.${key}`), translation(`settings.properties.examples.${key}`), warning].filter((part) => part !== undefined).join(' '),
					aliases: [key, DEFAULT_PROPERTY_MAPPING[key]],
					control: {
						type: 'text' as const,
						key: `${PROPERTY_CONTROL_PREFIX}${key}`,
						placeholder: translation('settings.properties.disabledPlaceholder'),
						validate: (value: string) => store.validate(key, value),
					},
				};
			}),
		],
	}));
}
