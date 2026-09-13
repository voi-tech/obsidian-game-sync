import { StateMigrationError } from '../network/errors';
import type { GameIdentity, IdentityMapping } from '../model/identity';
import type { GameProvider, ProviderGame, ProviderSnapshotStatus } from '../model/provider';
import { createOperation, type Operation, type OperationRisk } from '../model/operations';
import type { ProviderAchievement, ProviderAchievementSet } from '../model/achievement';
import type { NormalizedGame, NormalizedProviderGame } from '../model/game';
import { DEFAULT_PROPERTY_MAPPING, validatePropertyMapping, type ManagedPropertyKey, type PropertyMapping } from '../model/property-mapping';
import { isSupportedBackgroundIntervalMinutes } from '../model/settings';
import { DEFAULT_SETTINGS } from './defaults';
import type {
	ActivityEntry,
	GameSyncData,
	LastSuccessfulProviderState,
	NegativeIdentityMapping,
	ProviderPresenceState,
} from './schema';

const MAX_RECENT_ACTIVITY = 100;
const PROPERTY_MAPPING_KEYS = Object.keys(DEFAULT_PROPERTY_MAPPING) as ManagedPropertyKey[];
const SETTINGS_KEYS = [
	'setupCompleted',
	'firstSyncCompleted',
	'steamAccountId',
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

function requiredBoolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new StateMigrationError(`Invalid ${label}.`);
	return value;
}

