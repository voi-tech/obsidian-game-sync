export type Confidence = 'high' | 'medium' | 'low';

export interface GameIdentity {
	readonly canonicalKey: string;
	readonly externalIds: {
		readonly igdb?: number;
		readonly gametrack?: string;
		readonly steam?: string;
		readonly playstation?: string;
		readonly xbox?: string;
	};
}

export interface GameMetadata {
	readonly releaseDate?: string;
	readonly developers: readonly string[];
	readonly publishers: readonly string[];
	readonly genres: readonly string[];
	readonly summary?: string;
	readonly cover?: string;
}

export interface PlatformPresence {
	readonly id: string;
	readonly owned?: boolean;
	readonly source: string;
	readonly rawName?: string;
}

export interface CanonicalActivityValue {
	readonly value: string;
	readonly source: string;
	readonly confidence: Confidence;
}

export interface GameActivity {
	readonly lastPlayed?: CanonicalActivityValue;
}

export interface PlaytimeObservation {
	readonly source: string;
	readonly platform?: string;
	readonly rawValue: number | null;
	readonly rawUnit: string;
	readonly minutes?: number;
	readonly confidence: Confidence;
	readonly valid: boolean;
	readonly anomaly?: string;
}

export interface GamePlaytime {
	readonly canonical?: {
		readonly minutes: number;
		readonly source: string;
		readonly confidence: Confidence;
	};
	readonly observations: readonly PlaytimeObservation[];
}

export interface AchievementSummary {
	readonly source: string;
	readonly platform?: string;
	readonly unlocked?: number;
	readonly total?: number;
	readonly completionPercent?: number;
	readonly confidence: Confidence;
	readonly details?: readonly AchievementDetail[];
}

export interface AchievementDetail {
	readonly id: string;
	readonly name?: string;
	readonly description?: string;
	readonly unlocked: boolean;
	readonly unlockedAt?: string;
	readonly hidden?: boolean;
	readonly iconUrl?: string;
	readonly rarityPercent?: number;
	readonly trophyType?: string;
}

export interface GameProvenance {
	readonly provider: string;
	readonly sourceId: string;
	readonly schemaSignature: string;
}

export interface CanonicalGame {
	readonly identity: GameIdentity;
	readonly title: string;
	readonly aliases?: readonly string[];
	readonly lastPlayed?: string;
	readonly activity?: GameActivity;
	readonly metadata: GameMetadata;
	readonly platforms: readonly PlatformPresence[];
	readonly playtime: GamePlaytime;
	readonly achievements?: readonly AchievementSummary[];
	readonly provenance: GameProvenance;
}
