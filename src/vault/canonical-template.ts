import type { ProviderAchievement } from '../model/achievement';
import type { AchievementDetail, AchievementSummary, CanonicalGame } from '../model/canonical-game';
import { toIsoDate } from '../model/iso-date';
import { renderTemplate, type TemplateContext, type TemplateRenderOptions } from './template';
import type { VaultGateway } from './gateway';
import { resolveCanonicalOwnership } from './canonical-projection';

export interface CanonicalTemplateContextOptions {
	revealHidden?: boolean;
	updatedAt?: string;
}

export class CanonicalTemplateError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'CanonicalTemplateError';
	}
}

function achievement(detail: AchievementDetail, revealHidden: boolean): ProviderAchievement {
	const visible = revealHidden || detail.hidden !== true || detail.unlocked;
	const trophyType = detail.trophyType === 'bronze' || detail.trophyType === 'silver' || detail.trophyType === 'gold' || detail.trophyType === 'platinum'
		? detail.trophyType
		: undefined;
	return {
		id: detail.id,
		...(detail.name === undefined || !visible ? {} : { name: detail.name }),
		...(detail.description === undefined || !visible ? {} : { description: detail.description }),
		unlocked: detail.unlocked,
		...(detail.unlockedAt === undefined ? {} : { unlockedAt: detail.unlockedAt }),
		hidden: detail.hidden === true,
		...(detail.rarityPercent === undefined ? {} : { rarityPercent: detail.rarityPercent }),
		...(trophyType === undefined ? {} : { trophyType }),
		...(detail.iconUrl === undefined || !visible ? {} : { iconUrl: detail.iconUrl }),
	};
}

function summaryFor(game: CanonicalGame, source: 'steam' | 'playstation'): AchievementSummary | undefined {
	return game.achievements?.find((candidate) => candidate.source === source || candidate.platform === source);
}

function providerAchievements(summary: AchievementSummary | undefined, revealHidden: boolean): ProviderAchievement[] {
	return (summary?.details ?? []).map((detail) => achievement(detail, revealHidden));
}

function trophyCount(summary: AchievementSummary | undefined, type: 'bronze' | 'silver' | 'gold' | 'platinum'): number | undefined {
	if (summary?.details === undefined) return undefined;
	return summary.details.filter((detail) => detail.trophyType === type).length;
}

function providersFor(game: CanonicalGame): string[] {
	return [...new Set([game.provenance.provider, ...game.platforms.map((platform) => platform.source), ...game.playtime.observations.map((observation) => observation.source),
		...(game.activity?.lastPlayed === undefined ? [] : [game.activity.lastPlayed.source]), ...(game.achievements ?? []).map((summary) => summary.source)])]
		.filter((provider) => provider.trim().length > 0);
}

function hours(minutes: number | undefined): number | undefined {
	return minutes === undefined ? undefined : minutes / 60;
}

function providerPlaytime(game: CanonicalGame, provider: string): number | undefined {
	const values = game.playtime.observations
		.filter((observation) => observation.source === provider && observation.valid && observation.minutes !== undefined && Number.isFinite(observation.minutes) && observation.minutes >= 0)
		.map((observation) => observation.minutes as number);
	if (values.length === 0 || new Set(values).size > 1) return undefined;
	return values[0];
}

function providerLastPlayed(game: CanonicalGame, provider: string): string | undefined {
	const activity = game.activity?.lastPlayed;
	return activity?.source === provider ? toIsoDate(activity.value) : undefined;
}

