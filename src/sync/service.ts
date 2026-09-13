import { resolveCanonicalGameId } from '../model/identity';
import type { NormalizedGame, NormalizedProviderGame } from '../model/game';
import type { GameSyncData, OperationJournalEntry } from '../state/schema';
import { migrateState } from '../state/migrations';
import type { StateStore } from '../state/store';
import type {
	GameProvider,
	ProviderGame,
	ProviderSnapshot,
} from '../model/provider';
import { isCompleteProviderSnapshot } from '../model/provider';
import type { GameProviderAdapter, ProviderConnectionStatus } from '../providers/provider';
import type { ProviderAchievementSet } from '../model/achievement';
import { createNormalizedGame, createOperation, createSyncPlan } from '../model/operations';
import type { GameEvent } from '../vault/history';
import { createGameEvent } from '../vault/history';
import type { ProviderPresenceState } from '../state/schema';
import { transitionPresence, type PresenceState } from './freshness';
import type { Operation } from '../model/operations';
import type { CachePayloadValidator, DisposableCache } from './cache';
import type { PlannedSyncPlan, SyncPlanner } from './planner';
import { SyncExecutor, type ApplyResult, type ExecutorHook, type ExecutorProgress } from './executor';
import { VaultWriter } from '../vault/writer';
import { sanitizeError } from '../auth/sanitize';

export type ServiceProviderState = 'success' | 'partial' | 'failed';

export interface ProviderStatusSummary {
	provider: GameProvider;
	state: ServiceProviderState;
	gamesFetched: number;
	fetchedAt?: string;
	connection?: ProviderConnectionStatus;
	error?: { code: string; message: string };
}

export interface ProviderPreparation {
	provider: GameProvider;
	providerStatus: ProviderStatusSummary;
	snapshot?: ProviderSnapshot;
	providerGames?: ProviderGame[];
	presence?: ProviderPresenceState[];
	games: NormalizedGame[];
	gamesFetched: number;
	warnings: string[];
	plan: PlannedSyncPlan;
}

export interface PreparedSync {
	plan: PlannedSyncPlan;
	games: NormalizedGame[];
	providerStatuses: Record<GameProvider, ProviderStatusSummary>;
	providerResults: Partial<Record<GameProvider, ProviderPreparation>>;
	gamesFetched: number;
	operationsCreated: number;
	warnings: string[];
	reviewRequiredCount: number;
	ignored: number;
	previewRequired: boolean;
	presence?: ProviderPresenceState[];
}

export interface SyncApplyResult {
	plan: PlannedSyncPlan;
	providerStatuses: Record<GameProvider, ProviderStatusSummary>;
	gamesFetched: number;
	operationsCreated: number;
	operationsApplied: number;
	operationsAppliedIds: string[];
	pendingOperationIds: string[];
	deselectedOperationIds: string[];
	deselected: number;
	ignored: number;
	warnings: string[];
	reviewRequiredCount: number;
}

export interface SyncServiceOptions {
	adapters: readonly GameProviderAdapter[] | Partial<Record<GameProvider, GameProviderAdapter>>;
	planner: SyncPlanner;
	writer: VaultWriter;
	stateStore?: StateStore;
	state?: GameSyncData;
	enabledProviders?: readonly GameProvider[];
	now?: () => string;
	cache?: DisposableCache;
	onProviderState?: ExecutorHook;
	onHistory?: ExecutorHook;
	onCache?: ExecutorHook;
	history?: EventHistorySink;
	secretValues?: readonly string[];
}

export interface EventHistorySink {
	record(event: GameEvent, noteApplied: boolean): Promise<boolean> | boolean;
}

export interface PrepareProviderOptions {
	now?: string;
	force?: boolean;
	achievementCacheTtlMs?: number;
}

interface ProviderFetchRecord {
	fetchedAt: string;
	playtimeMinutes?: number;
	lastPlayed?: string;
	achievements?: ProviderGame['achievements'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(record).every((key) => allowed.has(key));
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === 'string';
}

function isProviderAchievement(value: unknown): boolean {
	if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'name', 'description', 'unlocked', 'unlockedAt', 'hidden', 'rarityPercent', 'trophyType', 'iconUrl'])) return false;
	const trophyTypes = new Set(['bronze', 'silver', 'gold', 'platinum']);
	return typeof value.id === 'string'
		&& value.id.trim().length > 0
		&& isOptionalString(value.name)
		&& isOptionalString(value.description)
		&& typeof value.unlocked === 'boolean'
		&& isOptionalString(value.unlockedAt)
		&& typeof value.hidden === 'boolean'
		&& (value.rarityPercent === undefined || (typeof value.rarityPercent === 'number' && Number.isFinite(value.rarityPercent) && value.rarityPercent >= 0 && value.rarityPercent <= 100))
		&& (value.trophyType === undefined || (typeof value.trophyType === 'string' && trophyTypes.has(value.trophyType)))
		&& isOptionalString(value.iconUrl);
}

export const isProviderAchievementSet = (value: unknown): value is ProviderAchievementSet => {
	if (!isRecord(value) || !hasOnlyKeys(value, ['earned', 'total', 'progress', 'achievements']) || !Array.isArray(value.achievements)) return false;
	const earned = value.earned;
	const total = value.total;
	const progress = value.progress;
	return typeof earned === 'number' && Number.isInteger(earned) && earned >= 0
		&& typeof total === 'number' && Number.isInteger(total) && total >= 0 && earned <= total
		&& typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100
		&& value.achievements.every(isProviderAchievement)
		&& total === value.achievements.length
		&& earned === value.achievements.filter((achievement: unknown) => isRecord(achievement) && achievement.unlocked === true).length;
};

const isProviderFetchRecord: CachePayloadValidator<ProviderFetchRecord> = (value): value is ProviderFetchRecord => {
	if (!isRecord(value) || !hasOnlyKeys(value, ['fetchedAt', 'playtimeMinutes', 'lastPlayed', 'achievements'])) return false;
	const record = value;
	return typeof record.fetchedAt === 'string'
		&& (record.playtimeMinutes === undefined || (typeof record.playtimeMinutes === 'number' && Number.isFinite(record.playtimeMinutes)))
		&& (record.lastPlayed === undefined || typeof record.lastPlayed === 'string')
		&& (record.achievements === undefined || isProviderAchievementSet(record.achievements));
};

