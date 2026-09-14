export interface GameTrackPlatformPlaytime {
	readonly source: 'steam' | 'playstation';
	readonly platform: string;
	readonly value: number | null;
	readonly unit: 'minutes' | 'hours';
	readonly id?: string;
}

export interface GameTrackActivityDate {
	readonly source: 'playstation' | 'xbox';
	readonly value: number | string | null;
}

export interface GameTrackAchievementData {
	readonly source: 'steam' | 'playstation' | 'xbox';
	readonly platform: string;
	readonly unlocked?: number;
	readonly total?: number;
	readonly completionPercent?: number;
	readonly complete?: boolean;
}

export interface GameTrackRawGame {
	readonly gameTrackId: string;
	readonly igdbId?: number;
	readonly steamId?: string;
	readonly playstationId?: string;
	readonly xboxId?: string;
	readonly title: string;
	readonly summary?: string | null;
	readonly developer?: string | null;
	readonly publisher?: string | null;
	readonly releaseDate?: number | string | null;
	readonly cover?: string | null;
	readonly platforms: readonly string[];
	readonly ownedPlatform?: string | null;
	readonly playtimeHours?: number | null;
	readonly platformPlaytime: readonly GameTrackPlatformPlaytime[];
	readonly lastPlayed: readonly GameTrackActivityDate[];
	readonly achievements: readonly GameTrackAchievementData[];
	readonly genres: readonly string[];
}

export interface GameTrackQueryRow {
	readonly gameTrackId: string | null;
	readonly igdbId: number | null;
	readonly title: string | null;
	readonly summary: string | null;
	readonly developer: string | null;
	readonly publisher: string | null;
	readonly releaseDate: number | null;
	readonly cover: string | null;
	readonly ownedPlatform: string | null;
	readonly playtimeHours: number | null;
	readonly platformsHex: string | null;
	readonly platformPlaytimeJson: string;
	readonly lastPlayedJson: string;
	readonly achievementsJson: string;
	readonly genresJson: string;
}
