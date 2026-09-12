import { DEFAULT_PROPERTY_MAPPING, resolvePropertyMapping, type PropertyMapping } from '../model/property-mapping';
import { parseFrontmatter } from './frontmatter';
import type { VaultGateway, VaultNoteRef } from './gateway';

export interface IndexedNote extends VaultNoteRef {
	properties: Record<string, unknown>;
	title?: string;
	normalizedTitle?: string;
	normalizedFilename: string;
}

function normalize(value: string): string {
	return value.toLocaleLowerCase().replace(/\.md$/i, '').replace(/[ _-]+/g, ' ').trim();
}

function valuesFor(properties: Record<string, unknown>, names: readonly (string | undefined)[]): string[] {
	return names.flatMap((name) => {
		if (!name) return [];
		const value = properties[name];
		if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
		return typeof value === 'string' || typeof value === 'number' ? [String(value)] : [];
	});
}

export class NoteIndex {
	private readonly gameSyncIds = new Map<string, IndexedNote[]>();
	private readonly steamIds = new Map<string, IndexedNote[]>();
	private readonly playstationIds = new Map<string, IndexedNote[]>();

	constructor(readonly notes: readonly IndexedNote[], mapping: PropertyMapping = {}) {
		const resolved = resolvePropertyMapping(mapping);
		for (const note of notes) {
			this.add(this.gameSyncIds, note, valuesFor(note.properties, [resolved.gameSyncId]));
			this.add(this.steamIds, note, valuesFor(note.properties, [resolved.steamId]));
			this.add(this.playstationIds, note, valuesFor(note.properties, [
				resolved.playstationId, 'playstation-concept-id', 'playstation-title-ids', 'playstation-communication-ids', 'psn-title-ids', 'psn-communication-ids',
			]));
		}
	}

	private add(target: Map<string, IndexedNote[]>, note: IndexedNote, values: readonly string[]): void {
		for (const value of values) {
			const list = target.get(value) ?? [];
			list.push(note);
			target.set(value, list);
		}
	}

	private all(target: Map<string, IndexedNote[]>, value: string): IndexedNote[] {
		return [...(target.get(value) ?? [])];
	}

	findByGameSyncId(value: string): IndexedNote[] { return this.all(this.gameSyncIds, value); }
	findBySteamId(value: string): IndexedNote[] { return this.all(this.steamIds, value); }
	findByPlayStationIdentifier(value: string): IndexedNote[] { return this.all(this.playstationIds, value); }
	findCandidates(title: string): IndexedNote[] {
		const normalized = normalize(title);
		return this.notes.filter((note) => note.normalizedTitle === normalized || note.normalizedFilename === normalized);
	}
}

export async function buildNoteIndex(gateway: VaultGateway, mapping: PropertyMapping = DEFAULT_PROPERTY_MAPPING): Promise<NoteIndex> {
	const refs = await gateway.listMarkdownFiles();
	const notes: IndexedNote[] = [];
	const resolved = resolvePropertyMapping(mapping);
	for (const ref of refs) {
		const content = await gateway.read(ref.path);
		const parsed = parseFrontmatter(content);
		const titleValue = parsed.frontmatter[resolved.title ?? 'title'];
		const fileTitle = ref.path.split('/').at(-1) ?? ref.path;
		notes.push({
			...ref,
			fingerprint: ref.fingerprint,
			properties: parsed.frontmatter,
			title: typeof titleValue === 'string' ? titleValue : undefined,
			normalizedTitle: typeof titleValue === 'string' ? normalize(titleValue) : undefined,
			normalizedFilename: normalize(fileTitle),
		});
	}
	return new NoteIndex(notes, mapping);
}