function providerLabel(provider: GameProvider): string {
	return provider === 'steam' ? 'Steam' : 'PlayStation';
}

function errorDetails(error: unknown, secretValues: readonly string[] = []): { code: string; message: string } {
	if (error instanceof Error) {
		const code = 'code' in error && typeof error.code === 'string' ? error.code : 'provider-failure';
		return { code: sanitizeError(code, secretValues), message: sanitizeError(error.message, secretValues) };
	}
	return { code: 'provider-failure', message: sanitizeError('Provider request failed.', secretValues) };
}

function sanitizeProviderSnapshot(snapshot: ProviderSnapshot, secretValues: readonly string[]): ProviderSnapshot {
	if (snapshot.error === undefined) return snapshot;
	return {
		...snapshot,
		error: {
			code: sanitizeError(snapshot.error.code, secretValues),
			message: sanitizeError(snapshot.error.message, secretValues),
		},
	};
}

function sanitizeConnectionStatus(connection: ProviderConnectionStatus | undefined, secretValues: readonly string[]): ProviderConnectionStatus | undefined {
	if (connection === undefined || connection.error === undefined) return connection;
	return {
		...connection,
		error: {
			code: sanitizeError(connection.error.code, secretValues),
			message: sanitizeError(connection.error.message, secretValues),
		},
	};
}

function cloneProviderGame(game: ProviderGame): ProviderGame {
	const identity = game.identity.provider === 'steam'
		? { ...game.identity }
		: (() => {
			const titleIds = [...game.identity.titleIds];
			const npCommunicationIds = [...game.identity.npCommunicationIds];
			if (game.identity.conceptId !== undefined) return { provider: 'playstation' as const, conceptId: game.identity.conceptId, titleIds, npCommunicationIds };
			if (titleIds.length > 0) return { provider: 'playstation' as const, titleIds: titleIds as [string, ...string[]], npCommunicationIds };
			return { provider: 'playstation' as const, titleIds, npCommunicationIds: npCommunicationIds as [string, ...string[]] };
		})();
	return {
		...game,
		identity,
		developers: [...game.developers],
		publishers: [...game.publishers],
		genres: [...game.genres],
		platforms: [...game.platforms],
		freshness: { ...game.freshness },
		achievements: game.achievements === undefined ? undefined : {
			...game.achievements,
			achievements: game.achievements.achievements.map((achievement) => ({ ...achievement })),
		},
	};
}

function clonePersistedProviderGame(game: ProviderGame): ProviderGame {
	const copy = cloneProviderGame(game);
	delete copy.sourceUrl;
	return copy;
}

function cloneJournalGame(game: NormalizedGame): NormalizedGame {
	const providers = Object.fromEntries(Object.entries(game.providers).map(([provider, value]) => {
		if (value === undefined) return [provider, value];
		const copy = JSON.parse(JSON.stringify(value)) as NormalizedProviderGame;
		delete copy.sourceUrl;
		return [provider, copy];
	})) as NormalizedGame['providers'];
	return {
		...JSON.parse(JSON.stringify(game)) as NormalizedGame,
		providers,
		developers: [...game.developers],
		publishers: [...game.publishers],
		genres: [...game.genres],
		platforms: [...game.platforms],
	};
}

function sameNormalizedGame(left: NormalizedGame | undefined, right: NormalizedGame | undefined): boolean {
	const comparable = (game: NormalizedGame): string => JSON.stringify(game, (key, value: unknown) => key === 'sourceUrl' ? undefined : value);
	return left !== undefined && right !== undefined && comparable(left) === comparable(right);
}

function rebaseRecoveryOperation(operation: Operation, planRevision: string): Operation {
	if (operation.planRevision === planRevision) return operation;
	const common = {
		canonicalGameId: operation.canonicalGameId,
		risk: operation.risk,
		summary: operation.summary,
		planRevision,
	};
	if (operation.kind === 'create-note') {
		return createOperation({ ...common, kind: 'create-note', path: operation.path, expectedNoteFingerprint: null });
	}
	if (operation.kind === 'create-base') {
		return createOperation({ ...common, kind: 'create-base', expectedNoteFingerprint: null });
	}
	return createOperation({
		...common,
		kind: operation.kind,
		path: operation.path,
		expectedNoteFingerprint: operation.expectedNoteFingerprint,
	});
}

function retainPreviousAchievements(current: ProviderGame, previous: readonly ProviderGame[]): ProviderGame {
	const previousGame = previous.find((candidate) => candidate.providerGameId === current.providerGameId);
	if (current.achievements !== undefined || previousGame?.achievements === undefined) return cloneProviderGame(current);
	const retained = cloneProviderGame(current);
	retained.achievements = {
		...previousGame.achievements,
		achievements: previousGame.achievements.achievements.map((achievement) => ({ ...achievement })),
	};
	retained.freshness = { ...retained.freshness, achievements: false };
	return retained;
}

function providerGameToNormalized(game: ProviderGame, canonicalId: string): NormalizedGame {
	return createNormalizedGame([game], canonicalId);
}

