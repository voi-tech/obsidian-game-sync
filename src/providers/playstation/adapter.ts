import type { ProviderAchievementProvenance, ProviderGame, ProviderSnapshot } from '../../model/provider';
import type { PlayStationIdentity } from '../../model/identity';
import { ProviderAuthError } from '../../network/errors';
import type { GameProviderAdapter, ProviderConnectionStatus, ProviderFetchOptions } from '../provider';
import { createPlayStationApi } from './api';
import { createPlayStationAuth } from './auth';
import { normalizePlayStationLibrary } from './normalize';
import { choosePlayStationNpServiceName, normalizePlayStationTrophies } from './trophies';
import type { PlayStationAdapterOptions, PlayStationApi } from './types';

function snapshotFailure(error: unknown, games: ProviderGame[], now: string): ProviderSnapshot {
	return {
		provider: 'playstation',
		status: games.length > 0 ? 'partial' : 'failed',
		games,
		fetchedAt: now,
		pagination: { complete: false, pagesFetched: 0 },
		paginationComplete: false,
		error: { code: error instanceof Error && 'code' in error ? String(error.code) : 'playstation-provider-failure', message: error instanceof Error ? error.message : 'PlayStation provider request failed.' },
	};
}

function mergeAchievementSets(sets: ReturnType<typeof normalizePlayStationTrophies>[]): ReturnType<typeof normalizePlayStationTrophies> | undefined {
	if (sets.length === 0) return undefined;
	const achievements = sets.flatMap((set) => set.achievements);
	const earned = achievements.filter((entry) => entry.unlocked).length;
	return { earned, total: achievements.length, progress: achievements.length === 0 ? 0 : Math.round((earned / achievements.length) * 100), achievements };
}

function findPreviousGame(game: ProviderGame, previous: readonly ProviderGame[]): ProviderGame | undefined {
	const currentIdentity = game.identity;
	if (currentIdentity.provider !== 'playstation') return undefined;
	return previous.find((candidate) => {
		if (candidate.provider !== 'playstation' || candidate.identity.provider !== 'playstation') return false;
		const previousIdentity = candidate.identity;
		if (candidate.providerGameId === game.providerGameId) return true;
		if (currentIdentity.conceptId !== undefined && previousIdentity.conceptId === currentIdentity.conceptId) return true;
		return currentIdentity.titleIds.some((titleId) => previousIdentity.titleIds.includes(titleId)) || currentIdentity.npCommunicationIds.some((communicationId) => previousIdentity.npCommunicationIds.includes(communicationId));
	});
}

function mergePlayStationIdentity(current: PlayStationIdentity, previous: PlayStationIdentity): PlayStationIdentity {
	const conceptId = current.conceptId ?? previous.conceptId;
	const titleIds = [...new Set([...current.titleIds, ...previous.titleIds])].sort();
	const npCommunicationIds = [...new Set([...current.npCommunicationIds, ...previous.npCommunicationIds])].sort();
	if (conceptId !== undefined) return { provider: 'playstation', conceptId, titleIds, npCommunicationIds };
	return { provider: 'playstation', titleIds: titleIds as [string, ...string[]], npCommunicationIds };
}

function cacheIsFresh(game: ProviderGame, previous: ProviderGame | undefined, options: ProviderFetchOptions, now: string): boolean {
	if (options.force === true || previous?.freshness.achievements !== true) return false;
	const cache = options.achievementCache?.[game.providerGameId];
	if (cache === undefined) return false;
	const fetchedAt = Date.parse(cache.fetchedAt);
	const current = Date.parse(now);
	const ttl = options.achievementCacheTtlMs ?? 7 * 24 * 60 * 60 * 1000;
	return Number.isFinite(fetchedAt) && Number.isFinite(current) && current - fetchedAt < ttl;
}

