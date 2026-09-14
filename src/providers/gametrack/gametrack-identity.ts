import type { GameIdentity } from '../../model/canonical-game';

export interface GameTrackLegacyIds {
	readonly steam?: string;
	readonly playstation?: string;
	readonly xbox?: string;
}

export function createGameTrackIdentity(gameTrackId: string, igdbId?: number, legacyIds: GameTrackLegacyIds = {}): GameIdentity {
	const normalized = gameTrackId.trim().toLocaleLowerCase('en-US');
	if (normalized.length === 0) throw new Error('GameTrack identity must not be empty.');
	if (igdbId !== undefined && (!Number.isInteger(igdbId) || igdbId < 1)) throw new Error('IGDB identity must be a positive integer.');
	return {
		canonicalKey: `gametrack:${normalized}`,
		externalIds: {
			gametrack: normalized,
			...(igdbId === undefined ? {} : { igdb: igdbId }),
			...(legacyIds.steam === undefined ? {} : { steam: legacyIds.steam }),
			...(legacyIds.playstation === undefined ? {} : { playstation: legacyIds.playstation }),
			...(legacyIds.xbox === undefined ? {} : { xbox: legacyIds.xbox }),
		},
	};
}
