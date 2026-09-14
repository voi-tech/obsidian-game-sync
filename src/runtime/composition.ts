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
import type { MatchManagerAdapter } from '../model/match-manager';
import type { LibraryProvider as CanonicalGameProvider } from '../model/canonical-provider';
import { CanonicalSyncService } from '../sync/canonical-service';
import { CanonicalVaultWriter } from '../vault/canonical-writer';
import { canonicalMappingFromLegacy } from '../vault/canonical-projection';
import type { GameTrackRuntimeStatus } from '../model/library-provider';
import type { SyncExecutor } from '../sync/background-executor';
import { createCanonicalSyncExecutor, createLegacySyncExecutor } from './executors';
import type { GameEnricher } from '../model/enrichment';
import type { CanonicalLibrarySnapshot } from '../model/canonical-provider';
import type { LibraryProviderId } from '../model/library-provider';

export interface RuntimeCompositionOptions {
	stateStore: StateStore;
	gateway: VaultGateway;
	adapters?: readonly GameProviderAdapter[];
	createAdapters?: (settings: GameSyncSettings) => readonly GameProviderAdapter[];
	cache?: DisposableCache;
	now?: () => string;
	secretValues?: readonly string[];
	canonicalProvider?: CanonicalGameProvider;
	canonicalProviderFactory?: () => Promise<CanonicalGameProvider | undefined>;
	canonicalProviderFactories?: Partial<Record<LibraryProviderId, (settings: GameSyncSettings) => Promise<CanonicalGameProvider | undefined>>>;
	canonicalStatusFactory?: () => Promise<GameTrackRuntimeStatus>;
	createEnrichers?: (settings: GameSyncSettings) => readonly GameEnricher[];
}

const PROVIDERS = ['steam', 'playstation'] as const satisfies readonly GameProvider[];

export class GameSyncRuntimeComposition {
	private canonicalBackgroundApprovalKey?: string;
	private cachedCanonicalSnapshot?: { sourceKey: string; snapshot: CanonicalLibrarySnapshot };

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

	/** Creates the opt-in neutral path. The desktop provider is injected lazily so mobile never loads Node runtime code. */
	async createCanonicalService(provider = this.options.canonicalProvider, options: { background?: boolean } = {}): Promise<CanonicalSyncService | undefined> {
		const state = await this.options.stateStore.load();
		const selectedId = state.settings.libraryProvider;
		const selectedProvider = provider
			?? (selectedId === undefined ? undefined : await this.options.canonicalProviderFactories?.[selectedId]?.(state.settings))
			?? (selectedId === 'gametrack' ? await this.options.canonicalProviderFactory?.() : undefined)
			?? (selectedId === undefined ? this.options.canonicalProvider : undefined);
		if (selectedProvider === undefined || !selectedProvider.getCapabilities().supported) return undefined;
		const propertyMapping = canonicalMappingFromLegacy(state.propertyMapping);
		const sourceKey = this.canonicalApprovalKey(state.settings);
		const enrichers = this.options.createEnrichers?.(state.settings) ?? [];
		return new CanonicalSyncService({
			provider: selectedProvider,
			enrichers,
			...(options.background && selectedProvider.id === 'gametrack' ? { snapshotOverride: () => this.cachedCanonicalSnapshot?.sourceKey === sourceKey ? this.cachedCanonicalSnapshot.snapshot : undefined, requireSnapshotOverride: true } : {}),
			onLibrarySnapshot: (snapshot) => {
				if (snapshot.status === 'complete') this.cachedCanonicalSnapshot = { sourceKey, snapshot };
			},
			planner: {
				gateway: this.options.gateway,
				notesFolder: state.settings.notesFolder,
				propertyMapping,
			},
			writer: new CanonicalVaultWriter(this.options.gateway, { propertyMapping }),
		});
	}

	/** Creates the provider-neutral executor used by both manual and scheduled composition paths. */
	createSyncExecutor(options: { background?: boolean } = {}): SyncExecutor {
		let active: { executor: SyncExecutor; sourceKey: string } | undefined;
		return {
			canRunAutomatically: async () => {
				const settings = await this.readSettings();
				return settings.libraryProvider !== 'gametrack' || settings.steamEnricherEnabled || settings.playstationEnricherEnabled;
			},
			preview: async () => {
			const settings = await this.readSettings();
			const sourceKey = this.canonicalApprovalKey(settings);
			if (settings.libraryProvider === 'gametrack' || settings.libraryProvider === 'steam' || settings.libraryProvider === 'playstation') {
				const service = await this.createCanonicalService(undefined, options);
				if (service === undefined) throw new Error(`${settings.libraryProvider} provider is unavailable.`);
				const requiresApproval = settings.libraryProvider === 'gametrack';
				active = { executor: createCanonicalSyncExecutor(service, () => !requiresApproval || options.background === true || this.canonicalBackgroundApprovalKey === sourceKey), sourceKey };
				return active.executor.preview();
			}
			active = { executor: createLegacySyncExecutor(await this.createService()), sourceKey };
			return active.executor.preview();
			},
			apply: async (preview, selectedOperationIds) => {
				const settings = await this.readSettings();
				const sourceKey = this.canonicalApprovalKey(settings);
				if (active === undefined || active.sourceKey !== sourceKey) throw new Error('Sync source changed; prepare a new preview.');
				return active.executor.apply(preview, selectedOperationIds);
			},
		};
	}

	/** Explicit manual GameTrack preview/apply permits future scheduled safe writes for this source/database. */
	async approveCanonicalBackgroundSync(): Promise<void> {
		const settings = await this.readSettings();
		if (settings.libraryProvider === 'gametrack') this.canonicalBackgroundApprovalKey = this.canonicalApprovalKey(settings);
	}

	async getGameTrackStatus(): Promise<GameTrackRuntimeStatus> {
		if (this.options.canonicalStatusFactory !== undefined) return this.options.canonicalStatusFactory();
		return { code: 'EXPORT_NOT_SELECTED', supported: true, database: 'unavailable', schema: 'unknown', games: 0, platforms: [], transport: 'csv-export' };
	}

	async createMatchManager(): Promise<MatchManagerAdapter> {
		const service = await this.createService();
		await service.prepareMatchManagerSnapshot();
		return service.createMatchManagerAdapter();
	}

	private async readTemplate(templatePath: string): Promise<string | undefined> {
		if (templatePath.trim().length === 0 || !(await this.options.gateway.exists(templatePath))) return undefined;
		return this.options.gateway.read(templatePath);
	}

	private canonicalApprovalKey(settings: GameSyncSettings): string {
		return `${settings.libraryProvider ?? 'legacy'}:${settings.gametrackExportPath?.trim() || 'none'}:${settings.gametrackExportSize ?? ''}:${settings.gametrackExportModifiedAt ?? ''}`;
	}
}
