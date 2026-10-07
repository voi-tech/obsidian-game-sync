import Handlebars from 'handlebars';
import type { ProviderAchievement } from '../model/achievement';
import type { NormalizedGame } from '../model/game';
import { renderAchievementList } from './achievement-renderer';
import { toIsoDate } from '../model/iso-date';

export interface TemplateContext {
	id: string;
	title: string;
	original?: string;
	year?: number;
	released?: string;
	description?: string;
	cover?: string;
	developers: string[];
	publishers: string[];
	genres: string[];
	platforms: string[];
	providers: string[];
	owned?: boolean;
	acquisitionType?: string;
	playtime?: number;
	playtimeHours?: number;
	lastPlayed?: string;
	updated?: string;
	steamId?: string;
	steamUrl?: string;
	steamOwned?: boolean;
	steamPlaytime?: number;
	steamPlaytimeHours?: number;
	steamLastPlayed?: string;
	steamAchievementsEarned?: number;
	steamAchievementsTotal?: number;
	steamAchievementsProgress?: number;
	steamAchievements: ProviderAchievement[];
	playstationId?: string;
	playstationUrl?: string;
	playstationOwned?: boolean;
	playstationPlaytime?: number;
	playstationPlaytimeHours?: number;
	playstationLastPlayed?: string;
	psnTrophiesEarned?: number;
	psnTrophiesTotal?: number;
	psnTrophiesProgress?: number;
	psnBronze?: number;
	psnSilver?: number;
	psnGold?: number;
	psnPlatinum?: number;
	playstationTrophies: ProviderAchievement[];
	purchaseDate?: string;
	purchasePrice?: number;
	purchaseCurrency?: string;
	purchaseSource?: string;
	developersText: string;
	publishersText: string;
	genresText: string;
	platformsText: string;
	providersText: string;
}

export interface TemplateRenderOptions {
	now?: Date;
}

export interface TemplateContextOptions {
	updatedAt?: string;
	revealHidden?: boolean;
}

function hours(minutes: unknown): number | string {
	return typeof minutes === 'number' && Number.isFinite(minutes) ? minutes / 60 : '';
}

function percent(value: unknown): string {
	return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '';
}

function dateFormat(value: unknown, format = 'YYYY-MM-DD'): string {
	if (value === undefined || value === null || value === '') return '';
	const dateInput = value instanceof Date || typeof value === 'string' || typeof value === 'number' ? value : undefined;
	if (dateInput === undefined) return '';
	const parsed = new Date(dateInput);
	if (Number.isNaN(parsed.getTime())) return '';
	const replacements: Record<string, string> = {
		YYYY: String(parsed.getUTCFullYear()).padStart(4, '0'), MM: String(parsed.getUTCMonth() + 1).padStart(2, '0'),
		DD: String(parsed.getUTCDate()).padStart(2, '0'), HH: String(parsed.getUTCHours()).padStart(2, '0'),
		mm: String(parsed.getUTCMinutes()).padStart(2, '0'), ss: String(parsed.getUTCSeconds()).padStart(2, '0'),
	};
	return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => replacements[token]);
}

function resolveObsidianPlaceholders(source: string, now: Date): string {
	return source.replace(/\{\{(date|time):([^}]+)\}\}/g, (_match, kind: string, format: string) => {
		return dateFormat(now, kind === 'time' ? format : format);
	});
}

function normalizedAchievements(achievements: readonly ProviderAchievement[] | undefined, revealHidden: boolean): ProviderAchievement[] {
	return (achievements ?? []).map((achievement) => ({
		id: achievement.id,
		...(achievement.hidden && !achievement.unlocked && !revealHidden ? {} : { name: achievement.name, description: achievement.description, iconUrl: achievement.iconUrl }),
		unlocked: achievement.unlocked,
		unlockedAt: achievement.unlockedAt,
		hidden: achievement.hidden,
		rarityPercent: achievement.rarityPercent,
		trophyType: achievement.trophyType,
	}));
}