function backgroundIntervalMinutes(value: unknown): number {
	if (value === undefined) return DEFAULT_SETTINGS.backgroundIntervalMinutes;
	if (!isSupportedBackgroundIntervalMinutes(value)) throw new StateMigrationError('Invalid backgroundIntervalMinutes.');
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
		steamAccountId: raw.steamAccountId === undefined ? DEFAULT_SETTINGS.steamAccountId : requiredString(raw.steamAccountId, 'steamAccountId'),
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
		backgroundIntervalMinutes: backgroundIntervalMinutes(raw.backgroundIntervalMinutes),
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

function readPropertyMapping(raw: unknown): PropertyMapping {
	if (raw === undefined) {
		return {};
	}
	if (!isRecord(raw)) {
		throw new StateMigrationError('Invalid property mapping state.');
	}
	rejectUnknownFields(raw, PROPERTY_MAPPING_KEYS, 'property mapping');
	const mapping: PropertyMapping = {};
	for (const key of Object.keys(raw) as ManagedPropertyKey[]) {
		const value = raw[key];
		if (value !== null && value !== false && (typeof value !== 'string' || value.trim().length === 0)) {
			throw new StateMigrationError('Invalid property mapping value.');
		}
		mapping[key] = value;
	}
	try {
		validatePropertyMapping(mapping);
	} catch {
		throw new StateMigrationError('Invalid property mapping.');
	}
	return mapping;
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

function readStringArray(value: unknown, label: string): string[] {
	return readStringList(value, label);
}

function readAchievements(raw: unknown, label: string): ProviderAchievementSet | undefined {
	if (raw === undefined) return undefined;
	if (!isRecord(raw)) throw new StateMigrationError(`Invalid ${label}.`);
	rejectUnknownFields(raw, ['earned', 'total', 'progress', 'achievements'], label);
	if (typeof raw.earned !== 'number' || !Number.isInteger(raw.earned) || raw.earned < 0
		|| typeof raw.total !== 'number' || !Number.isInteger(raw.total) || raw.total < 0 || raw.earned > raw.total
		|| typeof raw.progress !== 'number' || !Number.isFinite(raw.progress) || raw.progress < 0 || raw.progress > 100) {
		throw new StateMigrationError(`Invalid ${label} values.`);
	}
	if (!Array.isArray(raw.achievements)) throw new StateMigrationError(`Invalid ${label} list.`);
	const achievements = raw.achievements.map((value) => {
		if (!isRecord(value)) throw new StateMigrationError(`Invalid ${label} entry.`);
		rejectUnknownFields(value, ['id', 'name', 'description', 'unlocked', 'unlockedAt', 'hidden', 'rarityPercent', 'trophyType', 'iconUrl'], `${label} entry`);
		if (typeof value.unlocked !== 'boolean' || typeof value.hidden !== 'boolean') {
			throw new StateMigrationError(`Invalid ${label} entry values.`);
		}
		const trophyType = value.trophyType;
		if (trophyType !== undefined && trophyType !== 'bronze' && trophyType !== 'silver' && trophyType !== 'gold' && trophyType !== 'platinum') {
			throw new StateMigrationError(`Invalid ${label} trophy type.`);
		}
		if (value.rarityPercent !== undefined && (typeof value.rarityPercent !== 'number' || !Number.isFinite(value.rarityPercent) || value.rarityPercent < 0 || value.rarityPercent > 100)) throw new StateMigrationError(`Invalid ${label} rarity.`);
		return {
			id: requiredString(value.id, `${label} id`),
			name: optionalString(value.name, `${label} name`),
			description: optionalString(value.description, `${label} description`),
			unlocked: value.unlocked,
			unlockedAt: optionalString(value.unlockedAt, `${label} unlockedAt`),
			hidden: value.hidden,
			rarityPercent: value.rarityPercent,
			trophyType,
			iconUrl: optionalString(value.iconUrl, `${label} iconUrl`),
		} satisfies ProviderAchievement;
	});
	if (raw.total !== achievements.length || raw.earned !== achievements.filter((achievement) => achievement.unlocked).length) {
		throw new StateMigrationError(`Invalid ${label} totals.`);
	}
	return { earned: raw.earned, total: raw.total, progress: raw.progress, achievements };
}

function readProviderGame(value: unknown, provider: GameProvider): ProviderGame {
	if (!isRecord(value)) throw new StateMigrationError(`Invalid ${provider} provider snapshot game.`);
	rejectUnknownFields(value, [
		'provider', 'providerGameId', 'title', 'originalTitle', 'releaseDate', 'description', 'cover', 'developers', 'publishers', 'genres', 'platforms',
		'owned', 'acquisitionType', 'playtimeMinutes', 'lastPlayed', 'achievements', 'sourceUrl', 'freshness', 'identity',
	], `${provider} provider snapshot game`);
	if (value.provider !== provider || typeof value.title !== 'string') throw new StateMigrationError(`Invalid ${provider} provider snapshot game identity.`);
	const arrays = ['developers', 'publishers', 'genres', 'platforms'] as const;
	for (const key of arrays) if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === 'string')) throw new StateMigrationError(`Invalid ${provider} provider snapshot ${key}.`);
	if (value.owned !== undefined && typeof value.owned !== 'boolean') throw new StateMigrationError(`Invalid ${provider} provider snapshot ownership.`);
	if (value.playtimeMinutes !== undefined && (typeof value.playtimeMinutes !== 'number' || !Number.isFinite(value.playtimeMinutes) || value.playtimeMinutes < 0)) throw new StateMigrationError(`Invalid ${provider} provider snapshot playtime.`);
	if (value.acquisitionType !== undefined && value.acquisitionType !== 'purchased' && value.acquisitionType !== 'subscription' && value.acquisitionType !== 'free' && value.acquisitionType !== 'key' && value.acquisitionType !== 'gift' && value.acquisitionType !== 'unknown') throw new StateMigrationError(`Invalid ${provider} provider snapshot acquisition type.`);
	if (!isRecord(value.freshness)) throw new StateMigrationError(`Invalid ${provider} provider snapshot freshness.`);
	const freshness = value.freshness;
	rejectUnknownFields(freshness, ['metadata', 'ownership', 'playtime', 'achievements'], `${provider} provider snapshot freshness`);
	const freshnessValue = {
		metadata: requiredBoolean(freshness.metadata, `${provider} provider snapshot metadata freshness`),
		ownership: requiredBoolean(freshness.ownership, `${provider} provider snapshot ownership freshness`),
		playtime: requiredBoolean(freshness.playtime, `${provider} provider snapshot playtime freshness`),
		achievements: requiredBoolean(freshness.achievements, `${provider} provider snapshot achievement freshness`),
	};
	if (!isRecord(value.identity) || value.identity.provider !== provider) throw new StateMigrationError(`Invalid ${provider} provider snapshot identity.`);
	const identityValue = value.identity;
	let identity: ProviderGame['identity'];
	if (provider === 'steam') {
		if (Object.keys(identityValue).some((key) => !['provider', 'appId'].includes(key)) || typeof identityValue.appId !== 'number' || !Number.isInteger(identityValue.appId) || identityValue.appId < 1) throw new StateMigrationError('Invalid Steam provider snapshot identity.');
		identity = { provider: 'steam', appId: identityValue.appId };
	} else {
		if (Object.keys(identityValue).some((key) => !['provider', 'conceptId', 'titleIds', 'npCommunicationIds'].includes(key))) throw new StateMigrationError('Invalid PlayStation provider snapshot identity.');
		const titleIds = identityValue.titleIds === undefined ? [] : readStringArray(identityValue.titleIds, 'PlayStation provider snapshot title IDs');
		const npCommunicationIds = identityValue.npCommunicationIds === undefined ? [] : readStringArray(identityValue.npCommunicationIds, 'PlayStation provider snapshot communication IDs');
		const conceptId = optionalString(identityValue.conceptId, 'PlayStation provider snapshot concept ID');
		if (conceptId === undefined && titleIds.length === 0 && npCommunicationIds.length === 0) throw new StateMigrationError('PlayStation provider snapshot identity requires a stable identifier.');
		identity = conceptId !== undefined
			? { provider: 'playstation', conceptId, titleIds, npCommunicationIds }
			: titleIds.length > 0
				? { provider: 'playstation', titleIds: titleIds as [string, ...string[]], npCommunicationIds }
				: { provider: 'playstation', titleIds, npCommunicationIds: npCommunicationIds as [string, ...string[]] };
	}
	const developers = readStringArray(value.developers, `${provider} provider snapshot developers`);
	const publishers = readStringArray(value.publishers, `${provider} provider snapshot publishers`);
	const genres = readStringArray(value.genres, `${provider} provider snapshot genres`);
	const platforms = readStringArray(value.platforms, `${provider} provider snapshot platforms`);
	return {
		provider,
		providerGameId: requiredString(value.providerGameId, `${provider} provider snapshot game ID`),
		title: value.title,
		originalTitle: optionalString(value.originalTitle, `${provider} provider snapshot original title`),
		releaseDate: optionalString(value.releaseDate, `${provider} provider snapshot release date`),
		description: optionalString(value.description, `${provider} provider snapshot description`),
		cover: optionalString(value.cover, `${provider} provider snapshot cover`),
		developers,
		publishers,
		genres,
		platforms,
		owned: value.owned,
		acquisitionType: value.acquisitionType,
		playtimeMinutes: value.playtimeMinutes,
		lastPlayed: optionalString(value.lastPlayed, `${provider} provider snapshot last played`),
		achievements: readAchievements(value.achievements, `${provider} provider snapshot achievements`),
		freshness: freshnessValue,
		identity,
	};
}

