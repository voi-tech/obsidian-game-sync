import type { CanonicalGame } from '../model/canonical-game';
import { normalizeTitle } from '../identity/normalize-title';

export interface NotePathAllocationContext {
	readonly notesFolder?: string;
	readonly existingPaths: readonly string[];
	readonly reservedPaths?: ReadonlySet<string>;
}

export interface NotePathAllocationResult {
	readonly path: string;
	readonly reason?: 'base' | 'release-year' | 'stable-id' | 'occupied-base';
}

function safeFilename(title: string): string {
	return title.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '') || 'game';
}

function releaseYear(game: CanonicalGame): string | undefined {
	const year = game.metadata.releaseDate?.slice(0, 4);
	return year !== undefined && /^\d{4}$/u.test(year) ? year : undefined;
}

function pathKey(path: string): string {
	return path.normalize('NFKC').toLocaleLowerCase('en-US');
}

function sanitizeIdentity(value: string): string {
	const token = value.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
	return token || 'canonical-game';
}

function identityToken(game: CanonicalGame): string {
	const external = game.identity.externalIds;
	const identity = external.igdb === undefined
		? external.gametrack === undefined ? `canonical-${game.identity.canonicalKey}` : `gametrack-${external.gametrack}`
		: `igdb-${external.igdb}`;
	return sanitizeIdentity(identity);
}

function folderPath(folder: string | undefined): string {
	return (folder ?? 'Games').replace(/\/+$/u, '');
}

function joinPath(folder: string, filename: string): string {
	return folder.length > 0 ? `${folder}/${filename}` : filename;
}

function candidateWithSuffix(folder: string, stem: string, suffix: string): string {
	return joinPath(folder, `${stem} [${suffix}].md`);
}

function compareGames(left: CanonicalGame, right: CanonicalGame): number {
	return normalizeTitle(left.title).localeCompare(normalizeTitle(right.title), 'en-US')
		|| (releaseYear(left) ?? '').localeCompare(releaseYear(right) ?? '', 'en-US')
		|| (left.identity.externalIds.igdb?.toString() ?? '').localeCompare(right.identity.externalIds.igdb?.toString() ?? '', 'en-US')
		|| left.identity.canonicalKey.localeCompare(right.identity.canonicalKey, 'en-US');
}

export class NotePathAllocator {
	allocate(game: CanonicalGame, context: NotePathAllocationContext): NotePathAllocationResult {
		const folder = folderPath(context.notesFolder);
		const stem = safeFilename(game.title);
		const base = joinPath(folder, `${stem}.md`);
		const occupied = new Set([...context.existingPaths, ...(context.reservedPaths ?? [])].map(pathKey));
		if (!occupied.has(pathKey(base))) return { path: base, reason: 'base' };
		const year = releaseYear(game);
		if (game.identity.externalIds.igdb !== undefined && year !== undefined) {
			const yearPath = joinPath(folder, `${stem} (${year}).md`);
			if (!occupied.has(pathKey(yearPath))) return { path: yearPath, reason: 'occupied-base' };
		}
		return { path: candidateWithSuffix(folder, game.identity.externalIds.igdb === undefined || year === undefined ? stem : `${stem} (${year})`, identityToken(game)), reason: 'stable-id' };
	}

	allocateBatch(games: readonly CanonicalGame[], context: NotePathAllocationContext): Map<string, string> {
		const folder = folderPath(context.notesFolder);
		const occupied = new Set([...context.existingPaths, ...(context.reservedPaths ?? [])].map(pathKey));
		const groups = new Map<string, CanonicalGame[]>();
		for (const game of games) {
			const key = normalizeTitle(game.title);
			const group = groups.get(key) ?? [];
			group.push(game);
			groups.set(key, group);
		}
		const assignments = new Map<string, string>();
		for (const group of [...groups.values()].sort((left, right) => compareGames(left[0], right[0]))) {
			const ordered = [...group].sort(compareGames);
			const years = ordered.map(releaseYear);
			const duplicate = ordered.length > 1;
			for (const game of ordered) {
				const stem = safeFilename(game.title);
				const year = releaseYear(game);
				const yearCount = year === undefined ? 0 : years.filter((candidate) => candidate === year).length;
				let candidate = duplicate && year !== undefined && yearCount === 1
					? joinPath(folder, `${stem} (${year}).md`)
					: duplicate ? candidateWithSuffix(folder, year === undefined ? stem : `${stem} (${year})`, identityToken(game)) : joinPath(folder, `${stem}.md`);
				if (occupied.has(pathKey(candidate))) {
					if (!duplicate && game.identity.externalIds.igdb !== undefined && year !== undefined) {
						const yearCandidate = joinPath(folder, `${stem} (${year}).md`);
						if (!occupied.has(pathKey(yearCandidate))) {
							candidate = yearCandidate;
							occupied.add(pathKey(candidate));
							assignments.set(game.identity.canonicalKey, candidate);
							continue;
						}
					}
					const disambiguatedStem = year === undefined || game.identity.externalIds.igdb === undefined ? stem : `${stem} (${year})`;
					candidate = candidateWithSuffix(folder, disambiguatedStem, identityToken(game));
				}
				if (occupied.has(pathKey(candidate))) {
					candidate = candidateWithSuffix(folder, candidate.replace(/^.*\//u, '').replace(/\.md$/iu, ''), sanitizeIdentity(`canonical-${game.identity.canonicalKey}`));
				}
				occupied.add(pathKey(candidate));
				assignments.set(game.identity.canonicalKey, candidate);
			}
		}
		return assignments;
	}
}
