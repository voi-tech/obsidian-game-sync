import type { NormalizedGame } from '../model/game';
import type { CanonicalGame } from '../model/canonical-game';
import type { GameProvider } from '../model/provider';
import type { IdentityMapping } from '../model/identity';
import { normalizeTitle, titleMatchKey } from '../identity/normalize-title';
import { isSafeForAutomaticMerge, type MatchConfidence } from '../identity/confidence';
import { resolvePropertyMapping, type PropertyMapping } from '../model/property-mapping';
import type { IndexedNote, NoteIndex } from './note-index';
import type { NegativeIdentityMapping, NoteLink } from '../state/schema';

export type MatchMethod =
	| 'game-sync-id'
	| 'igdb-id'
	| 'gametrack-id'
	| 'provider-id'
	| 'durable-mapping'
	| 'note-link'
	| 'exact-title'
	| 'exact-filename'
	| 'title-year'
	| 'normalized-title-year'
	| 'filename-title'
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
	negativeMappings?: readonly NegativeIdentityMapping[];
	/** Notes this game was written to or merged with before; trusted like a stable ID while the note exists. */
	noteLinks?: readonly NoteLink[];
	propertyMapping?: PropertyMapping;
	/**
	 * Limits title/filename guesses to this folder. Stable IDs still match anywhere, but a film or book
	 * note elsewhere in the vault must never be offered as "the same game" just because titles match.
	 */
	candidateFolder?: string;
}

/**
 * Stand-in identity of a note without a game-sync-id, used to record "this game is not that note" decisions.
 * The decision follows the path; renaming the note offers it again, which errs on the side of asking.
 */
export function noteRefId(path: string): string {
	return `note:${path}`;
}

