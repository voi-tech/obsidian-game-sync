import { StateMigrationError } from '../network/errors';
import type { GameProvider } from '../model/provider';
import { DEFAULT_SETTINGS } from './defaults';
import type {
	ActivityEntry,
	GameSyncData,
	LastSuccessfulProviderState,
	NegativeIdentityMapping,
	ProviderPresenceState,
} from './schema';

const PROVIDERS: readonly GameProvider[] = ['steam', 'playstation'];
const MAX_RECENT_ACTIVITY = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function providerValue(value: unknown): GameProvider | null {
	return value === 'steam' || value === 'playstation' ? value : null;
}

function readSettings(raw: unknown): GameSyncData['settings'] {
	if (raw === undefined) {
		return { ...DEFAULT_SETTINGS, enabledProviders: { ...DEFAULT_SETTINGS.enabledProviders } };
	}
	if (!isRecord(raw)) {
		throw new StateMigrationError('Invalid settings state.');
	}
	const enabledProviders = isRecord(raw.enabledProviders) ? raw.enabledProviders : {};
	return {
		...DEFAULT_SETTINGS,
		setupCompleted: booleanValue(raw.setupCompleted, DEFAULT_SETTINGS.setupCompleted),
		firstSyncCompleted: booleanValue(raw.firstSyncCompleted, DEFAULT_SETTINGS.firstSyncCompleted),
		enabledProviders: {
			steam: booleanValue(enabledProviders.steam, DEFAULT_SETTINGS.enabledProviders.steam),
			playstation: booleanValue(enabledProviders.playstation, DEFAULT_SETTINGS.enabledProviders.playstation),
		},
		notesFolder: stringValue(raw.notesFolder, DEFAULT_SETTINGS.notesFolder),
		filenamePattern: stringValue(raw.filenamePattern, DEFAULT_SETTINGS.filenamePattern),
		templatePath: stringValue(raw.templatePath, DEFAULT_SETTINGS.templatePath),
		createBase: booleanValue(raw.createBase, DEFAULT_SETTINGS.createBase),
		basePath: stringValue(raw.basePath, DEFAULT_SETTINGS.basePath),
		includeUnplayed: booleanValue(raw.includeUnplayed, DEFAULT_SETTINGS.includeUnplayed),
		includeFreeToPlay: booleanValue(raw.includeFreeToPlay, DEFAULT_SETTINGS.includeFreeToPlay),
		includePreviouslyPlayedNoLongerOwned: booleanValue(
			raw.includePreviouslyPlayedNoLongerOwned,
			DEFAULT_SETTINGS.includePreviouslyPlayedNoLongerOwned,
		),
		includeDemosTrials: booleanValue(raw.includeDemosTrials, DEFAULT_SETTINGS.includeDemosTrials),
		includeBetasTestApps: booleanValue(raw.includeBetasTestApps, DEFAULT_SETTINGS.includeBetasTestApps),
		previewMode:
			raw.previewMode === 'always' || raw.previewMode === 'review-only' || raw.previewMode === 'first-and-review'
				? raw.previewMode
				: DEFAULT_SETTINGS.previewMode,
		backgroundSync: booleanValue(raw.backgroundSync, DEFAULT_SETTINGS.backgroundSync),
		backgroundIntervalMinutes: numberValue(raw.backgroundIntervalMinutes, DEFAULT_SETTINGS.backgroundIntervalMinutes),
		metadataLanguage:
			raw.metadataLanguage === 'english' || raw.metadataLanguage === 'polish' || raw.metadataLanguage === 'follow-obsidian'
				? raw.metadataLanguage
				: DEFAULT_SETTINGS.metadataLanguage,
		metadataPreference:
			raw.metadataPreference === 'english' || raw.metadataPreference === 'polish' || raw.metadataPreference === 'automatic'
				? raw.metadataPreference
				: DEFAULT_SETTINGS.metadataPreference,
		revealHiddenAchievements: booleanValue(raw.revealHiddenAchievements, DEFAULT_SETTINGS.revealHiddenAchievements),
		showAchievementRarity: booleanValue(raw.showAchievementRarity, DEFAULT_SETTINGS.showAchievementRarity),
		showTrophyType: booleanValue(raw.showTrophyType, DEFAULT_SETTINGS.showTrophyType),
		showUnlockDate: booleanValue(raw.showUnlockDate, DEFAULT_SETTINGS.showUnlockDate),
		recordHistory: booleanValue(raw.recordHistory, DEFAULT_SETTINGS.recordHistory),
		historyPath: stringValue(raw.historyPath, DEFAULT_SETTINGS.historyPath),
		backgroundNotifications:
			raw.backgroundNotifications === 'all' || raw.backgroundNotifications === 'none' || raw.backgroundNotifications === 'problems-only'
				? raw.backgroundNotifications
				: DEFAULT_SETTINGS.backgroundNotifications,
	};
}