export function createPlayStationAdapter(options: PlayStationAdapterOptions): GameProviderAdapter {
	const auth = createPlayStationAuth(options);
	let api: PlayStationApi | undefined = options.api;

	const getApi = (): PlayStationApi => {
		if (api !== undefined) return api;
		api = createPlayStationApi(auth, auth.getAccount()?.accountId ?? 'me');
		return api;
	};

	return {
		id: 'playstation',
		async getConnectionStatus(): Promise<ProviderConnectionStatus> {
			return auth.getConnectionStatus();
		},
		async testConnection() {
			await auth.getAccessToken();
			return auth.getAccount() ?? { provider: 'playstation', accountId: 'playstation-account', displayName: 'PlayStation' };
		},
		async fetchLibrary(options: ProviderFetchOptions): Promise<ProviderSnapshot> {
			const now = options.now ?? new Date().toISOString();
			const previous = options.previousGames ?? [];
			try {
				const activeApi = getApi();
				const playedResult = await activeApi.getUserPlayedGames({ limit: 800 });
				let purchased: Awaited<ReturnType<PlayStationApi['getPurchasedGames']>>['games'] = [];
				let purchasesComplete = false;
				let purchasesPages = 0;
				let recentlyPlayed: Awaited<ReturnType<PlayStationApi['getRecentlyPlayedGames']>>['games'] = [];
				let recentlyPlayedComplete = false;
				let recentlyPlayedPages = 0;
				let trophyTitles: Awaited<ReturnType<PlayStationApi['getUserTitles']>>['titles'] = [];
				let trophyTitlesComplete = false;
				let trophyTitlesPages = 0;
				const sourceErrors: string[] = [];
				try {
					const result = await activeApi.getPurchasedGames();
					purchased = result.games;
					purchasesComplete = result.complete;
					purchasesPages = result.pagesFetched;
				} catch {
					sourceErrors.push('purchases');
				}
				try {
					const result = await activeApi.getRecentlyPlayedGames();
					recentlyPlayed = result.games;
					recentlyPlayedComplete = result.complete;
					recentlyPlayedPages = result.pagesFetched;
				} catch {
					sourceErrors.push('recently-played');
				}
				try {
					const result = await activeApi.getUserTitles();
					trophyTitles = result.titles;
					trophyTitlesComplete = result.complete;
					trophyTitlesPages = result.pagesFetched;
				} catch {
					sourceErrors.push('trophy-index');
				}

				const normalization = normalizePlayStationLibrary({ played: playedResult.titles, purchased, recentlyPlayed, trophyTitles, ownershipKnown: purchasesComplete });
				const trophyServices = normalization.trophyServices;
				const games = normalization.games;
				let trophyFailure = false;
				const achievementProvenance: Record<string, ProviderAchievementProvenance> = {};
				for (const game of games) {
					const old = findPreviousGame(game, previous);
					if (old?.identity.provider === 'playstation' && game.identity.provider === 'playstation') {
						game.identity = mergePlayStationIdentity(game.identity, old.identity);
					}
					if (!normalization.ownershipKnown) {
						game.owned = old?.owned;
						game.freshness.ownership = old?.freshness.ownership ?? false;
					}
					if (old?.achievements !== undefined) game.achievements = old.achievements;
					const commIds = game.identity.provider === 'playstation' ? game.identity.npCommunicationIds : [];
					if (commIds.length === 0) {
						game.freshness.achievements = false;
						continue;
					}
					if (cacheIsFresh(game, old, options, now)) {
						game.freshness.achievements = old?.freshness.achievements ?? false;
						if (commIds.length > 0 && old?.freshness.achievements === true) {
							const cached = options.achievementCache?.[game.providerGameId];
							if (cached !== undefined) achievementProvenance[game.providerGameId] = { source: 'cache', fetchedAt: cached.fetchedAt };
						}
						continue;
					}
					const sets = [];
					let gameTrophyFailure = false;
					for (const npCommunicationId of commIds) {
						try {
							const service = trophyServices.get(npCommunicationId) ?? choosePlayStationNpServiceName(game.platforms);
							if (service === undefined) throw new Error('PlayStation trophy service could not be inferred safely.');
							const metadata = await activeApi.getTitleTrophies(npCommunicationId, { npServiceName: service });
							const earned = await activeApi.getUserTrophiesEarnedForTitle(npCommunicationId, { npServiceName: service });
							if (!metadata.complete || !earned.complete) throw new Error('PlayStation trophy pagination is incomplete.');
							sets.push(normalizePlayStationTrophies(metadata, earned));
						} catch {
							trophyFailure = true;
							gameTrophyFailure = true;
						}
					}
					const merged = mergeAchievementSets(sets);
					if (merged !== undefined && !gameTrophyFailure) {
						game.achievements = merged;
						game.freshness.achievements = true;
						achievementProvenance[game.providerGameId] = { source: 'network', fetchedAt: now };
					} else {
						game.freshness.achievements = false;
					}
				}
				const paginationComplete = playedResult.complete && purchasesComplete && recentlyPlayedComplete && trophyTitlesComplete && !trophyFailure;
				const partial = sourceErrors.length > 0 || !paginationComplete;
				return {
					provider: 'playstation',
					status: partial ? 'partial' : 'complete',
					games,
					fetchedAt: now,
					pagination: { complete: paginationComplete, pagesFetched: playedResult.pagesFetched + purchasesPages + recentlyPlayedPages + trophyTitlesPages },
					paginationComplete,
					...(Object.keys(achievementProvenance).length === 0 ? {} : { achievementProvenance }),
					error: partial ? { code: trophyFailure ? 'playstation-trophies-partial' : 'playstation-library-partial', message: 'Some PlayStation data could not be refreshed; previous values were retained when available.' } : undefined,
				};
			} catch (error) {
				if (error instanceof ProviderAuthError) return snapshotFailure(error, [...previous], now);
				return snapshotFailure(error, [...previous], now);
			}
		},
		async disconnect(): Promise<void> {
			await auth.disconnect();
		},
	};
}