function inFolder(folder: string | undefined): (note: IndexedNote) => boolean {
	if (folder === undefined) return () => true;
	const prefix = `${folder.replace(/^\/+|\/+$/gu, '')}/`;
	return (note) => prefix === '/' || note.path.startsWith(prefix);
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

/**
 * Notes named by hand often carry the year and replace characters that file names cannot hold
 * ("Detroit - Become Human (2018)" for "Detroit: Become Human™"). Compared loosely, these are only
 * candidates for review, never an automatic merge.
 */
function filenameYear(path: string): string | undefined {
	return /\((\d{4})\)\s*$/u.exec(filenameStem(path))?.[1];
}

function filenameTitleCandidates(notes: readonly IndexedNote[], titles: readonly string[]): IndexedNote[] {
	const wanted = new Set(titles.map(titleMatchKey).filter((key) => key.length > 0));
	if (wanted.size === 0) return [];
	return uniqueNotes(notes.filter((note) => {
		const stem = filenameStem(note.path).replace(/\s*\(\d{4}\)\s*$/u, '');
		const names = [stem, note.title, ...values(note.properties, ['aliases', 'alias'])].filter((value): value is string => value !== undefined);
		return names.some((name) => wanted.has(titleMatchKey(name)));
	}));
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
	const negativeMappings = options.negativeMappings ?? [];
	const isNegative = (note: IndexedNote): boolean => {
		const noteCanonicalId = values(note.properties, gameSyncIdKey === undefined ? [] : [gameSyncIdKey])[0] ?? noteRefId(note.path);
		return negativeMappings.some((mapping) =>
			(mapping.leftCanonicalId === game.canonicalId && mapping.rightCanonicalId === noteCanonicalId)
			|| (mapping.rightCanonicalId === game.canonicalId && mapping.leftCanonicalId === noteCanonicalId),
		);
	};
	const filterNegative = (notes: readonly IndexedNote[]): IndexedNote[] => uniqueNotes(notes.filter((note) => !isNegative(note)));
	const byProvider = filterNegative(providerCandidates(index, game));
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
	const byCanonical = filterNegative(index.findByGameSyncId(game.canonicalId));
	if (byCanonical.length > 0) return matchByPriority(byCanonical, 'game-sync-id', 'explicit');

	if (byProvider.length > 0) return matchByPriority(byProvider, 'provider-id', 'explicit');

	const durable = filterNegative((options.mappings ?? [])
		.filter((mapping) => mapping.canonicalId === game.canonicalId)
		.flatMap((mapping) => mapping.provider === 'steam' ? index.findBySteamId(mapping.providerGameId) : index.findByPlayStationIdentifier(mapping.providerGameId)));
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

	const linkedPaths = new Set((options.noteLinks ?? []).filter((link) => link.canonicalId === game.canonicalId).map((link) => link.path));
	const linked = filterNegative(index.notes.filter((note) => linkedPaths.has(note.path)
		// A note that meanwhile carries another game's ID is not ours any more.
		&& (gameSyncIdKey === undefined || values(note.properties, [gameSyncIdKey]).every((id) => id === game.canonicalId))));
	if (linked.length > 0) return matchByPriority(linked, 'note-link', 'explicit');

	const heuristic = inFolder(options.candidateFolder);
	const byTitle = filterNegative(titleCandidates(index, game).filter(heuristic));
	if (byTitle.length > 0) return matchByPriority(byTitle, 'exact-title', 'likely');

	if (options.targetPath !== undefined) {
		const byFilename = filterNegative(index.notes.filter((note) => note.path === options.targetPath));
		if (byFilename.length > 0) return matchByPriority(byFilename, 'exact-filename', 'likely');
	}

	const year = gameYear(game);
	if (year !== undefined) {
		const expectedFilename = `${normalizeTitle(game.title)} (${year})`;
		const titleYear = filterNegative(index.notes.filter((note) => heuristic(note) && normalizeTitle(filenameStem(note.path)) === expectedFilename));
		if (titleYear.length > 0) return matchByPriority(titleYear, 'title-year', 'likely');
		const normalizedTitleYear = filterNegative(index.notes.filter((note) => heuristic(note) && note.title !== undefined && normalizeTitle(note.title) === normalizeTitle(game.title) && noteYear(note) === year));
		if (normalizedTitleYear.length > 0) return matchByPriority(normalizedTitleYear, 'normalized-title-year', 'likely');
	}

	const byLooseTitle = filterNegative(filenameTitleCandidates(index.notes.filter(heuristic), [game.title]));
	if (byLooseTitle.length > 0) return matchByPriority(byLooseTitle, 'filename-title', 'likely', 'The note name matches the game title without its year or punctuation.');

	return { status: 'none', confidence: 'none', candidates: [] };
}

export const findVaultMatch = matchVaultNote;

export interface CanonicalIdentityMapping {
	canonicalKey: string;
	notePath: string;
}

export interface CanonicalVaultMatcherOptions {
	canonicalMappings?: readonly CanonicalIdentityMapping[];
	targetPath?: string;
	/** Same as {@link VaultMatcherOptions.candidateFolder}. */
	candidateFolder?: string;
}

function canonicalYear(game: CanonicalGame): string | undefined {
	const year = game.metadata.releaseDate?.slice(0, 4);
	return year !== undefined && /^\d{4}$/u.test(year) ? year : undefined;
}

function canonicalTitleCandidates(index: NoteIndex, game: CanonicalGame): IndexedNote[] {
	const wanted = normalizeTitle(game.title);
	const aliases = (game.aliases ?? []).map(normalizeTitle);
	return uniqueNotes(index.notes.filter((note) => [note.title, ...values(note.properties, ['aliases', 'alias'])]
		.some((title) => typeof title === 'string' && (normalizeTitle(title) === wanted || aliases.includes(normalizeTitle(title))))));
}

function canonicalIds(game: CanonicalGame): Array<{ kind: 'steam' | 'playstation' | 'xbox'; id: string }> {
	const external = game.identity.externalIds;
	return [
		...(external.steam === undefined ? [] : [{ kind: 'steam' as const, id: external.steam }]),
		...(external.playstation === undefined ? [] : [{ kind: 'playstation' as const, id: external.playstation }]),
		...(external.xbox === undefined ? [] : [{ kind: 'xbox' as const, id: external.xbox }]),
	];
}

/** Matches a provider-neutral game without consulting provider-specific models. */
export function matchCanonicalVaultNote(game: CanonicalGame, index: NoteIndex, options: CanonicalVaultMatcherOptions = {}): VaultMatch {
	const mapped = options.canonicalMappings?.filter((mapping) => mapping.canonicalKey === game.identity.canonicalKey)
		.flatMap((mapping) => index.notes.filter((note) => note.path === mapping.notePath)) ?? [];
	if (mapped.length > 0) return matchByPriority(mapped, 'game-sync-id', 'explicit', 'An explicit canonical mapping selected this note.');
	const byCanonical = index.findByGameSyncId(game.identity.canonicalKey);
	if (byCanonical.length > 0) return matchByPriority(byCanonical, 'game-sync-id', 'explicit');

	const byIgdb = game.identity.externalIds.igdb === undefined ? [] : index.findByIgdbId(game.identity.externalIds.igdb);
	const byGameTrack = game.identity.externalIds.gametrack === undefined ? [] : index.findByGameTrackId(game.identity.externalIds.gametrack);
	const legacy = uniqueNotes(canonicalIds(game).flatMap(({ kind, id }) => kind === 'steam'
		? index.findBySteamId(id)
		: kind === 'playstation' ? index.findByPlayStationIdentifier(id) : []));
	// Identifiers of one game that point at different notes are contradictory; merging into the first hit
	// would silently attach the game to the wrong note, so the whole set goes to review instead.
	const identified = uniqueNotes([...byIgdb, ...byGameTrack, ...legacy]);
	if (identified.length > 1) return matchByPriority(identified, 'igdb-id', 'explicit', 'Stable identifiers of this game point to different notes.');
	if (byIgdb.length > 0) return matchByPriority(byIgdb, 'igdb-id', 'explicit');
	if (byGameTrack.length > 0) return matchByPriority(byGameTrack, 'gametrack-id', 'explicit');
	if (legacy.length > 0) return matchByPriority(legacy, 'provider-id', 'explicit');

	const titleCandidates = canonicalTitleCandidates(index, game).filter(inFolder(options.candidateFolder));
	const year = canonicalYear(game);
	const sameYear = year === undefined ? titleCandidates : titleCandidates.filter((note) => noteYear(note) === year);
	if (sameYear.length > 0) return matchByPriority(sameYear, year === undefined ? 'exact-title' : 'title-year', 'likely', 'Title fallback requires review.');
	if (titleCandidates.length > 0) {
		const candidatesWithKnownYear = titleCandidates.filter((note) => noteYear(note) !== undefined);
		if (year === undefined || candidatesWithKnownYear.length === 0) return matchByPriority(titleCandidates, 'exact-title', 'likely', 'Title fallback has no matching release year and requires review.');
	}

	if (options.targetPath !== undefined) {
		const target = index.notes.filter((note) => note.path === options.targetPath);
		if (target.length > 0) return matchByPriority(target, 'exact-filename', 'likely', 'Target path fallback requires review.');
	}
	const loose = filenameTitleCandidates(index.notes.filter(inFolder(options.candidateFolder)), [game.title, ...(game.aliases ?? [])])
		// Only names carrying a year: a bare file at the target path is handled above and may be unrelated.
		.filter((note) => filenameYear(note.path) !== undefined && (year === undefined || (filenameYear(note.path) === year && (noteYear(note) ?? year) === year)));
	if (loose.length > 0) return matchByPriority(loose, 'filename-title', 'likely', 'The note name matches the game title without its year or punctuation.');
	return { status: 'none', confidence: 'none', candidates: [] };
}
