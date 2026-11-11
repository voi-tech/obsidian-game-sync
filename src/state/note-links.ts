import type { GameSyncData } from './schema';

/**
 * Follows a renamed or moved note (or a renamed folder) so a game stays linked to its note.
 * Returns whether anything changed, so callers only save when needed.
 */
export function renameNoteLinks(state: GameSyncData, oldPath: string, newPath: string): boolean {
	let changed = false;
	const moved = (path: string): string => {
		if (path === oldPath) return newPath;
		if (path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`;
		return path;
	};
	state.noteLinks = state.noteLinks.map((link) => {
		const path = moved(link.path);
		if (path === link.path) return link;
		changed = true;
		return { ...link, path };
	});
	return changed;
}

/** Drops links to a deleted note (or every note of a deleted folder); a new note at that path is not the game's. */
export function removeNoteLinks(state: GameSyncData, deletedPath: string): boolean {
	const kept = state.noteLinks.filter((link) => link.path !== deletedPath && !link.path.startsWith(`${deletedPath}/`));
	if (kept.length === state.noteLinks.length) return false;
	state.noteLinks = kept;
	return true;
}
