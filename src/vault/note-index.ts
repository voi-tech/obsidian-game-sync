import { DEFAULT_PROPERTY_MAPPING, resolvePropertyMapping, type PropertyMapping } from '../model/property-mapping';
import { resolveCanonicalPropertyMapping, type CanonicalPropertyMapping } from './canonical-projection';
import { InvalidFrontmatterError, parseFrontmatter, readProperty, readPropertyValues } from './frontmatter';
import { noteFingerprint, type VaultGateway, type VaultNoteRef } from './gateway';

export interface IndexedNote extends VaultNoteRef {
	properties: Record<string, unknown>;
	title?: string;
	normalizedTitle?: string;
	normalizedFilename: string;
}

function normalize(value: string): string {
	return value.toLocaleLowerCase().replace(/\.md$/i, '').replace(/[ _-]+/g, ' ').trim();
}

/** String values of the named properties, read case-insensitively (Obsidian property names ignore case). */
export function propertyStrings(properties: Record<string, unknown>, names: readonly (string | undefined)[]): string[] {
	return [...new Set(names.flatMap((name) => {
		if (!name) return [];
		return readPropertyValues(properties, name).flatMap((value) => {
			if (Array.isArray(value)) return value.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number').map(String);
			return typeof value === 'string' || typeof value === 'number' ? [String(value)] : [];
		});
	}))];
}

export class NoteIndex {
	private readonly gameSyncIds = new Map<string, IndexedNote[]>();
	private readonly gameSyncIdsByPath = new Map<string, string[]>();
	private readonly igdbIds = new Map<string, IndexedNote[]>();
	private readonly gameTrackIds = new Map<string, IndexedNote[]>();
	private readonly steamIds = new Map<string, IndexedNote[]>();
	private readonly playstationIds = new Map<string, IndexedNote[]>();
	/** Notes skipped because their frontmatter is not valid YAML. */
	invalidNotePaths: readonly string[] = [];

	constructor(readonly notes: readonly IndexedNote[], mapping: PropertyMapping = {}, canonicalMapping: CanonicalPropertyMapping = {}) {
		const resolved = resolvePropertyMapping(mapping);
		const canonical = resolveCanonicalPropertyMapping(canonicalMapping);
		for (const note of notes) {
			const gameSyncIds = propertyStrings(note.properties, [resolved.gameSyncId]);
			this.gameSyncIdsByPath.set(note.path, gameSyncIds);
			this.add(this.gameSyncIds, note, gameSyncIds);
			this.add(this.igdbIds, note, propertyStrings(note.properties, [canonical.igdbId]));
			this.add(this.gameTrackIds, note, propertyStrings(note.properties, [canonical.gametrackId]));
			this.add(this.steamIds, note, propertyStrings(note.properties, [resolved.steamId]));
			this.add(this.playstationIds, note, propertyStrings(note.properties, [
				resolved.playstationId, 'playstation-concept-id', 'playstation-title-ids', 'playstation-communication-ids', 'psn-title-ids', 'psn-communication-ids',
			]));
		}
	}

	private add(target: Map<string, IndexedNote[]>, note: IndexedNote, values: readonly string[]): void {
		for (const value of values) {
			const list = target.get(value) ?? [];
			if (!list.some((candidate) => candidate.path === note.path)) list.push(note);
			target.set(value, list);
		}
	}

	private all(target: Map<string, IndexedNote[]>, value: string): IndexedNote[] {
		return [...(target.get(value) ?? [])];
	}

	findByGameSyncId(value: string): IndexedNote[] { return this.all(this.gameSyncIds, value); }
	/** The game-sync-id values a note carries under the mapped property, in any letter case. */
	gameSyncIdsOf(note: IndexedNote): readonly string[] { return this.gameSyncIdsByPath.get(note.path) ?? []; }
	findByIgdbId(value: number | string): IndexedNote[] { return this.all(this.igdbIds, String(value)); }
	findByGameTrackId(value: string): IndexedNote[] { return this.all(this.gameTrackIds, value); }
	findBySteamId(value: string): IndexedNote[] { return this.all(this.steamIds, value); }
	findByPlayStationIdentifier(value: string): IndexedNote[] { return this.all(this.playstationIds, value); }
	findCandidates(title: string): IndexedNote[] {
		const normalized = normalize(title);
		return this.notes.filter((note) => note.normalizedTitle === normalized || note.normalizedFilename === normalized);
	}
}

export async function buildNoteIndex(
	gateway: VaultGateway,
	mapping: PropertyMapping = DEFAULT_PROPERTY_MAPPING,
	canonicalMapping: CanonicalPropertyMapping = {},
): Promise<NoteIndex> {
	const refs = await gateway.listMarkdownFiles();
	const notes: IndexedNote[] = [];
	const resolved = resolvePropertyMapping(mapping);
	const invalidNotePaths: string[] = [];
	for (const ref of refs) {
		const content = await gateway.read(ref.path);
		let parsed: ReturnType<typeof parseFrontmatter>;
		try {
			parsed = parseFrontmatter(content);
		} catch (error) {
			// One unrelated note with broken YAML must not block the whole sync. Skipped notes are
			// never mutated: creating a note at an existing path is refused by the writer.
			if (!(error instanceof InvalidFrontmatterError)) throw error;
			invalidNotePaths.push(ref.path);
			continue;
		}
		const titleValue = readProperty(parsed.frontmatter, resolved.title ?? 'title');
		const fileTitle = ref.path.split('/').at(-1) ?? ref.path;
		notes.push({
			...ref,
			fingerprint: noteFingerprint(content),
			properties: parsed.frontmatter,
			title: typeof titleValue === 'string' ? titleValue : undefined,
			normalizedTitle: typeof titleValue === 'string' ? normalize(titleValue) : undefined,
			normalizedFilename: normalize(fileTitle),
		});
	}
	const index = new NoteIndex(notes, mapping, canonicalMapping);
	index.invalidNotePaths = invalidNotePaths;
	return index;
}
