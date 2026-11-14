import type { CanonicalGame } from '../model/canonical-game';
import type { NormalizedGame } from '../model/game';
import type { GameSyncData } from '../state/schema';
import type { GameSyncSettings } from '../model/settings';

export type LibraryFilterSettings = Pick<GameSyncSettings, 'includeUnplayed' | 'includeFreeToPlay' | 'includePreviouslyPlayedNoLongerOwned'>;

/**
 * Whether an account game may get a new note. Filters only decide about creating notes: a game that already
 * has a note keeps syncing, so turning a filter on never strands or deletes anything.
 */
export function allowsNewNote(game: NormalizedGame, filters: LibraryFilterSettings): boolean {
	const providers = Object.values(game.providers).filter((provider) => provider !== undefined);
	const unplayed = game.playtimeMinutes === 0 && game.lastPlayed === undefined
		&& providers.every((provider) => (provider.playtimeMinutes ?? 0) === 0 && provider.lastPlayed === undefined);
	if (!filters.includeUnplayed && unplayed) return false;
	if (!filters.includeFreeToPlay && game.acquisitionType === 'free') return false;
	// Unknown ownership (undefined) is not "no longer owned"; only an explicit false from every provider counts.
	const noLongerOwned = providers.length > 0 && providers.every((provider) => provider.owned === false);
	if (!filters.includePreviouslyPlayedNoLongerOwned && noLongerOwned) return false;
	return true;
}

/**
 * The same rule for a library-provider game (GameTrack). Unknown playtime is not "unplayed". GameTrack does not
 * say how a game was acquired, so the free-to-play filter cannot apply to it.
 */
export function allowsNewCanonicalNote(game: CanonicalGame, filters: LibraryFilterSettings): boolean {
	const minutes = [game.playtime.canonical?.minutes, ...game.playtime.observations.map((observation) => observation.minutes)].filter((value) => value !== undefined);
	const played = minutes.some((value) => value > 0) || game.lastPlayed !== undefined || game.activity?.lastPlayed !== undefined;
	const unplayed = minutes.length > 0 && !played;
	if (!filters.includeUnplayed && unplayed) return false;
	const noLongerOwned = game.platforms.length > 0 && game.platforms.every((platform) => platform.owned === false);
	if (!filters.includePreviouslyPlayedNoLongerOwned && noLongerOwned) return false;
	return true;
}

/** Whether the user ignored this game, by its own key or by one of its Steam/PlayStation IDs. */
export function isIgnoredCanonicalGame(game: CanonicalGame, ignoredCanonicalIds: readonly string[] = [], ignoredProviderRefs: readonly string[] = []): boolean {
	if (ignoredCanonicalIds.includes(game.identity.canonicalKey)) return true;
	const { steam, playstation } = game.identity.externalIds;
	return (steam !== undefined && ignoredProviderRefs.includes(`steam:${steam}`))
		|| (playstation !== undefined && ignoredProviderRefs.includes(`playstation:${playstation}`));
}

/**
 * Ignore decisions made in Steam/PlayStation sync store random `game-sync:` IDs. GameTrack games have their own
 * keys, so those decisions reach them as the provider IDs known for the ignored game (identity index, mappings).
 */
export function ignoredProviderRefsFor(state: Pick<GameSyncData, 'ignoredCanonicalIds' | 'ignoredProviderRefs' | 'identityIndex' | 'identityMappings'>): string[] {
	const ignored = new Set(state.ignoredCanonicalIds);
	const refs = new Set(state.ignoredProviderRefs);
	for (const identity of state.identityIndex) {
		if (!ignored.has(identity.canonicalId)) continue;
		if (identity.steamAppId !== undefined) refs.add(`steam:${identity.steamAppId}`);
		const psn = identity.playstation;
		if (psn !== undefined) for (const id of [psn.conceptId, ...psn.titleIds, ...psn.npCommunicationIds]) if (id !== undefined) refs.add(`playstation:${id}`);
	}
	for (const mapping of state.identityMappings) if (ignored.has(mapping.canonicalId)) refs.add(`${mapping.provider}:${mapping.providerGameId}`);
	return [...refs];
}
