export interface ProviderAchievement {
	id: string;
	name?: string;
	description?: string;
	unlocked: boolean;
	unlockedAt?: string;
	hidden: boolean;
	rarityPercent?: number;
	trophyType?: 'bronze' | 'silver' | 'gold' | 'platinum';
	iconUrl?: string;
}

export interface ProviderAchievementSet {
	earned: number;
	total: number;
	progress: number;
	achievements: ProviderAchievement[];
}
