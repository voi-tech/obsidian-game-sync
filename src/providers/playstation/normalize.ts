import type { ProviderGame } from '../../model/provider';
import { titleMatchKey } from '../../identity/normalize-title';
import type { PlayStationPlayedGame, PlayStationPurchasedGame, PlayStationRecentlyPlayedGame, PlayStationTrophyTitle } from './types';

interface Group {
	conceptId?: string;
	title: string;
	cover?: string;
	platforms: Set<string>;
	titleIds: Set<string>;
	played: PlayStationPlayedGame[];
	purchased: PlayStationPurchasedGame[];
	recent: PlayStationRecentlyPlayedGame[];
	npCommunicationIds: Set<string>;
}

function id(value: number | string | null | undefined): string | undefined {
	if (value === undefined || value === null || String(value).trim() === '') return undefined;
	return String(value);
}

function conceptKey(conceptId: string | undefined, titleId: string | undefined, name: string): string {
	return conceptId ?? titleId ?? `name:${name.trim().toLowerCase()}`;
}

function platform(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const lower = value.toLowerCase();
	if (lower.includes('ps5')) return 'ps5';
	if (lower.includes('ps4')) return 'ps4';
	return undefined;
}

function minutes(duration: string | undefined): number | undefined {
	if (duration === undefined) return undefined;
	const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(duration);
	if (match === null) return undefined;
	const days = Number(match[1] ?? 0);
	const hours = Number(match[2] ?? 0);
	const mins = Number(match[3] ?? 0);
	const seconds = Number(match[4] ?? 0);
	return Math.floor(days * 1440 + hours * 60 + mins + seconds / 60);
}

export interface PlayStationLibrarySources {
	played: readonly PlayStationPlayedGame[];
	purchased?: readonly PlayStationPurchasedGame[];
	recentlyPlayed?: readonly PlayStationRecentlyPlayedGame[];
	trophyTitles?: readonly PlayStationTrophyTitle[];
	ownershipKnown?: boolean;
}

export interface PlayStationNormalizationResult {
	games: ProviderGame[];
	ownershipKnown: boolean;
	trophyServices: ReadonlyMap<string, 'trophy' | 'trophy2'>;
}