function readNormalizedProviderGame(value: unknown, provider: GameProvider): NormalizedProviderGame {
	if (!isRecord(value)) throw new StateMigrationError(`Invalid ${provider} journal game.`);
	rejectUnknownFields(value, [
		'providerGameId', 'title', 'originalTitle', 'releaseDate', 'description', 'cover', 'developers', 'publishers', 'genres', 'platforms',
		'owned', 'acquisitionType', 'playtimeMinutes', 'lastPlayed', 'achievements', 'sourceUrl', 'freshness',
	], `${provider} journal game`);
	if (typeof value.title !== 'string') throw new StateMigrationError(`Invalid ${provider} journal game title.`);
	const arrays = ['developers', 'publishers', 'genres', 'platforms'] as const;
	for (const key of arrays) if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === 'string')) throw new StateMigrationError(`Invalid ${provider} journal game ${key}.`);
	if (value.owned !== undefined && typeof value.owned !== 'boolean') throw new StateMigrationError(`Invalid ${provider} journal game ownership.`);
	if (value.playtimeMinutes !== undefined && (typeof value.playtimeMinutes !== 'number' || !Number.isFinite(value.playtimeMinutes) || value.playtimeMinutes < 0)) throw new StateMigrationError(`Invalid ${provider} journal game playtime.`);
	if (value.acquisitionType !== undefined && value.acquisitionType !== 'purchased' && value.acquisitionType !== 'subscription' && value.acquisitionType !== 'free' && value.acquisitionType !== 'key' && value.acquisitionType !== 'gift' && value.acquisitionType !== 'unknown') throw new StateMigrationError(`Invalid ${provider} journal game acquisition type.`);
	if (!isRecord(value.freshness)) throw new StateMigrationError(`Invalid ${provider} journal game freshness.`);
	rejectUnknownFields(value.freshness, ['metadata', 'ownership', 'playtime', 'achievements'], `${provider} journal game freshness`);
	const freshness = {
		metadata: requiredBoolean(value.freshness.metadata, `${provider} journal metadata freshness`),
		ownership: requiredBoolean(value.freshness.ownership, `${provider} journal ownership freshness`),
		playtime: requiredBoolean(value.freshness.playtime, `${provider} journal playtime freshness`),
		achievements: requiredBoolean(value.freshness.achievements, `${provider} journal achievement freshness`),
	};
	return {
		providerGameId: requiredString(value.providerGameId, `${provider} journal game ID`),
		title: value.title,
		originalTitle: optionalString(value.originalTitle, `${provider} journal original title`),
		releaseDate: optionalString(value.releaseDate, `${provider} journal release date`),
		description: optionalString(value.description, `${provider} journal description`),
		cover: optionalString(value.cover, `${provider} journal cover`),
		developers: readStringArray(value.developers, `${provider} journal developers`),
		publishers: readStringArray(value.publishers, `${provider} journal publishers`),
		genres: readStringArray(value.genres, `${provider} journal genres`),
		platforms: readStringArray(value.platforms, `${provider} journal platforms`),
		owned: value.owned,
		acquisitionType: value.acquisitionType,
		playtimeMinutes: value.playtimeMinutes,
		lastPlayed: optionalString(value.lastPlayed, `${provider} journal last played`),
		achievements: readAchievements(value.achievements, `${provider} journal achievements`),
		freshness,
	};
}

