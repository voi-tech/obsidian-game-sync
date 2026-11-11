import type { NormalizedGame } from '../model/game';
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
