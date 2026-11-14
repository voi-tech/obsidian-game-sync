import type { NormalizedGame } from '../model/game';
import type { CanonicalGame } from '../model/canonical-game';
import type { GameProvider } from '../model/provider';
import type { IdentityMapping } from '../model/identity';
import { normalizeTitle, titleMatchKey } from '../identity/normalize-title';
import { isSafeForAutomaticMerge, type MatchConfidence } from '../identity/confidence';
import type { PropertyMapping } from '../model/property-mapping';
import { propertyStrings, type IndexedNote, type NoteIndex } from './note-index';
import { readProperty } from './frontmatter';
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
	return propertyStrings(properties, names);
}

function uniqueNotes(notes: readonly IndexedNote[]): IndexedNote[] {
	return [...new Map(notes.map((note) => [note.path, note])).values()].sort((left, right) => left.path.localeCompare(right.path));
}

function gameYear(game: NormalizedGame): string | undefined {
	const year = game.releaseDate?.slice(0, 4);
	return year !== undefined && /^\d{4}$/u.test(year) ? year : undefined;
}

function noteYear(note: IndexedNote): string | undefined {
	const released = readProperty(note.properties, 'released');
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

interface StableIdentitySource {
	readonly method: MatchMethod;
	readonly notes: readonly IndexedNote[];
	/** Reason used when this source points at a note that belongs to another game. */
	readonly foreignReason?: string;
}

interface StableIdentityOptions {
	readonly isNegative: (note: IndexedNote) => boolean;
	/** True when the note's own game-sync-id says it belongs to a different game. */
	readonly ownedByOtherGame: (note: IndexedNote) => boolean;
}

/**
 * Shared by the legacy and the canonical pipeline. Collects every note any stable identifier of the game
 * points to (game-sync-id, IGDB, GameTrack, provider IDs, durable mappings, remembered note links) before
 * choosing. One note: a safe match. Several notes, or a note owned by another game: review, never the first hit;
 * otherwise the writer would add this game's IDs to one note while another note still carries them.
 * Returns undefined when no stable identifier matched, so heuristics may run.
 */
function resolveStableIdentity(sources: readonly StableIdentitySource[], options: StableIdentityOptions): VaultMatch | undefined {
	const found = new Map<string, { note: IndexedNote; source: StableIdentitySource }>();
	for (const source of sources) {
		for (const note of source.notes) {
			if (options.isNegative(note) || found.has(note.path)) continue;
			found.set(note.path, { note, source });
		}
	}
	if (found.size === 0) return undefined;
	// Every found note, including one found by its game-sync-id: a note carrying this game's ID and another
	// game's ID at the same time is a contradiction too.
	const foreign = [...found.values()].filter(({ note }) => options.ownedByOtherGame(note));
	if (foreign.length > 0) {
		return {
			status: 'conflict',
			method: 'ambiguous',
			confidence: 'ambiguous',
			candidates: uniqueNotes(foreign.map(({ note }) => note)),
			reason: foreign[0].source.foreignReason ?? 'A stable identifier points to a note with a different game-sync-id.',
		};
	}
	const candidates = uniqueNotes([...found.values()].map(({ note }) => note));
	if (candidates.length > 1) {
		return { status: 'conflict', method: 'ambiguous', confidence: 'ambiguous', candidates, reason: 'Stable identifiers of this game point to different notes.' };
	}
	const [{ note, source }] = [...found.values()] as [{ note: IndexedNote; source: StableIdentitySource }];
	return { status: 'matched', method: source.method, confidence: 'explicit', note, candidates: [note] };
}

/**
 * Hand-named notes in the games folder: the file name without a trailing year, compared with punctuation
 * collapsed ("Detroit - Become Human (2018)" for "Detroit: Become Human™", or a bare "Returnal"). Exact key
 * equality only, so sequels never match by prefix. A year in the file name or a `released` property that
 * contradicts the game's year rules the note out. These are review candidates, never an automatic merge.
 */
function looseFilenameCandidates(notes: readonly IndexedNote[], titles: readonly string[], year: string | undefined): IndexedNote[] {
	return filenameTitleCandidates(notes, titles).filter((note) => yearAgrees(note, year));
}

/** False when the file name year or the `released` property names another year than the game's. */
function yearAgrees(note: IndexedNote, year: string | undefined): boolean {
	if (year === undefined) return true;
	const named = filenameYear(note.path);
	const released = noteYear(note);
	return (named === undefined || named === year) && (released === undefined || released === year);
}

function sameNamespace(left: string, right: string): boolean {
	const prefix = (value: string): string | undefined => /^([a-z0-9-]+):/iu.exec(value)?.[1]?.toLocaleLowerCase();
	const leftPrefix = prefix(left);
	return leftPrefix !== undefined && leftPrefix === prefix(right);
}

export function matchVaultNote(game: NormalizedGame, index: NoteIndex, options: VaultMatcherOptions = {}): VaultMatch {
	const negativeMappings = options.negativeMappings ?? [];
	const otherIds = (note: IndexedNote): string[] => index.gameSyncIdsOf(note).filter((id) => id !== game.canonicalId);
	// "Keep separate" is recorded against the note's game-sync-id or, for notes decided by path, against the path.
	const isNegative = (note: IndexedNote): boolean => {
		const noteIds = new Set([...index.gameSyncIdsOf(note).filter((id) => id !== game.canonicalId), noteRefId(note.path)]);
		return negativeMappings.some((mapping) =>
			(mapping.leftCanonicalId === game.canonicalId && noteIds.has(mapping.rightCanonicalId))
			|| (mapping.rightCanonicalId === game.canonicalId && noteIds.has(mapping.leftCanonicalId)),
		);
	};
	const filterNegative = (notes: readonly IndexedNote[]): IndexedNote[] => uniqueNotes(notes.filter((note) => !isNegative(note)));
	const durable = (options.mappings ?? [])
		.filter((mapping) => mapping.canonicalId === game.canonicalId)
		.flatMap((mapping) => mapping.provider === 'steam' ? index.findBySteamId(mapping.providerGameId) : index.findByPlayStationIdentifier(mapping.providerGameId));
	const linkedPaths = new Set((options.noteLinks ?? []).filter((link) => link.canonicalId === game.canonicalId).map((link) => link.path));
	// A linked note that meanwhile carries another game's ID is not ours any more.
	const linked = index.notes.filter((note) => linkedPaths.has(note.path) && otherIds(note).length === 0);
	const stable = resolveStableIdentity([
		{ method: 'game-sync-id', notes: index.findByGameSyncId(game.canonicalId) },
		{ method: 'provider-id', notes: providerCandidates(index, game), foreignReason: 'A provider identifier points to a note with a different game-sync-id.' },
		{ method: 'durable-mapping', notes: durable, foreignReason: 'A durable provider mapping points to a note with a different game-sync-id.' },
		{ method: 'note-link', notes: linked },
	], { isNegative, ownedByOtherGame: (note) => otherIds(note).length > 0 });
	if (stable !== undefined) return stable;

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

	// No year filter here: Steam and PlayStation report the release date of the port, which often differs
	// from the year in a hand-written file name; the legacy review lets the user keep the two apart.
	const byLooseTitle = filterNegative(looseFilenameCandidates(index.notes.filter(heuristic), [game.title], undefined));
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
	/** Same as {@link VaultMatcherOptions.noteLinks}: notes this game was written to before. */
	noteLinks?: readonly NoteLink[];
	/** Where a new note for this game would go before collision handling; an existing note there is offered for review. */
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
	const canonicalKey = game.identity.canonicalKey;
	// Another key of the same library (`gametrack:other`) marks another game's note. A key from elsewhere
	// (an older `game-sync:` ID, a custom one) is a note being adopted and is kept by the planner.
	const ownedByOtherGame = (note: IndexedNote): boolean => index.gameSyncIdsOf(note).some((id) => id !== canonicalKey && sameNamespace(id, canonicalKey));
	const external = game.identity.externalIds;
	const linkedPaths = new Set((options.noteLinks ?? []).filter((link) => link.canonicalId === canonicalKey).map((link) => link.path));
	const stable = resolveStableIdentity([
		{ method: 'game-sync-id', notes: index.findByGameSyncId(canonicalKey) },
		{ method: 'igdb-id', notes: external.igdb === undefined ? [] : index.findByIgdbId(external.igdb) },
		{ method: 'gametrack-id', notes: external.gametrack === undefined ? [] : index.findByGameTrackId(external.gametrack) },
		{ method: 'provider-id', notes: canonicalIds(game).flatMap(({ kind, id }) => kind === 'steam' ? index.findBySteamId(id) : kind === 'playstation' ? index.findByPlayStationIdentifier(id) : []) },
		{ method: 'note-link', notes: index.notes.filter((note) => linkedPaths.has(note.path) && !ownedByOtherGame(note)) },
	], { isNegative: () => false, ownedByOtherGame });
	if (stable !== undefined) return stable;

	const titleCandidates = canonicalTitleCandidates(index, game).filter(inFolder(options.candidateFolder));
	const year = canonicalYear(game);
	const sameYear = year === undefined ? titleCandidates : titleCandidates.filter((note) => noteYear(note) === year);
	if (sameYear.length > 0) return matchByPriority(sameYear, year === undefined ? 'exact-title' : 'title-year', 'likely', 'Title fallback requires review.');
	if (titleCandidates.length > 0) {
		const candidatesWithKnownYear = titleCandidates.filter((note) => noteYear(note) !== undefined);
		if (year === undefined || candidatesWithKnownYear.length === 0) return matchByPriority(titleCandidates, 'exact-title', 'likely', 'Title fallback has no matching release year and requires review.');
	}

	const folderNotes = index.notes.filter(inFolder(options.candidateFolder));
	if (options.targetPath !== undefined) {
		// The vault's file names ignore case on macOS and Windows, so `returnal.md` occupies `Returnal.md`.
		const wanted = options.targetPath.toLocaleLowerCase();
		const target = folderNotes.filter((note) => note.path.toLocaleLowerCase() === wanted && yearAgrees(note, year));
		if (target.length > 0) return matchByPriority(target, 'exact-filename', 'likely', 'A note already exists at the target path and requires review.');
	}
	const loose = looseFilenameCandidates(folderNotes, [game.title, ...(game.aliases ?? [])], year);
	if (loose.length > 0) return matchByPriority(loose, 'filename-title', 'likely', 'The note name matches the game title without its year or punctuation.');
	return { status: 'none', confidence: 'none', candidates: [] };
}
