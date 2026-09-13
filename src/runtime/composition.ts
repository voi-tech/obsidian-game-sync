import type { GameProvider } from '../model/provider';
import type { GameSyncSettings } from '../model/settings';
import type { GameProviderAdapter } from '../providers/provider';
import type { StateStore } from '../state/store';
import type { DisposableCache } from '../sync/cache';
import { SyncService } from '../sync/service';
import { SyncPlanner } from '../sync/planner';
import { buildNoteIndex } from '../vault/note-index';
import type { VaultGateway } from '../vault/gateway';
import { VaultWriter } from '../vault/writer';

export interface RuntimeCompositionOptions {
	stateStore: StateStore;
	gateway: VaultGateway;
	adapters?: readonly GameProviderAdapter[];
	createAdapters?: (settings: GameSyncSettings) => readonly GameProviderAdapter[];
	cache?: DisposableCache;
	now?: () => string;
	secretValues?: readonly string[];
}

const PROVIDERS = ['steam', 'playstation'] as const satisfies readonly GameProvider[];

export class GameSyncRuntimeComposition {
	constructor(private readonly options: RuntimeCompositionOptions) {}

	async readSettings(): Promise<GameSyncSettings> {
		return (await this.options.stateStore.load()).settings;
	}

	async createService(providers?: readonly GameProvider[]): Promise<SyncService> {
		const state = await this.options.stateStore.load();
		const noteIndex = await buildNoteIndex(this.options.gateway, state.propertyMapping);
		const planner = new SyncPlanner({
			gateway: this.options.gateway,
			noteIndex,
			notesFolder: state.settings.notesFolder,
			filenamePattern: state.settings.filenamePattern,
			propertyMapping: state.propertyMapping,
		});
		const template = await this.readTemplate(state.settings.templatePath);
		const writer = new VaultWriter(this.options.gateway, {
			...(template === undefined ? {} : { template }),
			propertyMapping: state.propertyMapping,
			achievementOptions: {
				revealHidden: state.settings.revealHiddenAchievements,
				showRarity: state.settings.showAchievementRarity,
				showUnlockDate: state.settings.showUnlockDate,
				showTrophyType: state.settings.showTrophyType,
			},
			revealHidden: state.settings.revealHiddenAchievements,
		});
		const availableAdapters = this.options.createAdapters?.(state.settings) ?? this.options.adapters ?? [];
		const scopedAdapters = providers === undefined
			? [...availableAdapters]
			: availableAdapters.filter((adapter) => providers.includes(adapter.id));
		const enabledProviders = providers === undefined
			? PROVIDERS.filter((provider) => state.settings.enabledProviders[provider])
			: undefined;
		return new SyncService({
			adapters: scopedAdapters,
			planner,
			writer,
			stateStore: this.options.stateStore,
			enabledProviders,
			cache: this.options.cache,
			now: this.options.now,
			secretValues: this.options.secretValues,
		});
	}

	private async readTemplate(templatePath: string): Promise<string | undefined> {
		if (templatePath.trim().length === 0 || !(await this.options.gateway.exists(templatePath))) return undefined;
		return this.options.gateway.read(templatePath);
	}
}
