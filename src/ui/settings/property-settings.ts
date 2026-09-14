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

const USER_FACING_PROPERTY_KEYS: readonly ManagedPropertyKey[] = [
	'title', 'released', 'developers', 'publishers', 'genres', 'cover', 'platforms', 'providers', 'owned', 'acquisitionType', 'playtime', 'lastPlayed',
];

function translation(key: string, params?: Record<string, string | number>): string {
	return t(key as TranslationKey, params as never);
}

function localizedValidationMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/duplicate property mapping destination/i.test(message)) return translation('settings.common.mappingDuplicate');
	if (/user-owned/i.test(message)) return translation('settings.common.mappingUserOwned');
	if (/invalid property mapping/i.test(message)) return translation('settings.common.mappingEmpty');
	return message;
}

export class PropertySettings {
	private readonly mapping: PropertyMapping;
	private readonly previousDestinations = new Map<ManagedPropertyKey, string | undefined>();
	private readonly destinationInputs = new Map<ManagedPropertyKey, HTMLInputElement>();
	private statusEl?: HTMLElement;

	constructor(private readonly containerEl: HTMLElement, options: PropertySettingsOptions) {
		this.mapping = { ...options.mapping };
		this.writeMapping = options.writeMapping;
	}

	private readonly writeMapping: PropertySettingsCallback;

	render(): void {
		this.containerEl.replaceChildren();
		this.destinationInputs.clear();
		this.statusEl = this.containerEl.createEl('p');
		this.statusEl.dataset.propertyMappingStatus = 'true';
		this.containerEl.append(this.statusEl);

		for (const key of USER_FACING_PROPERTY_KEYS) {
			const raw = this.mapping[key];
			const enabled = raw !== null && raw !== false;
			const destination = typeof raw === 'string' ? raw : DEFAULT_PROPERTY_MAPPING[key];
			this.previousDestinations.set(key, typeof raw === 'string' ? raw : undefined);
			const setting = new Setting(this.containerEl)
				.setName(translation(`settings.properties.fields.${key}`))
				.setDesc(translation('settings.properties.destinationDescription'));
			setting.addText((component) => {
				const input = component.inputEl;
				input.dataset.propertyDestination = key;
				input.value = destination;
				component.setPlaceholder?.(destination);
				input.disabled = !enabled;
				input.addEventListener('input', () => {
					this.mapping[key] = input.value;
					this.previousDestinations.set(key, input.value);
					void this.persist();
				});
				this.destinationInputs.set(key, input);
			});
			setting.addToggle((component) => {
				const toggleEl = component.toggleEl;
				toggleEl.dataset.propertyEnabled = key;
				component.setValue(enabled);
				component.onChange((nextEnabled) => {
					if (nextEnabled) {
						const previous = this.previousDestinations.get(key);
						if (previous === undefined) delete this.mapping[key];
						else this.mapping[key] = previous;
						const destinationInput = this.destinationInputs.get(key);
						if (destinationInput !== undefined) {
							destinationInput.disabled = false;
							destinationInput.value = previous ?? DEFAULT_PROPERTY_MAPPING[key];
						}
					} else {
						this.previousDestinations.set(key, typeof this.mapping[key] === 'string' ? this.mapping[key] : undefined);
						this.mapping[key] = null;
						const destinationInput = this.destinationInputs.get(key);
						if (destinationInput !== undefined) destinationInput.disabled = true;
					}
					void this.persist();
				});
			});
		}
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
}
