import type { ProviderAchievement, ProviderAchievementSet } from '../model/achievement';
import type { NormalizedGame } from '../model/game';

export interface AchievementRenderOptions {
	revealHidden?: boolean;
	showRarity?: boolean;
	showUnlockDate?: boolean;
	showTrophyType?: boolean;
}

export interface AchievementRenderInput {
	steam?: ProviderAchievementSet;
	playstation?: ProviderAchievementSet;
}

const TROPHY_ICON: Record<NonNullable<ProviderAchievement['trophyType']>, string> = {
	bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '🏆',
};

function asAchievementInput(input: NormalizedGame | AchievementRenderInput): AchievementRenderInput {
	if ('providers' in input) return { steam: input.providers.steam?.achievements, playstation: input.providers.playstation?.achievements };
	return input;
}

function formatPercent(value: number): string {
	return `${value.toFixed(2)}%`;
}

function isVisible(achievement: ProviderAchievement, options: AchievementRenderOptions): boolean {
	return !achievement.hidden || achievement.unlocked || options.revealHidden === true;
}

function achievementLabel(achievement: ProviderAchievement, provider: 'steam' | 'playstation', options: AchievementRenderOptions): string {
	if (!isVisible(achievement, options)) return provider === 'steam' ? '🔒 Hidden achievement' : '🔒 Hidden trophy';
	const prefix = provider === 'playstation' && options.showTrophyType && achievement.trophyType ? `${TROPHY_ICON[achievement.trophyType]} ` : '';
	return `${prefix}${achievement.name ?? (provider === 'steam' ? 'Unnamed achievement' : 'Unnamed trophy')}`;
}

export function renderAchievementList(
	achievements: readonly ProviderAchievement[],
	provider: 'steam' | 'playstation',
	options: AchievementRenderOptions = {},
): string {
	return achievements.map((achievement) => {
		const suffix: string[] = [];
		if (options.showUnlockDate && achievement.unlocked && achievement.unlockedAt) suffix.push(achievement.unlockedAt.slice(0, 10));
		if (options.showRarity && achievement.rarityPercent !== undefined) suffix.push(formatPercent(achievement.rarityPercent));
		return `- [${achievement.unlocked ? 'x' : ' '}] ${achievementLabel(achievement, provider, options)}${suffix.length > 0 ? ` — ${suffix.join(' · ')}` : ''}`;
	}).join('\n');
}

function renderProviderSection(
	label: string,
	provider: 'steam' | 'playstation',
	set: ProviderAchievementSet,
	options: AchievementRenderOptions,
): string {
	const entries = renderAchievementList(set.achievements, provider, options);
	return `## ${label}\n\n${set.earned} / ${set.total} · ${formatPercent(set.progress)}${entries.length > 0 ? `\n\n${entries}` : ''}`;
}

export function renderAchievementsBlock(
	input: NormalizedGame | AchievementRenderInput,
	options: AchievementRenderOptions = {},
): string {
	const sets = asAchievementInput(input);
	const sections: string[] = [];
	if (sets.steam && (sets.steam.total > 0 || sets.steam.achievements.length > 0)) sections.push(renderProviderSection('Steam achievements', 'steam', sets.steam, options));
	if (sets.playstation && (sets.playstation.total > 0 || sets.playstation.achievements.length > 0)) sections.push(renderProviderSection('PlayStation trophies', 'playstation', sets.playstation, options));
	if (sections.length === 0) return '';
	return `%% game-sync:achievements %%\n\n${sections.join('\n\n')}\n\n%% /game-sync:achievements %%`;
}
