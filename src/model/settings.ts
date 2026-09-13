export type PreviewMode = 'always' | 'first-and-review' | 'review-only';
export type MetadataLanguage = 'follow-obsidian' | 'english' | 'polish';
export type MetadataPreference = 'automatic' | 'english' | 'polish';
export type BackgroundNotifications = 'problems-only' | 'all' | 'none';

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