function readProviderCursors(raw: unknown): GameSyncData['providerCursors'] {
	if (raw === undefined) {
		return {};
	}
	if (!isRecord(raw)) {
		throw new StateMigrationError('Invalid provider cursor state.');
	}
	const result: GameSyncData['providerCursors'] = {};
	for (const [provider, value] of Object.entries(raw)) {
		if (!PROVIDERS.includes(provider as GameProvider)) {
			continue;
		}
		if (!isRecord(value) || (value.cursor !== undefined && typeof value.cursor !== 'string') || typeof value.page !== 'number') {
			throw new StateMigrationError(`Invalid cursor state for ${provider}.`);
		}
		result[provider as GameProvider] = {
			cursor: value.cursor,
			page: value.page,
		};
	}
	return result;
}

function readPresence(raw: unknown): ProviderPresenceState[] {
	if (raw === undefined) {
		return [];
	}
	if (!Array.isArray(raw)) {
		throw new StateMigrationError('Invalid provider presence state.');
	}
	return raw.map((value) => {
		if (!isRecord(value) || providerValue(value.provider) === null || typeof value.providerGameId !== 'string') {
			throw new StateMigrationError('Invalid provider presence entry.');
		}
		if (
			typeof value.canonicalGameId !== 'string' ||
			typeof value.owned !== 'boolean' ||
			typeof value.consecutiveMissing !== 'number' ||
			(value.lastSnapshotStatus !== 'complete' && value.lastSnapshotStatus !== 'partial' && value.lastSnapshotStatus !== 'failed') ||
			typeof value.paginationComplete !== 'boolean'
		) {
			throw new StateMigrationError('Invalid provider presence entry.');
		}
		return value as unknown as ProviderPresenceState;
	});
}

function readLastSuccessfulProviderStates(raw: unknown): GameSyncData['lastSuccessfulProviderStates'] {
	if (raw === undefined) {
		return {};
	}
	if (!isRecord(raw)) {
		throw new StateMigrationError('Invalid successful provider state.');
	}
	const result: GameSyncData['lastSuccessfulProviderStates'] = {};
	for (const [provider, value] of Object.entries(raw)) {
		if (!PROVIDERS.includes(provider as GameProvider)) {
			continue;
		}
		if (!isRecord(value) || typeof value.fetchedAt !== 'string' || !Array.isArray(value.gameIds) || !value.gameIds.every((id) => typeof id === 'string')) {
			throw new StateMigrationError(`Invalid successful state for ${provider}.`);
		}
		result[provider as GameProvider] = {
			provider: provider as GameProvider,
			fetchedAt: value.fetchedAt,
			gameIds: [...value.gameIds],
			paginationComplete: true,
		} satisfies LastSuccessfulProviderState;
	}
	return result;
}

function readArray<T>(raw: unknown, fallback: T[], label: string): T[] {
	if (raw === undefined) {
		return fallback;
	}
	if (!Array.isArray(raw)) {
		throw new StateMigrationError(`Invalid ${label} state.`);
	}
	return raw.map((value: unknown) => value) as T[];
}


function migrateVersionOne(raw: unknown): GameSyncData {
	if (!isRecord(raw)) {
		throw new StateMigrationError('State must be an object.');
	}
	return {
		schemaVersion: 1,
		settings: readSettings(raw.settings),
		identityMappings: readArray(raw.identityMappings, [], 'identity mapping'),
		negativeMappings: readArray<NegativeIdentityMapping>(raw.negativeMappings, [], 'negative mapping'),
		ignoredCanonicalIds: readArray<string>(raw.ignoredCanonicalIds, [], 'ignored canonical ID'),
		ignoredProviderRefs: readArray<string>(raw.ignoredProviderRefs, [], 'ignored provider reference'),
		presence: readPresence(raw.presence),
		providerCursors: readProviderCursors(raw.providerCursors),
		lastSuccessfulProviderStates: readLastSuccessfulProviderStates(raw.lastSuccessfulProviderStates),
		recentActivity: readArray<ActivityEntry>(raw.recentActivity, [], 'recent activity').slice(-MAX_RECENT_ACTIVITY),
		identityIndex: readArray(raw.identityIndex, [], 'identity index'),
	};
}

export function migrateState(raw: unknown): GameSyncData {
	if (raw === undefined || raw === null) {
		return migrateVersionOne({});
	}
	if (!isRecord(raw)) {
		throw new StateMigrationError('State must be an object.');
	}
	const version = raw.schemaVersion === undefined ? 1 : raw.schemaVersion;
	if (version !== 1) {
		const versionLabel = typeof version === 'string' ? version : typeof version === 'number' ? version.toString() : 'unknown';
		throw new StateMigrationError(`Unsupported state schema version: ${versionLabel}.`);
	}
	let currentVersion = version;
	let migrated: GameSyncData | undefined;
	while (currentVersion <= 1) {
		switch (currentVersion) {
			case 1:
				migrated = migrateVersionOne(raw);
				currentVersion = 2;
				break;
			default:
				throw new StateMigrationError(`Unsupported state schema version: ${currentVersion.toString()}.`);
		}
	}
	return migrated ?? migrateVersionOne(raw);
}