function mergeProviderStates(games: readonly NormalizedGame[]): NormalizedGame {
	if (games.length === 0) throw new Error('Cannot merge an empty game set.');
	const first = games[0];
	const providers: NormalizedGame['providers'] = {};
	for (const game of games) {
		for (const [provider, providerGame] of Object.entries(game.providers) as [GameProvider, NormalizedProviderGame | undefined][]) {
			if (providerGame !== undefined) providers[provider] = {
				...providerGame,
				developers: [...providerGame.developers],
				publishers: [...providerGame.publishers],
				genres: [...providerGame.genres],
				platforms: [...providerGame.platforms],
				freshness: { ...providerGame.freshness },
			};
		}
	}
	const providerValues = Object.values(providers);
	const lastPlayed = providerValues.map((provider) => provider?.lastPlayed).filter((value): value is string => value !== undefined).sort().at(-1);
	return {
		identity: {
			canonicalId: first.canonicalId,
			steamAppId: games.find((game) => game.identity.steamAppId !== undefined)?.identity.steamAppId,
			playstation: games.find((game) => game.identity.playstation !== undefined)?.identity.playstation,
		},
		canonicalId: first.canonicalId,
		title: games.find((game) => game.title.trim().length > 0)?.title ?? first.title,
		originalTitle: games.find((game) => game.originalTitle !== undefined)?.originalTitle,
		releaseDate: games.find((game) => game.releaseDate !== undefined)?.releaseDate,
		description: games.find((game) => game.description !== undefined)?.description,
		cover: games.find((game) => game.cover !== undefined)?.cover,
		developers: [...new Set(games.flatMap((game) => game.developers))],
		publishers: [...new Set(games.flatMap((game) => game.publishers))],
		genres: [...new Set(games.flatMap((game) => game.genres))],
		platforms: [...new Set(games.flatMap((game) => game.platforms))],
		providers,
		owned: games.some((game) => game.owned),
		acquisitionType: games.find((game) => game.acquisitionType !== 'unknown')?.acquisitionType ?? 'unknown',
		playtimeMinutes: providerValues.reduce((total, game) => total + (game?.playtimeMinutes ?? 0), 0),
		lastPlayed,
	};
}

