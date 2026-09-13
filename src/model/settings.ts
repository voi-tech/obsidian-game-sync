export type PreviewMode = 'always' | 'first-and-review' | 'review-only';
export type MetadataLanguage = 'follow-obsidian' | 'english' | 'polish';
export type MetadataPreference = 'automatic' | 'english' | 'polish';
export type BackgroundNotifications = 'problems-only' | 'all' | 'none';

export const SUPPORTED_BACKGROUND_INTERVAL_MINUTES = [30, 60, 360, 720, 1440] as const;
export type SupportedBackgroundIntervalMinutes = typeof SUPPORTED_BACKGROUND_INTERVAL_MINUTES[number];

export function isSupportedBackgroundIntervalMinutes(value: unknown): value is SupportedBackgroundIntervalMinutes {
	return typeof value === 'number'
		&& SUPPORTED_BACKGROUND_INTERVAL_MINUTES.includes(value as SupportedBackgroundIntervalMinutes);
}

export interface GameSyncSettings {
	setupCompleted: boolean;
	firstSyncCompleted: boolean;
	steamAccountId?: string;
	enabledProviders: {
		steam: boolean;
		playstation: boolean;
	};
	notesFolder: string;
	filenamePattern: string;
	templatePath: string;
	createBase: boolean;
	basePath: string;
	includeUnplayed: boolean;
	includeFreeToPlay: boolean;
	includePreviouslyPlayedNoLongerOwned: boolean;
	includeDemosTrials: boolean;
	includeBetasTestApps: boolean;
	previewMode: PreviewMode;
	backgroundSync: boolean;
	backgroundIntervalMinutes: number;
	metadataLanguage: MetadataLanguage;
	metadataPreference: MetadataPreference;
	revealHiddenAchievements: boolean;
	showAchievementRarity: boolean;
	showTrophyType: boolean;
	showUnlockDate: boolean;
	recordHistory: boolean;
	historyPath: string;
	backgroundNotifications: BackgroundNotifications;
}