/** Builds the documented flat template context from a canonical game. */
export function buildCanonicalTemplateContext(game: CanonicalGame, options: CanonicalTemplateContextOptions = {}): TemplateContext {
	const steam = summaryFor(game, 'steam');
	const playstation = summaryFor(game, 'playstation');
	const steamAchievements = providerAchievements(steam, options.revealHidden === true);
	const playstationTrophies = providerAchievements(playstation, options.revealHidden === true);
	const releaseDate = toIsoDate(game.metadata.releaseDate);
	const lastPlayed = toIsoDate(game.activity?.lastPlayed?.value ?? game.lastPlayed);
	const playtime = game.playtime.canonical?.minutes;
	const steamPlaytime = providerPlaytime(game, 'steam');
	const playstationPlaytime = providerPlaytime(game, 'playstation');
	const platforms = [...new Set(game.platforms.map((platform) => platform.id))];
	const providers = providersFor(game);
	return {
		id: game.identity.canonicalKey,
		title: game.title,
		original: undefined,
		year: releaseDate === undefined ? undefined : Number(releaseDate.slice(0, 4)),
		released: releaseDate,
		description: game.metadata.summary,
		cover: game.metadata.cover,
		developers: [...game.metadata.developers],
		publishers: [...game.metadata.publishers],
		genres: [...game.metadata.genres],
		platforms,
		providers,
		owned: resolveCanonicalOwnership(game.platforms),
		acquisitionType: 'unknown',
		playtime,
		playtimeHours: hours(playtime),
		lastPlayed,
		updated: options.updatedAt,
		steamId: game.identity.externalIds.steam,
		steamUrl: game.identity.externalIds.steam === undefined ? undefined : `https://store.steampowered.com/app/${encodeURIComponent(game.identity.externalIds.steam)}`,
		steamOwned: resolveCanonicalOwnership(game.platforms, 'steam'),
		steamPlaytime,
		steamPlaytimeHours: hours(steamPlaytime),
		steamLastPlayed: providerLastPlayed(game, 'steam'),
		steamAchievementsEarned: steam?.unlocked,
		steamAchievementsTotal: steam?.total,
		steamAchievementsProgress: steam?.completionPercent,
		steamAchievements,
		playstationId: game.identity.externalIds.playstation,
		playstationUrl: undefined,
		playstationOwned: resolveCanonicalOwnership(game.platforms, 'playstation'),
		playstationPlaytime,
		playstationPlaytimeHours: hours(playstationPlaytime),
		playstationLastPlayed: providerLastPlayed(game, 'playstation'),
		psnTrophiesEarned: playstation?.unlocked,
		psnTrophiesTotal: playstation?.total,
		psnTrophiesProgress: playstation?.completionPercent,
		psnBronze: trophyCount(playstation, 'bronze'),
		psnSilver: trophyCount(playstation, 'silver'),
		psnGold: trophyCount(playstation, 'gold'),
		psnPlatinum: trophyCount(playstation, 'platinum'),
		playstationTrophies,
		purchaseDate: undefined,
		purchasePrice: undefined,
		purchaseCurrency: undefined,
		purchaseSource: undefined,
		developersText: game.metadata.developers.join(', '),
		publishersText: game.metadata.publishers.join(', '),
		genresText: game.metadata.genres.join(', '),
		platformsText: platforms.join(', '),
		providersText: providers.join(', '),
	};
}

export function renderCanonicalTemplate(template: string, game: CanonicalGame, options: TemplateRenderOptions & CanonicalTemplateContextOptions = {}): string {
	return renderTemplate(template, buildCanonicalTemplateContext(game, options), options);
}

export async function readCanonicalTemplate(gateway: VaultGateway, templatePath: string | undefined): Promise<string | undefined> {
	const path = templatePath?.trim() ?? '';
	if (path.length === 0) return undefined;
	try {
		if (!(await gateway.exists(path))) throw new CanonicalTemplateError(`Configured template file is missing: ${path}. Clear the Template setting or create this vault file.`);
		return await gateway.read(path);
	} catch (error) {
		if (error instanceof CanonicalTemplateError) throw error;
		throw new CanonicalTemplateError(`Unable to read configured template file ${path}. Check that the path points to a readable vault file.`, { cause: error });
	}
}
