import { StateMigrationError } from '../network/errors';
import type { GameIdentity, IdentityMapping } from '../model/identity';
import type { GameProvider, ProviderSnapshotStatus } from '../model/provider';
import { DEFAULT_SETTINGS } from './defaults';
import type {
	ActivityEntry,
	GameSyncData,
	LastSuccessfulProviderState,
	NegativeIdentityMapping,
	ProviderPresenceState,
} from './schema';

const MAX_RECENT_ACTIVITY = 100;
const SETTINGS_KEYS = [
	'setupCompleted',
	'firstSyncCompleted',
	'enabledProviders',
	'notesFolder',
	'filenamePattern',
	'templatePath',
	'createBase',
	'basePath',
	'includeUnplayed',
	'includeFreeToPlay',
	'includePreviouslyPlayedNoLongerOwned',
	'includeDemosTrials',
	'includeBetasTestApps',
	'previewMode',
	'backgroundSync',
	'backgroundIntervalMinutes',
	'metadataLanguage',
	'metadataPreference',
	'revealHiddenAchievements',
	'showAchievementRarity',
	'showTrophyType',
	'showUnlockDate',
	'recordHistory',
	'historyPath',
	'backgroundNotifications',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	const unknown = Object.keys(value).find((key) => !allowed.includes(key));
	if (unknown !== undefined) {
		throw new StateMigrationError(`Unknown ${label} field: ${unknown}.`);
	}
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new StateMigrationError(`Invalid ${label}.`);
	}
	return value;
}

function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return requiredString(value, label);
}

function textValue(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw new StateMigrationError(`Invalid ${label}.`);
	}
	return value;
}

function optionalBoolean(value: unknown, fallback: boolean, label: string): boolean {
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== 'boolean') {
		throw new StateMigrationError(`Invalid ${label}.`);
	}
	return value;
}

function optionalNumber(value: unknown, fallback: number, label: string): number {
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new StateMigrationError(`Invalid ${label}.`);
	}
	return value;
}

function providerValue(value: unknown, label: string): GameProvider {
	if (value !== 'steam' && value !== 'playstation') {
		throw new StateMigrationError(`Invalid ${label}.`);
	}
	return value;
}

function snapshotStatus(value: unknown, label: string): ProviderSnapshotStatus {
	if (value !== 'complete' && value !== 'partial' && value !== 'failed') {
		throw new StateMigrationError(`Invalid ${label}.`);
	}
	return value;
}

