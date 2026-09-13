import type { NormalizedGame } from '../model/game';
import type { GameProvider } from '../model/provider';
import type { IdentityMapping } from '../model/identity';
import { normalizeTitle } from '../identity/normalize-title';
import { isSafeForAutomaticMerge, type MatchConfidence } from '../identity/confidence';
import { resolvePropertyMapping, type PropertyMapping } from '../model/property-mapping';
import type { IndexedNote, NoteIndex } from './note-index';

export type MatchMethod =
	| 'game-sync-id'
	| 'provider-id'
	| 'durable-mapping'
	| 'exact-title'
	| 'exact-filename'
	| 'title-year'
	| 'normalized-title-year'
	| 'ambiguous';

export type VaultMatchStatus = 'matched' | 'review' | 'conflict' | 'none';

export interface VaultMatch {
	status: VaultMatchStatus;
	method?: MatchMethod;
	confidence: MatchConfidence;
	note?: IndexedNote;
	candidates: IndexedNote[];
	reason?: string;
}

export interface VaultMatcherOptions {
	targetPath?: string;
	mappings?: readonly IdentityMapping[];
	propertyMapping?: PropertyMapping;
}

function values(properties: Record<string, unknown>, names: readonly string[]): string[] {
	return names.flatMap((name) => {
		const value = properties[name];
		if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
		return typeof value === 'string' || typeof value === 'number' ? [String(value)] : [];
	});
}

function uniqueNotes(notes: readonly IndexedNote[]): IndexedNote[] {
	return [...new Map(notes.map((note) => [note.path, note])).values()].sort((left, right) => left.path.localeCompare(right.path));
}

function gameYear(game: NormalizedGame): string | undefined {
	const year = game.releaseDate?.slice(0, 4);
	return year !== undefined && /^\d{4}$/u.test(year) ? year : undefined;
}

function noteYear(note: IndexedNote): string | undefined {
	const released = note.properties.released;
	if (typeof released === 'string' && /^\d{4}/u.test(released)) return released.slice(0, 4);
	if (typeof released === 'number' && Number.isInteger(released)) return String(released);
	return undefined;
}

function gameProviderIds(game: NormalizedGame): Array<{ provider: GameProvider; id: string }> {
	const result: Array<{ provider: GameProvider; id: string }> = [];
	for (const provider of ['steam', 'playstation'] as const) {
		const providerGame = game.providers[provider];
		if (providerGame?.providerGameId !== undefined) result.push({ provider, id: providerGame.providerGameId });
		if (provider === 'playstation' && game.identity.playstation !== undefined) {
			const identity = game.identity.playstation;
			for (const id of [identity.conceptId, ...identity.titleIds, ...identity.npCommunicationIds]) {
				if (id !== undefined) result.push({ provider, id });
			}
		}
	}
	return [...new Map(result.map((value) => [`${value.provider}:${value.id}`, value])).values()];
}

function providerCandidates(index: NoteIndex, game: NormalizedGame): IndexedNote[] {
	return uniqueNotes(gameProviderIds(game).flatMap(({ provider, id }) => provider === 'steam' ? index.findBySteamId(id) : index.findByPlayStationIdentifier(id)));
}

function titleCandidates(index: NoteIndex, game: NormalizedGame): IndexedNote[] {
	const wanted = normalizeTitle(game.title);
	return uniqueNotes(index.notes.filter((note) => {
		const titles = [note.title, ...values(note.properties, ['aliases', 'alias'])].filter((value): value is string => value !== undefined);
		return titles.some((title) => normalizeTitle(title) === wanted);
	}));
}

function filenameStem(path: string): string {
	return path.split('/').at(-1)?.replace(/\.md$/iu, '') ?? path;
}

function matchByPriority(notes: readonly IndexedNote[], method: MatchMethod, confidence: MatchConfidence, reason?: string): VaultMatch {
	const candidates = uniqueNotes(notes);
	if (candidates.length > 1) return { status: 'conflict', method: 'ambiguous', confidence: 'ambiguous', candidates, reason: reason ?? `Multiple notes matched ${method}.` };
	if (candidates.length === 0) return { status: 'none', confidence: 'none', candidates: [] };
	return {
		status: isSafeForAutomaticMerge(confidence) ? 'matched' : 'review',
		method,
		confidence,
		note: candidates[0],
		candidates,
		reason,
	};
}

export function matchVaultNote(game: NormalizedGame, index: NoteIndex, options: VaultMatcherOptions = {}): VaultMatch {
	const gameSyncIdKey = resolvePropertyMapping(options.propertyMapping).gameSyncId;
	const byProvider = providerCandidates(index, game);
	const conflictingProviderCandidates = gameSyncIdKey === undefined ? [] : byProvider.filter((note) => {
		const ids = values(note.properties, [gameSyncIdKey]);
		return ids.some((id) => id !== game.canonicalId);
	});
	if (conflictingProviderCandidates.length > 0) {
		return {
			status: 'conflict',
			method: 'ambiguous',
			confidence: 'ambiguous',
			candidates: uniqueNotes(conflictingProviderCandidates),
			reason: 'A provider identifier points to a note with a different game-sync-id.',
		};
	}
	const byCanonical = index.findByGameSyncId(game.canonicalId);
	if (byCanonical.length > 0) return matchByPriority(byCanonical, 'game-sync-id', 'explicit');

	if (byProvider.length > 0) return matchByPriority(byProvider, 'provider-id', 'explicit');

	const durable = (options.mappings ?? [])
		.filter((mapping) => mapping.canonicalId === game.canonicalId)
		.flatMap((mapping) => mapping.provider === 'steam' ? index.findBySteamId(mapping.providerGameId) : index.findByPlayStationIdentifier(mapping.providerGameId));
	const conflictingDurableCandidates = gameSyncIdKey === undefined ? [] : durable.filter((note) => {
		const ids = values(note.properties, [gameSyncIdKey]);
		return ids.some((id) => id !== game.canonicalId);
	});
	if (conflictingDurableCandidates.length > 0) {
		return {
			status: 'conflict',
			method: 'ambiguous',
			confidence: 'ambiguous',
			candidates: uniqueNotes(conflictingDurableCandidates),
			reason: 'A durable provider mapping points to a note with a different game-sync-id.',
		};
	}
	if (durable.length > 0) return matchByPriority(durable, 'durable-mapping', 'explicit');

	const byTitle = titleCandidates(index, game);
	if (byTitle.length > 0) return matchByPriority(byTitle, 'exact-title', 'likely');

	if (options.targetPath !== undefined) {
		const byFilename = index.notes.filter((note) => note.path === options.targetPath);
		if (byFilename.length > 0) return matchByPriority(byFilename, 'exact-filename', 'likely');
	}

	const year = gameYear(game);
	if (year !== undefined) {
		const expectedFilename = `${normalizeTitle(game.title)} (${year})`;
		const titleYear = index.notes.filter((note) => normalizeTitle(filenameStem(note.path)) === expectedFilename);
		if (titleYear.length > 0) return matchByPriority(titleYear, 'title-year', 'likely');
		const normalizedTitleYear = index.notes.filter((note) => note.title !== undefined && normalizeTitle(note.title) === normalizeTitle(game.title) && noteYear(note) === year);
		if (normalizedTitleYear.length > 0) return matchByPriority(normalizedTitleYear, 'normalized-title-year', 'likely');
	}

	return { status: 'none', confidence: 'none', candidates: [] };
}

export const findVaultMatch = matchVaultNote;