export function normalizePlayStationLibrary(sources: PlayStationLibrarySources): PlayStationNormalizationResult {
	const groups = new Map<string, Group>();
	const trophyServices = new Map<string, 'trophy' | 'trophy2'>();
	const ownershipKnown = sources.ownershipKnown ?? sources.purchased !== undefined;
	const ensure = (key: string, title: string): Group => {
		const existing = groups.get(key);
		if (existing !== undefined) return existing;
		const created: Group = { title, platforms: new Set(), titleIds: new Set(), played: [], purchased: [], recent: [], npCommunicationIds: new Set() };
		groups.set(key, created);
		return created;
	};
	const groupKeyByTitleId = new Map<string, string>();
	const remember = (key: string, group: Group): void => {
		for (const titleId of group.titleIds) if (!groupKeyByTitleId.has(titleId)) groupKeyByTitleId.set(titleId, key);
	};
	// Purchases and recent entries often come without a concept ID. Their title ID usually belongs to a concept
	// already seen in the played list; grouping by the bare title ID would split one game into several.
	const keyFor = (conceptId: string | undefined, titleId: string | undefined, name: string): string =>
		conceptId ?? (titleId === undefined ? undefined : groupKeyByTitleId.get(titleId)) ?? conceptKey(undefined, titleId, name);
	for (const entry of sources.played) {
		const conceptId = id(entry.concept?.id);
		const key = keyFor(conceptId, entry.titleId, entry.name);
		const group = ensure(key, entry.concept?.name ?? entry.localizedName ?? entry.name);
		group.conceptId ??= conceptId;
		group.played.push(entry);
		group.titleIds.add(entry.titleId);
		for (const titleId of entry.concept?.titleIds ?? []) group.titleIds.add(titleId);
		remember(key, group);
		const currentPlatform = platform(entry.category);
		if (currentPlatform !== undefined) group.platforms.add(currentPlatform);
		group.cover ??= entry.imageUrl ?? entry.localizedImageUrl;
	}
	for (const entry of sources.purchased ?? []) {
		const conceptId = entry.conceptId ?? undefined;
		const key = keyFor(conceptId, entry.titleId, entry.name);
		const group = ensure(key, entry.name);
		group.conceptId ??= conceptId;
		group.purchased.push(entry);
		if (entry.titleId !== undefined) group.titleIds.add(entry.titleId);
		remember(key, group);
		const currentPlatform = platform(entry.platform);
		if (currentPlatform !== undefined) group.platforms.add(currentPlatform);
		group.cover ??= entry.image?.url;
	}
	for (const entry of sources.recentlyPlayed ?? []) {
		const key = keyFor(entry.conceptId, entry.titleId, entry.name);
		const group = ensure(key, entry.name);
		group.conceptId ??= entry.conceptId;
		group.recent.push(entry);
		if (entry.titleId !== undefined) group.titleIds.add(entry.titleId);
		const currentPlatform = platform(entry.platform);
		if (currentPlatform !== undefined) group.platforms.add(currentPlatform);
		group.cover ??= entry.image?.url;
	}
	for (const trophyTitle of sources.trophyTitles ?? []) {
		const comparable = titleMatchKey(trophyTitle.trophyTitleName);
		const matches = [...groups.values()].filter((entry) => titleMatchKey(entry.title) === comparable);
		// Trophies are earned by playing: when a title also has an unplayed purchase entry, the played one wins.
		const played = matches.filter((entry) => entry.played.length > 0 || entry.recent.length > 0);
		const candidates = matches.length === 1 ? matches : played;
		if (candidates.length !== 1) continue;
		const group = candidates[0];
		// The communication ID belongs to the trophy identity, not to a title ID.
		group.npCommunicationIds.add(trophyTitle.npCommunicationId);
		if (trophyTitle.npServiceName !== undefined) trophyServices.set(trophyTitle.npCommunicationId, trophyTitle.npServiceName);
	}
	const games = [...groups.values()].flatMap((group) => {
		const playedMinutes = group.played.map((entry) => minutes(entry.playDuration)).filter((value): value is number => value !== undefined);
		const lastPlayed = [...group.played.map((entry) => entry.lastPlayedDateTime), ...group.recent.map((entry) => entry.lastPlayedDateTime)].filter((value): value is string => value !== undefined).sort().at(-1);
		const first = group.played[0];
		const providerGameId = group.conceptId ?? [...group.titleIds][0] ?? group.title;
		const owned = !ownershipKnown ? undefined : group.purchased.length > 0 ? true : group.played.length > 0 ? false : undefined;
		const service = first?.service?.toLowerCase();
		if (group.conceptId === undefined && group.titleIds.size === 0) return [];
		const communicationIds = [...group.npCommunicationIds].sort();
		const identity = group.conceptId !== undefined
			? { provider: 'playstation' as const, conceptId: group.conceptId, titleIds: [...group.titleIds].sort(), npCommunicationIds: communicationIds }
			: { provider: 'playstation' as const, titleIds: [...group.titleIds].sort() as [string, ...string[]], npCommunicationIds: communicationIds };
		return [{
			provider: 'playstation' as const,
			providerGameId,
			title: group.title,
			cover: group.cover,
			developers: [],
			publishers: [],
			genres: [],
			platforms: [...group.platforms].sort(),
			owned,
			acquisitionType: service === 'ps_plus' ? 'subscription' as const : owned === true ? 'purchased' as const : 'unknown' as const,
			playtimeMinutes: playedMinutes.length === 0 ? undefined : Math.max(...playedMinutes),
			lastPlayed,
			freshness: { metadata: true, ownership: ownershipKnown, playtime: true, achievements: false },
			identity,
		}];
	});
	return { games, ownershipKnown, trophyServices };
}

export function normalizePlayStationGames(sources: PlayStationLibrarySources): ProviderGame[] {
	return normalizePlayStationLibrary(sources).games;
}