function readNormalizedGame(value: unknown): NormalizedGame {
	if (!isRecord(value)) throw new StateMigrationError('Invalid operation journal game payload.');
	rejectUnknownFields(value, [
		'identity', 'canonicalId', 'title', 'originalTitle', 'releaseDate', 'description', 'cover', 'developers', 'publishers', 'genres', 'platforms',
		'providers', 'owned', 'acquisitionType', 'playtimeMinutes', 'lastPlayed',
	], 'operation journal game');
	if (!isRecord(value.providers)) throw new StateMigrationError('Invalid operation journal game providers.');
	rejectUnknownFields(value.providers, ['steam', 'playstation'], 'operation journal provider');
	const providers: NormalizedGame['providers'] = {};
	for (const provider of ['steam', 'playstation'] as const) {
		if (value.providers[provider] !== undefined) providers[provider] = readNormalizedProviderGame(value.providers[provider], provider);
	}
	const acquisitionType = value.acquisitionType;
	if (acquisitionType !== 'purchased' && acquisitionType !== 'subscription' && acquisitionType !== 'free' && acquisitionType !== 'key' && acquisitionType !== 'gift' && acquisitionType !== 'unknown') throw new StateMigrationError('Invalid operation journal game acquisition type.');
	if (typeof value.owned !== 'boolean' || typeof value.playtimeMinutes !== 'number' || !Number.isFinite(value.playtimeMinutes) || value.playtimeMinutes < 0) throw new StateMigrationError('Invalid operation journal game totals.');
	return {
		identity: readGameIdentity(value.identity),
		canonicalId: requiredString(value.canonicalId, 'operation journal game canonicalId'),
		title: requiredString(value.title, 'operation journal game title'),
		originalTitle: optionalString(value.originalTitle, 'operation journal game original title'),
		releaseDate: optionalString(value.releaseDate, 'operation journal game release date'),
		description: optionalString(value.description, 'operation journal game description'),
		cover: optionalString(value.cover, 'operation journal game cover'),
		developers: readStringArray(value.developers, 'operation journal game developers'),
		publishers: readStringArray(value.publishers, 'operation journal game publishers'),
		genres: readStringArray(value.genres, 'operation journal game genres'),
		platforms: readStringArray(value.platforms, 'operation journal game platforms'),
		providers,
		owned: value.owned,
		acquisitionType,
		playtimeMinutes: value.playtimeMinutes,
		lastPlayed: optionalString(value.lastPlayed, 'operation journal game last played'),
	};
}

