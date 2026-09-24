export type VaultPathSuggestionKind = 'folder' | 'template';

export interface VaultPathEntry {
	path: string;
	kind: 'file' | 'folder';
	extension?: string;
}

export function collectVaultPathSuggestions(entries: readonly VaultPathEntry[], kind: VaultPathSuggestionKind): string[] {
	const paths = entries
		.filter((entry) => kind === 'folder' ? entry.kind === 'folder' : entry.kind === 'file' && ['md', 'markdown', 'tmpl', 'template', 'txt'].includes((entry.extension ?? '').toLocaleLowerCase()))
		.map((entry) => entry.path.trim())
		.filter((path) => path.length > 0);
	return [...new Set(paths)].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

export function filterVaultPathSuggestions(paths: readonly string[], query: string): string[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	return paths.filter((path) => normalizedQuery.length === 0 || path.toLocaleLowerCase().includes(normalizedQuery));
}

interface VaultLike {
	getAllLoadedFiles?: () => ReadonlyArray<{ path: string; extension?: string; children?: unknown }>;
}

function createDomElement<T extends HTMLElement>(ownerDocument: Document, tag: string): T {
	const factory = Reflect.get(ownerDocument, 'createElement');
	if (typeof factory !== 'function') throw new Error('Document cannot create elements.');
	return Reflect.apply(factory, ownerDocument, [tag]) as T;
}

export function readVaultPathSuggestions(app: { vault?: VaultLike }, kind: VaultPathSuggestionKind): string[] {
	try {
		const entries = app.vault?.getAllLoadedFiles?.() ?? [];
		return collectVaultPathSuggestions(entries.map((entry) => ({ path: entry.path, kind: entry.children !== undefined ? 'folder' : 'file', extension: entry.extension })), kind);
	} catch {
		return [];
	}
}

let datalistId = 0;

/** Adds a native HTML datalist and keeps its options searchable as the user types. */
export function attachVaultPathSuggestions(
	input: HTMLInputElement,
	app: { vault?: VaultLike },
	kind: VaultPathSuggestionKind,
	parent: HTMLElement = input.parentElement ?? document.body,
): void {
	const paths = readVaultPathSuggestions(app, kind);
	if (paths.length === 0) return;
	// The test harness has plain DOM elements; production Obsidian adds createEl to them.
	const datalist = createDomElement<HTMLDataListElement>(parent.ownerDocument, 'datalist');
	datalist.id = `game-sync-${kind}-suggestions-${++datalistId}`;
	datalist.dataset.vaultPathSuggestions = kind;
	input.setAttribute('list', datalist.id);
	const refresh = (query = ''): void => {
		datalist.replaceChildren();
		for (const path of filterVaultPathSuggestions(paths, query)) {
			const option = createDomElement<HTMLOptionElement>(datalist.ownerDocument, 'option');
			option.value = path;
			datalist.append(option);
		}
	};
	input.addEventListener('input', () => refresh(input.value));
	refresh();
	parent.append(datalist);
}