function readSettings(raw: unknown): GameSyncData['settings'] {
	if (raw === undefined) {
		return { ...DEFAULT_SETTINGS, enabledProviders: { ...DEFAULT_SETTINGS.enabledProviders } };
	}
	if (!isRecord(raw)) {
		throw new StateMigrationError('Invalid settings state.');
	}
	rejectUnknownFields(raw, SETTINGS_KEYS, 'settings');
	if (raw.enabledProviders !== undefined && !isRecord(raw.enabledProviders)) {
		throw new StateMigrationError('Invalid enabled providers state.');
	}
	const enabledProviders = raw.enabledProviders === undefined ? {} : raw.enabledProviders;
	rejectUnknownFields(enabledProviders, ['steam', 'playstation'], 'enabled provider');
	return {
		setupCompleted: optionalBoolean(raw.setupCompleted, DEFAULT_SETTINGS.setupCompleted, 'setupCompleted'),
		firstSyncCompleted: optionalBoolean(raw.firstSyncCompleted, DEFAULT_SETTINGS.firstSyncCompleted, 'firstSyncCompleted'),
		enabledProviders: {
			steam: optionalBoolean(enabledProviders.steam, DEFAULT_SETTINGS.enabledProviders.steam, 'enabledProviders.steam'),
			playstation: optionalBoolean(
				enabledProviders.playstation,
				DEFAULT_SETTINGS.enabledProviders.playstation,
				'enabledProviders.playstation',
			),
		},
		notesFolder: raw.notesFolder === undefined ? DEFAULT_SETTINGS.notesFolder : requiredString(raw.notesFolder, 'notesFolder'),
		filenamePattern:
			raw.filenamePattern === undefined ? DEFAULT_SETTINGS.filenamePattern : requiredString(raw.filenamePattern, 'filenamePattern'),
		templatePath: raw.templatePath === undefined ? DEFAULT_SETTINGS.templatePath : textValue(raw.templatePath, 'templatePath'),
		createBase: optionalBoolean(raw.createBase, DEFAULT_SETTINGS.createBase, 'createBase'),
		basePath: raw.basePath === undefined ? DEFAULT_SETTINGS.basePath : requiredString(raw.basePath, 'basePath'),
		includeUnplayed: optionalBoolean(raw.includeUnplayed, DEFAULT_SETTINGS.includeUnplayed, 'includeUnplayed'),
		includeFreeToPlay: optionalBoolean(raw.includeFreeToPlay, DEFAULT_SETTINGS.includeFreeToPlay, 'includeFreeToPlay'),
		includePreviouslyPlayedNoLongerOwned: optionalBoolean(
			raw.includePreviouslyPlayedNoLongerOwned,
			DEFAULT_SETTINGS.includePreviouslyPlayedNoLongerOwned,
			'includePreviouslyPlayedNoLongerOwned',
		),
		includeDemosTrials: optionalBoolean(raw.includeDemosTrials, DEFAULT_SETTINGS.includeDemosTrials, 'includeDemosTrials'),
		includeBetasTestApps: optionalBoolean(raw.includeBetasTestApps, DEFAULT_SETTINGS.includeBetasTestApps, 'includeBetasTestApps'),
		previewMode:
			raw.previewMode === undefined
				? DEFAULT_SETTINGS.previewMode
				: raw.previewMode === 'always' || raw.previewMode === 'review-only' || raw.previewMode === 'first-and-review'
					? raw.previewMode
					: (() => {
							throw new StateMigrationError('Invalid previewMode.');
					  })(),
		backgroundSync: optionalBoolean(raw.backgroundSync, DEFAULT_SETTINGS.backgroundSync, 'backgroundSync'),
		backgroundIntervalMinutes: optionalNumber(
			raw.backgroundIntervalMinutes,
			DEFAULT_SETTINGS.backgroundIntervalMinutes,
			'backgroundIntervalMinutes',
		),
		metadataLanguage:
			raw.metadataLanguage === undefined
				? DEFAULT_SETTINGS.metadataLanguage
				: raw.metadataLanguage === 'english' || raw.metadataLanguage === 'polish' || raw.metadataLanguage === 'follow-obsidian'
					? raw.metadataLanguage
					: (() => {
							throw new StateMigrationError('Invalid metadataLanguage.');
					  })(),
		metadataPreference:
			raw.metadataPreference === undefined
				? DEFAULT_SETTINGS.metadataPreference
				: raw.metadataPreference === 'english' || raw.metadataPreference === 'polish' || raw.metadataPreference === 'automatic'
					? raw.metadataPreference
					: (() => {
							throw new StateMigrationError('Invalid metadataPreference.');
					  })(),
		revealHiddenAchievements: optionalBoolean(
			raw.revealHiddenAchievements,
			DEFAULT_SETTINGS.revealHiddenAchievements,
			'revealHiddenAchievements',
		),
		showAchievementRarity: optionalBoolean(raw.showAchievementRarity, DEFAULT_SETTINGS.showAchievementRarity, 'showAchievementRarity'),
		showTrophyType: optionalBoolean(raw.showTrophyType, DEFAULT_SETTINGS.showTrophyType, 'showTrophyType'),
		showUnlockDate: optionalBoolean(raw.showUnlockDate, DEFAULT_SETTINGS.showUnlockDate, 'showUnlockDate'),
		recordHistory: optionalBoolean(raw.recordHistory, DEFAULT_SETTINGS.recordHistory, 'recordHistory'),
		historyPath: raw.historyPath === undefined ? DEFAULT_SETTINGS.historyPath : requiredString(raw.historyPath, 'historyPath'),
		backgroundNotifications:
			raw.backgroundNotifications === undefined
				? DEFAULT_SETTINGS.backgroundNotifications
				: raw.backgroundNotifications === 'all' || raw.backgroundNotifications === 'none' || raw.backgroundNotifications === 'problems-only'
					? raw.backgroundNotifications
					: (() => {
							throw new StateMigrationError('Invalid backgroundNotifications.');
					  })(),
	};
}

function readIdentityMapping(value: unknown): IdentityMapping {
	if (!isRecord(value)) {
		throw new StateMigrationError('Invalid identity mapping.');
	}
	rejectUnknownFields(value, ['canonicalId', 'provider', 'providerGameId'], 'identity mapping');
	return {
		canonicalId: requiredString(value.canonicalId, 'identity mapping canonicalId'),
		provider: providerValue(value.provider, 'identity mapping provider'),
		providerGameId: requiredString(value.providerGameId, 'identity mapping providerGameId'),
	};
}

function readNegativeMapping(value: unknown): NegativeIdentityMapping {
	if (!isRecord(value)) {
		throw new StateMigrationError('Invalid negative mapping.');
	}
	rejectUnknownFields(value, ['leftCanonicalId', 'rightCanonicalId'], 'negative mapping');
	return {
		leftCanonicalId: requiredString(value.leftCanonicalId, 'negative mapping leftCanonicalId'),
		rightCanonicalId: requiredString(value.rightCanonicalId, 'negative mapping rightCanonicalId'),
	};
}