export function buildTemplateContext(game: NormalizedGame, options: TemplateContextOptions = {}): TemplateContext {
	const steam = game.providers.steam;
	const playstation = game.providers.playstation;
	const steamAchievements = normalizedAchievements(steam?.achievements?.achievements, options.revealHidden === true);
	const playstationTrophies = normalizedAchievements(playstation?.achievements?.achievements, options.revealHidden === true);
	const values: TemplateContext = {
		id: game.canonicalId, title: game.title, original: game.originalTitle, year: game.releaseDate ? Number(game.releaseDate.slice(0, 4)) : undefined,
		released: toIsoDate(game.releaseDate), description: game.description, cover: game.cover, developers: [...game.developers], publishers: [...game.publishers],
		genres: [...game.genres], platforms: [...game.platforms], providers: Object.keys(game.providers), owned: game.owned, acquisitionType: game.acquisitionType,
		playtime: game.playtimeMinutes, playtimeHours: hours(game.playtimeMinutes) as number, lastPlayed: toIsoDate(game.lastPlayed), updated: options.updatedAt,
		steamId: steam?.providerGameId, steamUrl: steam?.sourceUrl, steamOwned: steam?.owned, steamPlaytime: steam?.playtimeMinutes,
		steamPlaytimeHours: steam?.playtimeMinutes === undefined ? undefined : (hours(steam.playtimeMinutes) as number), steamLastPlayed: toIsoDate(steam?.lastPlayed),
		steamAchievementsEarned: steam?.achievements?.earned, steamAchievementsTotal: steam?.achievements?.total, steamAchievementsProgress: steam?.achievements?.progress,
		steamAchievements, playstationId: playstation?.providerGameId, playstationUrl: playstation?.sourceUrl, playstationOwned: playstation?.owned,
		playstationPlaytime: playstation?.playtimeMinutes, playstationPlaytimeHours: playstation?.playtimeMinutes === undefined ? undefined : (hours(playstation.playtimeMinutes) as number),
		playstationLastPlayed: toIsoDate(playstation?.lastPlayed), psnTrophiesEarned: playstation?.achievements?.earned, psnTrophiesTotal: playstation?.achievements?.total,
		psnTrophiesProgress: playstation?.achievements?.progress,
		psnBronze: playstation?.achievements?.achievements.filter((achievement) => achievement.trophyType === 'bronze').length,
		psnSilver: playstation?.achievements?.achievements.filter((achievement) => achievement.trophyType === 'silver').length,
		psnGold: playstation?.achievements?.achievements.filter((achievement) => achievement.trophyType === 'gold').length,
		psnPlatinum: playstation?.achievements?.achievements.filter((achievement) => achievement.trophyType === 'platinum').length,
		playstationTrophies, purchaseDate: undefined, purchasePrice: undefined, purchaseCurrency: undefined, purchaseSource: undefined,
		developersText: game.developers.join(', '), publishersText: game.publishers.join(', '), genresText: game.genres.join(', '),
		platformsText: game.platforms.join(', '), providersText: Object.keys(game.providers).join(', '),
	};
	return values;
}

function createHandlebars(options: TemplateRenderOptions): typeof Handlebars {
	const handlebars = Handlebars.create();
	// Handlebars passes its options object as the last argument, so `{{join list}}` must fall back to the default separator.
	handlebars.registerHelper('join', (value: unknown, separator: unknown) => Array.isArray(value) ? value.join(typeof separator === 'string' ? separator : ', ') : '');
	handlebars.registerHelper('hours', hours);
	handlebars.registerHelper('percent', percent);
	handlebars.registerHelper('date', (value: unknown, formatOrOptions: unknown) => {
		const format = typeof formatOrOptions === 'string' ? formatOrOptions : 'YYYY-MM-DD';
		return dateFormat(value, format);
	});
	handlebars.registerHelper('renderAchievementList', (value: unknown, provider: 'steam' | 'playstation') => {
		return Array.isArray(value) ? renderAchievementList(value as ProviderAchievement[], provider) : '';
	});
	handlebars.registerPartial('achievements', '{{{renderAchievementList steamAchievements "steam"}}}\n{{{renderAchievementList playstationTrophies "playstation"}}}');
	handlebars.registerPartial('steamAchievements', '{{{renderAchievementList steamAchievements "steam"}}}');
	handlebars.registerPartial('playstationTrophies', '{{{renderAchievementList playstationTrophies "playstation"}}}');
	void options;
	return handlebars;
}

export function renderTemplate(template: string, context: TemplateContext, options: TemplateRenderOptions = {}): string {
	try {
		const source = resolveObsidianPlaceholders(template, options.now ?? new Date());
		return createHandlebars(options).compile(source, { noEscape: true })(context);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Template rendering failed: ${message}`, { cause: error });
	}
}

export function renderFilename(pattern: string, context: TemplateContext, options: TemplateRenderOptions = {}): string {
	const sanitize = (value: string): string => value
		.replace(/[<>:"/\\|?*]/g, ' ')
		.split('')
		.filter((character) => character.charCodeAt(0) >= 32)
		.join('')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+|\.+$/g, '');
	const rendered = sanitize(renderTemplate(pattern.trim(), context, options));
	if (rendered.length > 0) return rendered;
	const fallback = sanitize(context.title);
	return fallback.length > 0 ? fallback : 'game';
}
