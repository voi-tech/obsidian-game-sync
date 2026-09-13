import type { GameProvider, ProviderGame } from './provider';
import type { GameSyncData, LastSuccessfulProviderState } from '../state/schema';

export interface LibrarySummaryViewModel {
	totalGames: number;
	owned: number;
	previouslyPlayedNoLongerOwned: number;
	steamGames: number;
	playstationGames: number;
	crossPlatform: number;
	neverPlayed: number;
	steam100Percent: number;
	playstationPlatinum: number;
	lastSyncAt?: string;
}

type LibrarySummaryState = Pick<GameSyncData, 'lastSuccessfulProviderSnapshots' | 'lastSuccessfulProviderStates' | 'identityMappings'>;

interface LibraryGameGroup {
	games: ProviderGame[];
	providers: Set<GameProvider>;
}

const PROVIDERS: readonly GameProvider[] = ['steam', 'playstation'];
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function providerGameKey(provider: GameProvider, providerGameId: string): string {
	return `${provider}:${providerGameId}`;
}

function canonicalIdFor(state: LibrarySummaryState, game: ProviderGame): string {
	return state.identityMappings.find(
		(mapping) => mapping.provider === game.provider && mapping.providerGameId === game.providerGameId,
	)?.canonicalId ?? providerGameKey(game.provider, game.providerGameId);
}

function hasPlayed(game: ProviderGame): boolean {
	return (game.playtimeMinutes !== undefined && game.playtimeMinutes > 0) || Boolean(game.lastPlayed);
}

function isNeverPlayed(group: LibraryGameGroup): boolean {
	return group.games.length > 0 && group.games.every((game) => game.playtimeMinutes === 0 && game.lastPlayed === undefined);
}

function hasSteamCompletion(group: LibraryGameGroup): boolean {
	return group.games.some((game) => {
		const achievements = game.provider === 'steam' ? game.achievements : undefined;
		return achievements !== undefined
			&& Number.isFinite(achievements.total)
			&& achievements.total > 0
			&& Number.isFinite(achievements.earned)
			&& achievements.earned === achievements.total;
	});
}

function hasPlayStationPlatinum(group: LibraryGameGroup): boolean {
	return group.games.some((game) => game.provider === 'playstation'
		&& game.achievements?.achievements.some((achievement) => achievement.trophyType === 'platinum' && achievement.unlocked) === true);
}

function latestSyncAt(states: LibrarySummaryState['lastSuccessfulProviderStates']): string | undefined {
	let latest: { value: string; timestamp: number } | undefined;
	for (const state of Object.values(states)) {
		if (!isLastSuccessfulProviderState(state)) continue;
		const timestamp = Date.parse(state.fetchedAt);
		if (!ISO_TIMESTAMP.test(state.fetchedAt) || !Number.isFinite(timestamp)) continue;
		if (latest === undefined || timestamp > latest.timestamp) latest = { value: state.fetchedAt, timestamp };
	}
	return latest?.value;
}

function isLastSuccessfulProviderState(state: LastSuccessfulProviderState | undefined): state is LastSuccessfulProviderState {
	return state !== undefined && typeof state.fetchedAt === 'string';
}

export function buildLibrarySummary(state: LibrarySummaryState): LibrarySummaryViewModel {
	const groups = new Map<string, LibraryGameGroup>();
	const seenProviderGames = new Set<string>();

	for (const provider of PROVIDERS) {
		for (const game of state.lastSuccessfulProviderSnapshots[provider] ?? []) {
			const key = providerGameKey(provider, game.providerGameId);
			if (seenProviderGames.has(key)) continue;
			seenProviderGames.add(key);

			const canonicalId = canonicalIdFor(state, game);
			const group = groups.get(canonicalId) ?? { games: [], providers: new Set<GameProvider>() };
			group.games.push(game);
			group.providers.add(provider);
			groups.set(canonicalId, group);
		}
	}

	const libraryGroups = [...groups.values()];
	const ownedGroups = libraryGroups.filter((group) => group.games.some((game) => game.owned === true));

	return {
		totalGames: libraryGroups.length,
		owned: ownedGroups.length,
		previouslyPlayedNoLongerOwned: libraryGroups.filter((group) => group.games.some((game) => game.owned === false)
			&& !group.games.some((game) => game.owned === true)
			&& group.games.some(hasPlayed)).length,
		steamGames: libraryGroups.filter((group) => group.providers.has('steam')).length,
		playstationGames: libraryGroups.filter((group) => group.providers.has('playstation')).length,
		crossPlatform: libraryGroups.filter((group) => group.providers.size === PROVIDERS.length).length,
		neverPlayed: libraryGroups.filter(isNeverPlayed).length,
		steam100Percent: libraryGroups.filter(hasSteamCompletion).length,
		playstationPlatinum: libraryGroups.filter(hasPlayStationPlatinum).length,
		lastSyncAt: latestSyncAt(state.lastSuccessfulProviderStates),
	};
}