function readStringList(raw: unknown, label: string): string[] {
	if (!Array.isArray(raw) || !raw.every((value) => typeof value === 'string' && value.trim().length > 0)) {
		throw new StateMigrationError(`Invalid ${label} state.`);
	}
	const values: unknown[] = raw;
	return values.map((value) => requiredString(value, label));
}

function readPresence(raw: unknown): ProviderPresenceState[] {
	if (raw === undefined) {
		return [];
	}
	if (!Array.isArray(raw)) {
		throw new StateMigrationError('Invalid provider presence state.');
	}
	return raw.map((entry) => {
		if (!isRecord(entry)) {
			throw new StateMigrationError('Invalid provider presence entry.');
		}
		rejectUnknownFields(
			entry,
			['provider', 'providerGameId', 'canonicalGameId', 'owned', 'consecutiveMissing', 'lastSnapshotStatus', 'paginationComplete', 'lastSeenAt'],
			'provider presence',
		);
		const lastSnapshotStatus = snapshotStatus(entry.lastSnapshotStatus, 'provider presence lastSnapshotStatus');
		const paginationComplete = entry.paginationComplete;
		if (typeof entry.owned !== 'boolean' || typeof paginationComplete !== 'boolean' || typeof entry.consecutiveMissing !== 'number' || !Number.isInteger(entry.consecutiveMissing) || entry.consecutiveMissing < 0) {
			throw new StateMigrationError('Invalid provider presence values.');
		}
		if (entry.consecutiveMissing > 0 && (lastSnapshotStatus !== 'complete' || paginationComplete !== true)) {
			throw new StateMigrationError('Incomplete provider presence cannot reduce ownership.');
		}
		return {
			provider: providerValue(entry.provider, 'provider presence provider'),
			providerGameId: requiredString(entry.providerGameId, 'provider presence providerGameId'),
			canonicalGameId: requiredString(entry.canonicalGameId, 'provider presence canonicalGameId'),
			owned: entry.owned,
			consecutiveMissing: entry.consecutiveMissing,
			lastSnapshotStatus,
			paginationComplete,
			lastSeenAt: optionalString(entry.lastSeenAt, 'provider presence lastSeenAt'),
		};
	});
}

function readProviderCursors(raw: unknown): GameSyncData['providerCursors'] {
	if (raw === undefined) {
		return {};
	}
	if (!isRecord(raw)) {
		throw new StateMigrationError('Invalid provider cursor state.');
	}
	const result: GameSyncData['providerCursors'] = {};
	for (const provider of Object.keys(raw)) {
		const providerName = providerValue(provider, 'provider cursor provider');
		const value = raw[provider];
		if (!isRecord(value)) {
			throw new StateMigrationError(`Invalid cursor state for ${provider}.`);
		}
		rejectUnknownFields(value, ['cursor', 'page'], `cursor ${provider}`);
		if (value.page !== undefined && (typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 0)) {
			throw new StateMigrationError(`Invalid page for ${provider}.`);
		}
		result[providerName] = {
			cursor: optionalString(value.cursor, `cursor ${provider}`),
			page: value.page === undefined ? 0 : value.page,
		};
	}
	return result;
}

function readLastSuccessfulProviderStates(raw: unknown): GameSyncData['lastSuccessfulProviderStates'] {
	if (raw === undefined) {
		return {};
	}
	if (!isRecord(raw)) {
		throw new StateMigrationError('Invalid successful provider state.');
	}
	const result: GameSyncData['lastSuccessfulProviderStates'] = {};
	for (const provider of Object.keys(raw)) {
		const providerName = providerValue(provider, 'successful provider state provider');
		const value = raw[provider];
		if (!isRecord(value)) {
			throw new StateMigrationError(`Invalid successful state for ${provider}.`);
		}
		rejectUnknownFields(value, ['provider', 'fetchedAt', 'gameIds', 'status', 'paginationComplete'], `successful state ${provider}`);
		if (value.provider !== providerName) {
			throw new StateMigrationError(`Successful state provider mismatch for ${provider}.`);
		}
		if (value.status !== 'complete' || value.paginationComplete !== true) {
			throw new StateMigrationError(`Provider success for ${provider} requires complete pagination.`);
		}
		result[providerName] = {
			provider: providerName,
			fetchedAt: requiredString(value.fetchedAt, `successful state ${provider} fetchedAt`),
			gameIds: readStringList(value.gameIds, `successful state ${provider} gameIds`),
			status: 'complete',
			paginationComplete: true,
		} satisfies LastSuccessfulProviderState;
	}
	return result;
}