function hashRevision(value: string): string {
	let hash = 2166136261;
	for (const character of value) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return `service:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function revisionFor(games: readonly NormalizedGame[], statuses: Readonly<Record<GameProvider, ProviderStatusSummary>>): string {
	const gamePart = games.map((game) => JSON.stringify({
		canonicalId: game.canonicalId,
		title: game.title,
		owned: game.owned,
		playtimeMinutes: game.playtimeMinutes,
		lastPlayed: game.lastPlayed,
		providers: Object.fromEntries(Object.entries(game.providers).sort(([left], [right]) => left.localeCompare(right))),
	})).sort().join('|');
	const statusPart = Object.values(statuses).map((status) => `${status.provider}:${status.state}:${status.gamesFetched}`).sort().join('|');
	return hashRevision(`${statusPart}|${gamePart}`);
}

function emptyPlan(): PlannedSyncPlan {
	return {
		id: 'plan:empty',
		planRevision: 'service:empty',
		operations: [],
		expectedNoteFingerprints: {},
		statuses: [],
		games: [],
	};
}

function cloneState(state: GameSyncData): GameSyncData {
	return JSON.parse(JSON.stringify(state)) as GameSyncData;
}

function presenceState(record: ProviderPresenceState | undefined): PresenceState | undefined {
	if (record === undefined) return undefined;
	if (record.consecutiveMissing >= 2) return 'missing-confirmed';
	if (record.consecutiveMissing === 1) return 'missing-once';
	return 'present';
}

function clonePresence(record: ProviderPresenceState): ProviderPresenceState {
	return { ...record };
}

function mergeProviderGame(current: ProviderGame, baseline: ProviderGame | undefined): ProviderGame {
	const merged = cloneProviderGame(current);
	if (baseline === undefined) return merged;
	const metadataFresh = current.freshness.metadata;
	if (!metadataFresh) {
		merged.title = baseline.title;
		merged.originalTitle = baseline.originalTitle;
		merged.releaseDate = baseline.releaseDate;
		merged.description = baseline.description;
		merged.cover = baseline.cover;
		merged.developers = [...baseline.developers];
		merged.publishers = [...baseline.publishers];
		merged.genres = [...baseline.genres];
		merged.platforms = [...baseline.platforms];
		merged.sourceUrl = baseline.sourceUrl;
		merged.identity = cloneProviderGame(baseline).identity;
	}
	if (!current.freshness.ownership) {
		merged.owned = baseline.owned;
		merged.acquisitionType = baseline.acquisitionType;
	}
	if (!current.freshness.playtime) {
		merged.playtimeMinutes = baseline.playtimeMinutes;
		merged.lastPlayed = baseline.lastPlayed;
	}
	if (!current.freshness.achievements || merged.achievements === undefined) {
		if (baseline.achievements === undefined) return merged;
		merged.achievements = {
			...baseline.achievements,
			achievements: baseline.achievements.achievements.map((achievement) => ({ ...achievement })),
		};
		if (!current.freshness.achievements || current.achievements === undefined) merged.freshness = { ...merged.freshness, achievements: false };
	}
	return merged;
}

export class SyncService {
	private readonly adapters: readonly GameProviderAdapter[];
	private readonly planner: SyncPlanner;
	private readonly writer: VaultWriter;
	private readonly stateStore?: StateStore;
	private readonly initialState?: GameSyncData;
	private readonly enabledProviders?: ReadonlySet<GameProvider>;
	private readonly now: () => string;
	private readonly cache?: DisposableCache;
	private readonly canonicalIds = new Map<string, string>();
	private readonly previousGames = new Map<GameProvider, ProviderGame[]>();
	private readonly committedProviderGames = new Map<GameProvider, ProviderGame[]>();
	private readonly sourceFetchedAt = new Map<string, string>();
	private readonly executors = new Map<string, SyncExecutor>();
	private stateValue?: GameSyncData;
	private stateHydrated = false;
	private currentSourceRevision = 'service:empty';
	private readonly options: SyncServiceOptions;

	constructor(options: SyncServiceOptions) {
		this.options = options;
		const configuredAdapters = options.adapters;
		const adapterMap = configuredAdapters as Partial<Record<GameProvider, GameProviderAdapter>>;
		this.adapters = Array.isArray(configuredAdapters)
			? [...(configuredAdapters as readonly GameProviderAdapter[])]
			: (['steam', 'playstation'] as const).map((provider) => adapterMap[provider]).filter((adapter): adapter is GameProviderAdapter => adapter !== undefined);
		this.planner = options.planner;
		this.writer = options.writer;
		this.stateStore = options.stateStore;
		this.initialState = options.state === undefined ? undefined : cloneState(options.state);
		this.enabledProviders = options.enabledProviders === undefined ? undefined : new Set(options.enabledProviders);
		this.now = options.now ?? (() => new Date().toISOString());
		this.cache = options.cache;
	}

	private async loadState(): Promise<GameSyncData> {
		if (this.stateValue === undefined) {
			this.stateValue = this.stateStore !== undefined
				? await this.stateStore.load()
				: this.initialState === undefined ? migrateState(undefined) : migrateState(this.initialState);
		}
		if (!this.stateHydrated) {
			const appliedSnapshots = this.stateValue.lastAppliedProviderSnapshots;
			for (const provider of ['steam', 'playstation'] as const) {
				const games = appliedSnapshots[provider] ?? this.stateValue.lastSuccessfulProviderSnapshots[provider];
				if (games !== undefined) this.committedProviderGames.set(provider, games.map(cloneProviderGame));
			}
			for (const entry of this.stateValue.operationJournal) {
				if (entry.game === undefined) continue;
				for (const [provider, providerGame] of Object.entries(entry.game.providers) as [GameProvider, NormalizedProviderGame | undefined][]) {
					if (providerGame !== undefined) this.canonicalIds.set(`${provider}:${providerGame.providerGameId}`, entry.game.canonicalId);
				}
			}
			this.stateHydrated = true;
		}
		return this.stateValue;
	}

	private async saveState(): Promise<void> {
		if (this.stateValue !== undefined && this.stateStore !== undefined) await this.stateStore.save(cloneState(this.stateValue));
	}

	private adapterFor(provider: GameProvider): GameProviderAdapter | undefined {
		return this.adapters.find((adapter) => adapter.id === provider);
	}

	private async achievementCache(provider: GameProvider, previous: readonly ProviderGame[]): Promise<Readonly<Record<string, ProviderFetchRecord>>> {
		if (this.cache === undefined) return {};
		const entries: Record<string, ProviderFetchRecord> = {};
		for (const game of previous) {
			const cached = await this.cache.get<ProviderFetchRecord>(game.providerGameId, provider, 'achievements', undefined, isProviderFetchRecord);
			if (cached !== undefined && cached.achievements !== undefined) entries[game.providerGameId] = cached;
		}
		return entries;
	}

	private achievementSourceFetchedAt(
		snapshot: ProviderSnapshot,
	): Readonly<Record<string, string>> {
		const result: Record<string, string> = {};
		for (const game of snapshot.games) {
			if (game.freshness.achievements !== true) continue;
			const provenance = snapshot.achievementProvenance?.[game.providerGameId];
			result[game.providerGameId] = provenance?.source === 'cache' && Number.isFinite(Date.parse(provenance.fetchedAt))
				? provenance.fetchedAt
				: snapshot.fetchedAt;
		}
		return result;
	}

	private async invalidateStaleAchievementCache(provider: GameProvider, games: readonly ProviderGame[]): Promise<void> {
		if (this.cache === undefined) return;
		for (const game of games) if (!game.freshness.achievements) await this.cache.delete(game.providerGameId, provider);
	}

	private canonicalIdFor(game: ProviderGame, mappings: GameSyncData['identityMappings']): string {
		const key = `${game.provider}:${game.providerGameId}`;
		const known = this.canonicalIds.get(key);
		if (known !== undefined) return known;
		const durable = mappings.find((mapping) => mapping.provider === game.provider && mapping.providerGameId === game.providerGameId);
		const canonicalId = durable?.canonicalId ?? resolveCanonicalGameId(game.identity, game.providerGameId, mappings);
		this.canonicalIds.set(key, canonicalId);
		return canonicalId;
	}

	private async makeProviderPlan(games: readonly NormalizedGame[], statuses: Readonly<Record<GameProvider, ProviderStatusSummary>>): Promise<PlannedSyncPlan> {
		const planRevision = revisionFor(games, statuses);
		this.currentSourceRevision = planRevision;
		const state = await this.loadState();
		return this.planner.plan(games, planRevision, {
			identityMappings: state.identityMappings,
			ignoredCanonicalIds: state.ignoredCanonicalIds,
			ignoredProviderRefs: state.ignoredProviderRefs,
		});
	}

	private failedPreparation(provider: GameProvider, message: string, error?: { code: string; message: string }): ProviderPreparation {
		const providerStatus: ProviderStatusSummary = { provider, state: 'failed', gamesFetched: 0, ...(error === undefined ? {} : { error }) };
		return {
			provider,
			providerStatus,
			providerGames: [],
			presence: [],
			games: [],
			gamesFetched: 0,
			warnings: [`${providerLabel(provider)}: ${message}`],
			plan: emptyPlan(),
		};
	}

	private async reconcileProviderGames(
		provider: GameProvider,
		snapshot: ProviderSnapshot,
		state: GameSyncData,
		previous: readonly ProviderGame[],
	): Promise<{ providerGames: ProviderGame[]; presence: ProviderPresenceState[] }> {
		const committed = this.committedProviderGames.get(provider);
		const baseline = (committed ?? previous).map(cloneProviderGame);
		const baselineById = new Map(baseline.map((game) => [game.providerGameId, game]));
		const current = snapshot.games.map((game) => retainPreviousAchievements(game, [...previous, ...baseline]));
		const currentById = new Map(current.map((game) => [game.providerGameId, game]));
		const priorPresence = new Map(
			state.presence
				.filter((record) => record.provider === provider)
				.map((record) => [record.providerGameId, record]),
		);
		const ids = [...new Set([...baselineById.keys(), ...currentById.keys(), ...priorPresence.keys()])].sort();
		const complete = isCompleteProviderSnapshot(snapshot);
		const providerGames: ProviderGame[] = [];
		const presence: ProviderPresenceState[] = [];
		for (const providerGameId of ids) {
			const currentGame = currentById.get(providerGameId);
			const baselineGame = baselineById.get(providerGameId);
			const prior = priorPresence.get(providerGameId);
			const observedOwned = currentGame?.freshness.ownership === true ? currentGame.owned : undefined;
			const transition = transitionPresence(presenceState(prior), snapshot, providerGameId, observedOwned);
			const sourceGame = currentGame ?? baselineGame;
			const canonicalGameId = sourceGame === undefined
				? prior?.canonicalGameId
				: this.canonicalIdFor(sourceGame, state.identityMappings);
			if (canonicalGameId === undefined) continue;

			let effectiveGame: ProviderGame | undefined;
			if (currentGame !== undefined) {
				effectiveGame = mergeProviderGame(currentGame, baselineGame);
				if (currentGame.owned === false && currentGame.freshness.ownership && !transition.canReduceOwnership && baselineGame?.owned === true) effectiveGame.owned = true;
				if (transition.canReduceOwnership) effectiveGame.owned = false;
				providerGames.push(effectiveGame);
			} else if (baselineGame !== undefined) {
				effectiveGame = cloneProviderGame(baselineGame);
				if (transition.canReduceOwnership) effectiveGame.owned = false;
				providerGames.push(effectiveGame);
			}

			if (!complete) {
				if (prior !== undefined) presence.push(clonePresence(prior));
				continue;
			}

			if (prior !== undefined || complete) {
				const owned = complete
					? transition.canReduceOwnership
						? false
						: effectiveGame?.owned ?? baselineGame?.owned ?? prior?.owned ?? false
					: baselineGame?.owned ?? prior?.owned ?? currentGame?.owned ?? false;
				presence.push({
					provider,
					providerGameId,
					canonicalGameId,
					owned,
					consecutiveMissing: transition.consecutiveMissing,
					lastSnapshotStatus: snapshot.status,
					paginationComplete: snapshot.paginationComplete,
					...(currentGame !== undefined && complete ? { lastSeenAt: snapshot.fetchedAt } : prior?.lastSeenAt === undefined ? {} : { lastSeenAt: prior.lastSeenAt }),
				});
			}
		}
		return { providerGames, presence };
	}

	private async buildProviderPreparation(
		provider: GameProvider,
		snapshot: ProviderSnapshot,
		state: GameSyncData,
		previous: readonly ProviderGame[],
		connection: ProviderConnectionStatus | undefined,
		warnings: readonly string[],
		achievementSourceFetchedAt: Readonly<Record<string, string>> = {},
	): Promise<ProviderPreparation> {
		const reconciled = await this.reconcileProviderGames(provider, snapshot, state, previous);
		this.previousGames.set(provider, reconciled.providerGames.map(cloneProviderGame));
		const sourcePrefix = `${provider}:`;
		for (const key of this.sourceFetchedAt.keys()) if (key.startsWith(sourcePrefix)) this.sourceFetchedAt.delete(key);
		for (const game of snapshot.games) {
			if (game.freshness.achievements === true) this.sourceFetchedAt.set(`${provider}:${game.providerGameId}`, achievementSourceFetchedAt[game.providerGameId] ?? snapshot.fetchedAt);
		}
		await this.invalidateStaleAchievementCache(provider, reconciled.providerGames);
		const games = reconciled.providerGames.map((game) => providerGameToNormalized(game, this.canonicalIdFor(game, state.identityMappings)));
		const stateValue: ServiceProviderState = snapshot.status === 'partial' ? 'partial' : snapshot.status === 'failed' ? 'failed' : 'success';
		const safeSnapshot = sanitizeProviderSnapshot(snapshot, this.options.secretValues ?? []);
		const safeConnection = sanitizeConnectionStatus(connection, this.options.secretValues ?? []);
		const providerStatus: ProviderStatusSummary = {
			provider,
			state: stateValue,
			gamesFetched: snapshot.status === 'failed' ? 0 : snapshot.games.length,
			fetchedAt: snapshot.fetchedAt,
			connection: safeConnection,
			...(safeSnapshot.error === undefined ? {} : { error: safeSnapshot.error }),
		};
		const statuses = { [provider]: providerStatus } as Record<GameProvider, ProviderStatusSummary>;
		return {
			provider,
			providerStatus,
			snapshot: safeSnapshot,
			providerGames: reconciled.providerGames,
			presence: reconciled.presence,
			games,
			gamesFetched: providerStatus.gamesFetched,
			warnings: [...warnings],
			plan: await this.makeProviderPlan(games, statuses),
		};
	}

	async prepareProvider(provider: GameProvider, fetchOptions: PrepareProviderOptions = {}): Promise<ProviderPreparation> {
		const adapter = this.adapterFor(provider);
		if (adapter === undefined) return this.failedPreparation(provider, 'No provider adapter is configured.', { code: 'provider-not-configured', message: 'No provider adapter is configured.' });
		const state = await this.loadState();
		const committed = this.committedProviderGames.get(provider);
		const persisted = state.lastAppliedProviderSnapshots[provider] ?? state.lastSuccessfulProviderSnapshots[provider];
		const previous = this.previousGames.get(provider)
			?? committed?.map(cloneProviderGame)
			?? persisted?.map(cloneProviderGame)
			?? [];
		const warnings: string[] = [];
		let connection: ProviderConnectionStatus | undefined;
		try {
			connection = await adapter.getConnectionStatus();
		} catch (error) {
			const details = errorDetails(error, this.options.secretValues ?? []);
			warnings.push(`${providerLabel(provider)} connection check failed: ${details.message}`);
		}
		let snapshot: ProviderSnapshot;
		const { force, now, achievementCacheTtlMs } = fetchOptions;
		let achievementCache: Readonly<Record<string, ProviderFetchRecord>> = {};
		try {
			achievementCache = await this.achievementCache(provider, previous);
			snapshot = await adapter.fetchLibrary({
				force,
				now: now ?? this.now(),
				achievementCacheTtlMs,
				previousGames: previous,
				achievementCache,
			});
		} catch (error) {
			const details = errorDetails(error, this.options.secretValues ?? []);
			const failedSnapshot: ProviderSnapshot = {
				provider,
				status: 'failed',
				games: [],
				fetchedAt: fetchOptions.now ?? this.now(),
				pagination: { complete: false, pagesFetched: 0 },
				paginationComplete: false,
				error: details,
			};
			return this.buildProviderPreparation(provider, failedSnapshot, state, previous, connection, [`${providerLabel(provider)} fetch failed: ${details.message}`, ...warnings]);
		}
		if (snapshot.status === 'failed') {
			const safeSnapshot = sanitizeProviderSnapshot(snapshot, this.options.secretValues ?? []);
			const details = safeSnapshot.error ?? { code: 'provider-failure', message: 'Provider returned a failed snapshot.' };
			return this.buildProviderPreparation(provider, safeSnapshot, state, previous, connection, [`${providerLabel(provider)} returned a failed snapshot: ${details.message}`, ...warnings]);
		}
		const safeSnapshot = sanitizeProviderSnapshot(snapshot, this.options.secretValues ?? []);
		if (safeSnapshot.error !== undefined) warnings.push(`${providerLabel(provider)}: ${safeSnapshot.error.message}`);
		return this.buildProviderPreparation(provider, safeSnapshot, state, previous, connection, warnings, this.achievementSourceFetchedAt(safeSnapshot));
	}

	private providersToPrepare(): readonly GameProvider[] {
		return this.adapters.map((adapter) => adapter.id).filter((provider, index, providers) => providers.indexOf(provider) === index && (this.enabledProviders === undefined || this.enabledProviders.has(provider)));
	}

	async prepareAll(): Promise<PreparedSync> {
		const state = await this.loadState();
		const providerResults: Partial<Record<GameProvider, ProviderPreparation>> = {};
		const providerStatuses = {} as Record<GameProvider, ProviderStatusSummary>;
		const warnings: string[] = [];
		for (const provider of this.providersToPrepare()) {
			const result = await this.prepareProvider(provider);
			providerResults[provider] = result;
			providerStatuses[provider] = result.providerStatus;
			warnings.push(...result.warnings);
		}
		const grouped = new Map<string, NormalizedGame[]>();
		for (const result of Object.values(providerResults)) {
			for (const game of result?.games ?? []) {
				const list = grouped.get(game.canonicalId) ?? [];
				list.push(game);
				grouped.set(game.canonicalId, list);
			}
		}
		const games = [...grouped.values()].map(mergeProviderStates).sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
		const planRevision = revisionFor(games, providerStatuses);
		this.currentSourceRevision = planRevision;
		const plan = await this.planner.plan(games, planRevision, {
			identityMappings: state.identityMappings,
			ignoredCanonicalIds: state.ignoredCanonicalIds,
			ignoredProviderRefs: state.ignoredProviderRefs,
		});
		const presence = Object.values(providerResults).flatMap((result) => result?.presence ?? []).map(clonePresence);
		const prepared: PreparedSync = {
			plan,
			games,
			providerStatuses,
			providerResults,
			gamesFetched: Object.values(providerResults).reduce((total, result) => total + (result?.gamesFetched ?? 0), 0),
			operationsCreated: plan.operations.length,
			warnings,
			reviewRequiredCount: plan.statuses.filter((status) => status.status === 'review' || status.status === 'conflict').length,
			ignored: plan.statuses.filter((status) => status.status === 'ignored').length,
			previewRequired: state.settings.firstSyncCompleted === false,
			presence,
		};
		return prepared;
	}

	private async stateHook(game: NormalizedGame, _operation: Operation): Promise<void> {
		const state = await this.loadState();
		for (const [provider, providerGame] of Object.entries(game.providers) as [GameProvider, NormalizedProviderGame | undefined][]) {
			if (providerGame === undefined) continue;
			const existing = state.identityMappings.find((mapping) => mapping.provider === provider && mapping.providerGameId === providerGame.providerGameId);
			if (existing === undefined) state.identityMappings.push({ canonicalId: game.canonicalId, provider, providerGameId: providerGame.providerGameId });
		}
		const identityIndex = state.identityIndex.filter((identity) => identity.canonicalId !== game.canonicalId);
		identityIndex.push({ ...game.identity, canonicalId: game.canonicalId });
		state.identityIndex = identityIndex;
		if (this.options.onProviderState !== undefined) await this.options.onProviderState(game, _operation);
		await this.saveState();
	}

	private async journalProgress(operation: Operation, progress: ExecutorProgress, game: NormalizedGame): Promise<void> {
		const state = await this.loadState();
		const existing = state.operationJournal.find((entry) => entry.operation.id === operation.id
			|| (entry.operation.canonicalGameId === operation.canonicalGameId
				&& entry.operation.kind === operation.kind
				&& entry.operation.path === operation.path));
		if (progress.noteApplied && (progress.noteFingerprintAfter === undefined || progress.noteFingerprintAfter.trim().length === 0)) throw new Error('Applied note progress requires a fingerprint.');
		const noteFingerprintAfter = progress.noteFingerprintAfter;
		const entry: OperationJournalEntry = {
			operation,
			game: cloneJournalGame(game),
			...progress,
			...(noteFingerprintAfter === undefined ? {} : { noteFingerprintAfter }),
		};
		if (existing === undefined) state.operationJournal.push(entry);
		else {
			existing.operation = operation;
			existing.game = cloneJournalGame(game);
			existing.noteApplied = progress.noteApplied;
			existing.noteFingerprintAfter = noteFingerprintAfter;
			existing.providerStateApplied = progress.providerStateApplied;
			existing.historyApplied = progress.historyApplied;
			existing.cacheApplied = progress.cacheApplied;
		}
		await this.saveState();
	}

	private async recoveryOperations(prepared: PreparedSync, state: GameSyncData): Promise<Array<{ operation: Operation; progress: ExecutorProgress }>> {
		const plannedIds = new Set(prepared.plan.operations.map((operation) => operation.id));
		const fingerprints = await this.planner.currentNoteFingerprints();
		return state.operationJournal
			.filter((entry) => !plannedIds.has(entry.operation.id) && entry.game !== undefined)
			.flatMap((entry) => {
				const currentGame = prepared.games.find((game) => game.canonicalId === entry.operation.canonicalGameId);
				const path = entry.operation.path;
				if (!entry.noteApplied || !sameNormalizedGame(entry.game, currentGame) || path === undefined) return [];
				const currentFingerprint = fingerprints[path] ?? null;
				if (entry.noteFingerprintAfter === undefined || currentFingerprint !== entry.noteFingerprintAfter) return [];
				return [{
					operation: rebaseRecoveryOperation(entry.operation, prepared.plan.planRevision),
					progress: {
						noteApplied: true,
						noteFingerprintAfter: currentFingerprint,
						providerStateApplied: entry.providerStateApplied,
						historyApplied: entry.historyApplied,
						cacheApplied: entry.cacheApplied,
					},
				}];
			});
	}

	private async cacheHook(game: NormalizedGame, operation: Operation): Promise<void> {
		if (this.options.onCache !== undefined) await this.options.onCache(game, operation);
		if (this.cache === undefined) return;
		for (const [provider, providerGame] of Object.entries(game.providers) as [GameProvider, NormalizedProviderGame | undefined][]) {
			if (providerGame === undefined) continue;
			if (!providerGame.freshness.achievements) {
				await this.cache.delete(providerGame.providerGameId, provider);
				continue;
			}
			await this.writeProviderCache(provider, providerGame);
		}
	}

	private async writeProviderCache(provider: GameProvider, providerGame: NormalizedProviderGame): Promise<void> {
		if (this.cache === undefined) return;
		const fetchedAt = this.sourceFetchedAt.get(`${provider}:${providerGame.providerGameId}`);
		if (fetchedAt === undefined || !providerGame.freshness.achievements) return;
		await this.cache.set(providerGame.providerGameId, provider, {
			fetchedAt,
			playtimeMinutes: providerGame.playtimeMinutes,
			lastPlayed: providerGame.lastPlayed,
			achievements: providerGame.achievements,
		}, fetchedAt);
	}

	private async cachePreparedFreshData(prepared: PreparedSync): Promise<void> {
		if (this.cache === undefined) return;
		const state = await this.loadState();
		for (const result of Object.values(prepared.providerResults)) {
			if (result === undefined || result.providerStatus.state === 'failed') continue;
			for (const providerGame of result.providerGames ?? []) {
				if (!providerGame.freshness.achievements) continue;
				const normalized = providerGameToNormalized(providerGame, this.canonicalIdFor(providerGame, state.identityMappings));
				const normalizedProviderGame = normalized.providers[result.provider];
				if (normalizedProviderGame !== undefined) await this.writeProviderCache(result.provider, normalizedProviderGame);
			}
		}
	}

	private async historyHook(game: NormalizedGame, operation: Operation): Promise<void> {
		const state = await this.loadState();
		if (!state.settings.recordHistory) return;
		if (this.options.history !== undefined) {
			for (const event of this.historyEvents(state, game, operation)) await this.options.history.record(event, true);
		}
		if (this.options.onHistory !== undefined) await this.options.onHistory(game, operation);
	}

	private historyEvents(state: GameSyncData, game: NormalizedGame, operation: Operation): GameEvent[] {
		const events: GameEvent[] = [];
		for (const [provider, current] of Object.entries(game.providers) as [GameProvider, NormalizedProviderGame | undefined][]) {
			if (current === undefined) continue;
			const previous = state.lastAppliedProviderSnapshots[provider]?.find((candidate) => candidate.providerGameId === current.providerGameId);
			const context = {
				provider,
				canonicalGameId: game.canonicalId,
				providerGameId: current.providerGameId,
				observedAt: this.now(),
				...(current.lastPlayed === undefined ? {} : { occurredAt: current.lastPlayed }),
			};
			if (previous === undefined) {
				events.push(createGameEvent({ ...context, type: 'game-first-seen', data: { operation: operation.kind } }));
				continue;
			}
			if (previous.playtimeMinutes !== undefined && current.playtimeMinutes !== undefined && previous.playtimeMinutes !== current.playtimeMinutes) {
				events.push(createGameEvent({
					...context,
					type: 'playtime-changed',
					data: { previousMinutes: previous.playtimeMinutes, playtimeMinutes: current.playtimeMinutes },
				}));
			}
			if (previous.owned !== undefined && current.owned !== undefined && previous.owned !== current.owned) {
				events.push(createGameEvent({
					...context,
					type: 'ownership-changed',
					data: { previousOwned: previous.owned, owned: current.owned },
				}));
			}
			if (current.freshness.achievements && current.achievements !== undefined) {
				const previousAchievements = new Map((previous.achievements?.achievements ?? []).map((achievement) => [achievement.id, achievement]));
				for (const achievement of current.achievements.achievements) {
					if (!achievement.unlocked || previousAchievements.get(achievement.id)?.unlocked === true) continue;
					events.push(createGameEvent({
						...context,
						...(achievement.unlockedAt === undefined ? {} : { occurredAt: achievement.unlockedAt }),
						type: provider === 'playstation' ? 'trophy-unlocked' : 'achievement-unlocked',
						data: { achievementId: achievement.id, name: achievement.name },
					}));
				}
			}
		}
		return events;
	}

	private async commitPrepared(prepared: PreparedSync): Promise<boolean> {
		if (prepared.plan.planRevision !== this.currentSourceRevision || prepared.plan.statuses.some((status) => status.status === 'review' || status.status === 'conflict')) {
			return false;
		}
		const state = await this.loadState();
		for (const result of Object.values(prepared.providerResults)) {
			if (result === undefined) continue;
			if (result.snapshot !== undefined && (result.providerStatus.state === 'partial' || isCompleteProviderSnapshot(result.snapshot))) {
				const snapshot = (result.providerGames ?? []).map(clonePersistedProviderGame);
				this.committedProviderGames.set(result.provider, snapshot.map(cloneProviderGame));
				state.lastAppliedProviderSnapshots[result.provider] = snapshot;
				if (result.providerStatus.state === 'success' && isCompleteProviderSnapshot(result.snapshot)) state.lastSuccessfulProviderSnapshots[result.provider] = snapshot;
			}
			const preparedKeys = new Set((result.presence ?? []).map((record) => `${record.provider}:${record.providerGameId}`));
			state.presence = state.presence.filter((record) => record.provider !== result.provider || !preparedKeys.has(`${record.provider}:${record.providerGameId}`));
			state.presence.push(...(result.presence ?? []).map(clonePresence));
		}
		await this.saveState();
		return true;
	}

	async applySelection(
		prepared: PreparedSync,
		selectedOperationIds: readonly string[],
		options: { explicit?: boolean } = {},
	): Promise<SyncApplyResult> {
		const explicit = options.explicit === true;
		if (!explicit) {
			return {
				plan: prepared.plan,
				providerStatuses: prepared.providerStatuses,
				gamesFetched: prepared.gamesFetched,
				operationsCreated: prepared.operationsCreated,
				operationsApplied: 0,
				operationsAppliedIds: [],
				pendingOperationIds: prepared.plan.operations.map((operation) => operation.id),
				deselectedOperationIds: prepared.plan.operations.filter((operation) => !selectedOperationIds.includes(operation.id)).map((operation) => operation.id),
				deselected: prepared.plan.operations.filter((operation) => !selectedOperationIds.includes(operation.id)).length,
				ignored: prepared.ignored,
				warnings: [...prepared.warnings, 'explicit confirmation is required before applying the sync plan.'],
				reviewRequiredCount: prepared.reviewRequiredCount,
			};
		}
		const state = await this.loadState();
		const initialProgress = Object.fromEntries(state.operationJournal.map((entry) => [entry.operation.id, {
			noteApplied: entry.noteApplied,
			noteFingerprintAfter: entry.noteFingerprintAfter,
			providerStateApplied: entry.providerStateApplied,
			historyApplied: entry.historyApplied,
			cacheApplied: entry.cacheApplied,
		}]));
		const createExecutor = (progress: Readonly<Record<string, ExecutorProgress>>): SyncExecutor => new SyncExecutor({
					writer: this.writer,
					games: prepared.games,
					currentRevision: () => this.currentSourceRevision,
					currentNoteFingerprints: () => this.planner.currentNoteFingerprints(),
					initialProgress: progress,
					onBeforeNote: (operation, game) => this.journalProgress(operation, { noteApplied: false, providerStateApplied: false, historyApplied: false, cacheApplied: false }, game),
					onProgress: (operation, progressValue, game) => this.journalProgress(operation, progressValue, game),
					onProviderState: (game, operation) => this.stateHook(game, operation),
					onHistory: (game, operation) => this.historyHook(game, operation),
					onCache: (game, operation) => this.cacheHook(game, operation),
			});
		let executor = this.executors.get(prepared.plan.id);
		if (executor === undefined) {
			executor = createExecutor(initialProgress);
			this.executors.set(prepared.plan.id, executor);
		}
		const applied: ApplyResult = await executor.apply(prepared.plan, selectedOperationIds);
		const recoveryState = await this.loadState();
		const recovery = await this.recoveryOperations(prepared, recoveryState);
		const recoveryProgress: Record<string, ExecutorProgress> = Object.fromEntries(Object.entries(initialProgress).map(([id, progress]) => [id, { ...progress }]));
		for (const recovered of recovery) {
			recoveryProgress[recovered.operation.id] = { ...recovered.progress };
		}
		const recovered: ApplyResult = recovery.length === 0
			? { appliedOperationIds: [], pendingOperationIds: [], deselectedOperationIds: [], failedOperationIds: [] }
			: await createExecutor(recoveryProgress).apply(createSyncPlan(prepared.plan.planRevision, recovery.map(({ operation }) => operation)), recovery.map(({ operation }) => operation.id));
		const appliedResult: ApplyResult = {
			appliedOperationIds: [...new Set([...applied.appliedOperationIds, ...recovered.appliedOperationIds])],
			pendingOperationIds: [...new Set([...applied.pendingOperationIds, ...recovered.pendingOperationIds])].filter((id) => !recovered.appliedOperationIds.includes(id)),
			deselectedOperationIds: applied.deselectedOperationIds,
			failedOperationIds: [...new Set([...applied.failedOperationIds, ...recovered.failedOperationIds])],
		};
		const warnings = [...prepared.warnings];
		const executorSucceeded = appliedResult.failedOperationIds.length === 0 && appliedResult.pendingOperationIds.length === 0;
		const committed = executorSucceeded ? await this.commitPrepared(prepared) : false;
		if (committed) this.executors.delete(prepared.plan.id);
		if (executorSucceeded && !committed) warnings.push('Sync plan was not committed; review/conflict or stale source state remains pending.');
		if (committed) await this.cachePreparedFreshData(prepared);
		const hasAcceptedProvider = Object.values(prepared.providerStatuses).some((status) => status.state === 'success' || status.state === 'partial');
		if (committed && hasAcceptedProvider) {
			const completionState = await this.loadState();
			completionState.settings.firstSyncCompleted = true;
			await this.saveState();
		}
		if (appliedResult.failedOperationIds.length > 0) warnings.push(`${appliedResult.failedOperationIds.length} sync operation(s) failed and remain pending.`);
		return {
			plan: prepared.plan,
			providerStatuses: prepared.providerStatuses,
			gamesFetched: prepared.gamesFetched,
			operationsCreated: prepared.operationsCreated,
			operationsApplied: appliedResult.appliedOperationIds.length,
			operationsAppliedIds: appliedResult.appliedOperationIds,
			pendingOperationIds: appliedResult.pendingOperationIds,
			deselectedOperationIds: appliedResult.deselectedOperationIds,
			deselected: appliedResult.deselectedOperationIds.length,
			ignored: prepared.ignored,
			warnings,
			reviewRequiredCount: prepared.reviewRequiredCount,
		};
	}

	async getState(): Promise<GameSyncData> {
		return cloneState(await this.loadState());
	}
}

export function createSyncService(options: SyncServiceOptions): SyncService {
	return new SyncService(options);
}
