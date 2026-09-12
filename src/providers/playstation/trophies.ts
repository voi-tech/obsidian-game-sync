import type { ProviderAchievement, ProviderAchievementSet } from '../../model/achievement';
import type { PlayStationEarnedTrophies, PlayStationTrophyMetadata } from './types';

export function normalizePlayStationTrophies(metadata: PlayStationTrophyMetadata, earned: PlayStationEarnedTrophies): ProviderAchievementSet {
	const earnedById = new Map(earned.trophies.map((entry) => [entry.trophyId, entry]));
	const achievements: ProviderAchievement[] = metadata.trophies.flatMap((entry) => {
		if (entry.trophyType === undefined) return [];
		const state = earnedById.get(entry.trophyId);
		const unlocked = state?.earned === true;
		const rarity = state?.trophyEarnedRate === undefined ? undefined : Number(state.trophyEarnedRate);
		return [{
			id: String(entry.trophyId),
			name: entry.trophyName,
			description: entry.trophyDetail,
			unlocked,
			unlockedAt: unlocked ? state?.earnedDateTime : undefined,
			hidden: entry.trophyHidden ?? state?.trophyHidden ?? false,
			rarityPercent: rarity !== undefined && Number.isFinite(rarity) ? rarity : undefined,
			trophyType: entry.trophyType,
			iconUrl: entry.trophyIconUrl,
		}];
	});
	const earnedCount = achievements.filter((entry) => entry.unlocked).length;
	return { earned: earnedCount, total: achievements.length, progress: achievements.length === 0 ? 0 : Math.round((earnedCount / achievements.length) * 100), achievements };
}

export function choosePlayStationNpServiceName(platforms: readonly string[], explicit?: 'trophy' | 'trophy2'): 'trophy' | 'trophy2' | undefined {
	if (explicit !== undefined) return explicit;
	const normalized = [...new Set(platforms.map((platform) => platform.toLowerCase()))];
	if (normalized.length !== 1) return undefined;
	if (normalized[0] === 'ps5') return 'trophy2';
	if (normalized[0] === 'ps4') return 'trophy';
	return undefined;
}