function readGameIdentity(value: unknown): GameIdentity {
	if (!isRecord(value)) {
		throw new StateMigrationError('Invalid identity index entry.');
	}
	rejectUnknownFields(value, ['canonicalId', 'steamAppId', 'playstation'], 'identity index');
	const canonicalId = requiredString(value.canonicalId, 'identity index canonicalId');
	if (value.steamAppId !== undefined && (typeof value.steamAppId !== 'number' || !Number.isInteger(value.steamAppId) || value.steamAppId < 1)) {
		throw new StateMigrationError('Invalid identity index steamAppId.');
	}
	let playstation: GameIdentity['playstation'];
	if (value.playstation !== undefined) {
		if (!isRecord(value.playstation)) {
			throw new StateMigrationError('Invalid identity index PlayStation identity.');
		}
		rejectUnknownFields(value.playstation, ['conceptId', 'titleIds', 'npCommunicationIds'], 'identity index PlayStation');
		const conceptId = optionalString(value.playstation.conceptId, 'identity index conceptId');
		const titleIds = value.playstation.titleIds === undefined ? [] : readStringList(value.playstation.titleIds, 'identity index titleIds');
		const npCommunicationIds = value.playstation.npCommunicationIds === undefined ? [] : readStringList(value.playstation.npCommunicationIds, 'identity index communication IDs');
		if (conceptId === undefined && titleIds.length === 0 && npCommunicationIds.length === 0) {
			throw new StateMigrationError('PlayStation identity requires a stable identifier.');
		}
		playstation = { conceptId, titleIds, npCommunicationIds };
	}
	if (value.steamAppId === undefined && playstation === undefined) {
		throw new StateMigrationError('Identity index requires a stable provider identifier.');
	}
	return {
		canonicalId,
		steamAppId: value.steamAppId,
		playstation,
	};
}

function readActivity(value: unknown): ActivityEntry {
	if (!isRecord(value)) {
		throw new StateMigrationError('Invalid activity entry.');
	}
	rejectUnknownFields(value, ['id', 'createdAt', 'kind', 'message', 'data'], 'activity');
	if (value.data !== undefined && !isRecord(value.data)) {
		throw new StateMigrationError('Invalid activity data.');
	}
	return {
		id: requiredString(value.id, 'activity id'),
		createdAt: requiredString(value.createdAt, 'activity createdAt'),
		kind: requiredString(value.kind, 'activity kind'),
		message: typeof value.message === 'string' ? value.message : (() => { throw new StateMigrationError('Invalid activity message.'); })(),
		data: value.data === undefined ? undefined : { ...value.data },
	};
}

function readArray<T>(raw: unknown, fallback: T[], reader: (value: unknown) => T, label: string): T[] {
	if (raw === undefined) {
		return fallback;
	}
	if (!Array.isArray(raw)) {
		throw new StateMigrationError(`Invalid ${label} state.`);
	}
	return raw.map(reader);
}

function migrateVersionOne(raw: unknown): GameSyncData {
	if (!isRecord(raw)) {
		throw new StateMigrationError('State must be an object.');
	}
	rejectUnknownFields(
		raw,
		[
			'schemaVersion',
			'settings',
			'identityMappings',
			'negativeMappings',
			'ignoredCanonicalIds',
			'ignoredProviderRefs',
			'presence',
			'providerCursors',
			'lastSuccessfulProviderStates',
			'recentActivity',
			'identityIndex',
		],
		'persistent state',
	);
	if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) {
		throw new StateMigrationError('Unsupported state schema version.');
	}
	return {
		schemaVersion: 1,
		settings: readSettings(raw.settings),
		identityMappings: readArray<IdentityMapping>(raw.identityMappings, [], readIdentityMapping, 'identity mapping'),
		negativeMappings: readArray<NegativeIdentityMapping>(raw.negativeMappings, [], readNegativeMapping, 'negative mapping'),
		ignoredCanonicalIds: raw.ignoredCanonicalIds === undefined ? [] : readStringList(raw.ignoredCanonicalIds, 'ignored canonical ID'),
		ignoredProviderRefs: raw.ignoredProviderRefs === undefined ? [] : readStringList(raw.ignoredProviderRefs, 'ignored provider reference'),
		presence: readPresence(raw.presence),
		providerCursors: readProviderCursors(raw.providerCursors),
		lastSuccessfulProviderStates: readLastSuccessfulProviderStates(raw.lastSuccessfulProviderStates),
		recentActivity: readArray<ActivityEntry>(raw.recentActivity, [], readActivity, 'recent activity').slice(-MAX_RECENT_ACTIVITY),
		identityIndex: readArray<GameIdentity>(raw.identityIndex, [], readGameIdentity, 'identity index'),
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
		throw new StateMigrationError('Unsupported state schema version.');
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
				throw new StateMigrationError('Unsupported state schema version.');
		}
	}
	return migrated ?? migrateVersionOne(raw);
}