function readProviderSnapshots(raw: unknown, label: string): Partial<Record<GameProvider, ProviderGame[]>> {
	if (raw === undefined) return {};
	if (!isRecord(raw)) throw new StateMigrationError(`Invalid ${label} state.`);
	const result: Partial<Record<GameProvider, ProviderGame[]>> = {};
	for (const provider of Object.keys(raw)) {
		const providerName = providerValue(provider, `${label} provider`);
		const games = raw[provider];
		if (!Array.isArray(games)) throw new StateMigrationError(`Invalid ${label} list for ${provider}.`);
		result[providerName] = games.map((game) => readProviderGame(game, providerName));
	}
	return result;
}

function readLastSuccessfulProviderSnapshots(raw: unknown): GameSyncData['lastSuccessfulProviderSnapshots'] {
	return readProviderSnapshots(raw, 'provider snapshot');
}

function readLastAppliedProviderSnapshots(raw: unknown): GameSyncData['lastAppliedProviderSnapshots'] {
	return readProviderSnapshots(raw, 'applied provider snapshot');
}

function readOperation(value: unknown): Operation {
	if (!isRecord(value)) throw new StateMigrationError('Invalid operation journal operation.');
	rejectUnknownFields(value, ['id', 'canonicalGameId', 'kind', 'risk', 'path', 'summary', 'planRevision', 'expectedNoteFingerprint'], 'operation journal operation');
	const kind = value.kind;
	const risk = value.risk;
	if (kind !== 'create-note' && kind !== 'adopt-note' && kind !== 'update-properties' && kind !== 'add-achievement-block' && kind !== 'update-achievement-block' && kind !== 'link-providers' && kind !== 'unlink-providers' && kind !== 'create-base') throw new StateMigrationError('Invalid operation journal kind.');
	if (risk !== 'safe' && risk !== 'review') throw new StateMigrationError('Invalid operation journal risk.');
	const common: {
		canonicalGameId: string;
		risk: OperationRisk;
		summary: string;
		planRevision: string;
	} = {
		canonicalGameId: requiredString(value.canonicalGameId, 'operation journal canonicalGameId'),
		risk,
		summary: requiredString(value.summary, 'operation journal summary'),
		planRevision: requiredString(value.planRevision, 'operation journal planRevision'),
	};
	let operation: Operation;
	if (kind === 'create-note') {
		if (value.expectedNoteFingerprint !== null) throw new StateMigrationError('Create-note journal operation requires a null fingerprint.');
		operation = createOperation({ ...common, kind, path: requiredString(value.path, 'operation journal path'), expectedNoteFingerprint: null });
	} else if (kind === 'create-base') {
		if (value.expectedNoteFingerprint !== null) throw new StateMigrationError('Create-base journal operation requires a null fingerprint.');
		operation = createOperation({ ...common, kind, expectedNoteFingerprint: null });
	} else {
		operation = createOperation({
			...common,
			kind,
			path: requiredString(value.path, 'operation journal path'),
			expectedNoteFingerprint: requiredString(value.expectedNoteFingerprint, 'operation journal fingerprint'),
		});
	}
	if (value.id !== operation.id) throw new StateMigrationError('Operation journal ID does not match its operation.');
	return operation;
}

function readOperationJournal(raw: unknown): GameSyncData['operationJournal'] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) throw new StateMigrationError('Invalid operation journal state.');
	return raw.map((value) => {
			if (!isRecord(value)) throw new StateMigrationError('Invalid operation journal entry.');
			rejectUnknownFields(value, ['operation', 'game', 'noteApplied', 'noteFingerprintAfter', 'providerStateApplied', 'historyApplied', 'cacheApplied'], 'operation journal entry');
			if (typeof value.noteApplied !== 'boolean' || typeof value.providerStateApplied !== 'boolean' || typeof value.historyApplied !== 'boolean' || typeof value.cacheApplied !== 'boolean') throw new StateMigrationError('Invalid operation journal flags.');
			const noteFingerprintAfter = typeof value.noteFingerprintAfter === 'string' ? value.noteFingerprintAfter : undefined;
			if (value.noteFingerprintAfter !== undefined && noteFingerprintAfter === undefined) throw new StateMigrationError('Invalid operation journal note fingerprint.');
			if (!value.noteApplied && (value.providerStateApplied || value.historyApplied || value.cacheApplied)) throw new StateMigrationError('Operation journal hooks require an applied note.');
			if (value.noteApplied && (noteFingerprintAfter === undefined || noteFingerprintAfter.trim().length === 0)) throw new StateMigrationError('Applied operation journal note requires a fingerprint.');
			if (!value.noteApplied && noteFingerprintAfter !== undefined) throw new StateMigrationError('Pending operation journal note cannot have a fingerprint.');
			return {
				operation: readOperation(value.operation),
				game: value.game === undefined ? undefined : readNormalizedGame(value.game),
				noteApplied: value.noteApplied,
				noteFingerprintAfter,
			providerStateApplied: value.providerStateApplied,
			historyApplied: value.historyApplied,
			cacheApplied: value.cacheApplied,
		};
	});
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
			'propertyMapping',
			'identityMappings',
			'negativeMappings',
			'ignoredCanonicalIds',
			'ignoredProviderRefs',
			'presence',
			'providerCursors',
			'lastSuccessfulProviderStates',
			'lastSuccessfulProviderSnapshots',
			'lastAppliedProviderSnapshots',
			'operationJournal',
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
		propertyMapping: readPropertyMapping(raw.propertyMapping),
		identityMappings: readArray<IdentityMapping>(raw.identityMappings, [], readIdentityMapping, 'identity mapping'),
		negativeMappings: readArray<NegativeIdentityMapping>(raw.negativeMappings, [], readNegativeMapping, 'negative mapping'),
		ignoredCanonicalIds: raw.ignoredCanonicalIds === undefined ? [] : readStringList(raw.ignoredCanonicalIds, 'ignored canonical ID'),
		ignoredProviderRefs: raw.ignoredProviderRefs === undefined ? [] : readStringList(raw.ignoredProviderRefs, 'ignored provider reference'),
		presence: readPresence(raw.presence),
		providerCursors: readProviderCursors(raw.providerCursors),
		lastSuccessfulProviderStates: readLastSuccessfulProviderStates(raw.lastSuccessfulProviderStates),
		lastSuccessfulProviderSnapshots: readLastSuccessfulProviderSnapshots(raw.lastSuccessfulProviderSnapshots),
		lastAppliedProviderSnapshots: readLastAppliedProviderSnapshots(raw.lastAppliedProviderSnapshots),
		operationJournal: readOperationJournal(raw.operationJournal),
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
