import type { NormalizedGame } from '../model/game';
import { buildManagedProperties, resolvePropertyMapping, type PropertyMapping } from '../model/property-mapping';
import { replaceAchievementsBlock } from '../vault/managed-block';
import { parseFrontmatter } from '../vault/frontmatter';
import { renderAchievementsBlock } from '../vault/achievement-renderer';

export type NoteDiffKind = 'none' | 'properties' | 'achievements';

export interface NoteDiff {
	changed: boolean;
	propertiesChanged: boolean;
	achievementsChanged: boolean;
	kind: NoteDiffKind;
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(',')}}`;
}

function achievementsFresh(game: NormalizedGame): boolean {
	return Object.values(game.providers).every((provider) => provider?.freshness.achievements === true);
}

function managedValueEqual(actual: unknown, expected: unknown): boolean {
	if (actual === null && Array.isArray(expected) && expected.length === 0) return true;
	if ((typeof actual === 'string' || typeof actual === 'number') && (typeof expected === 'string' || typeof expected === 'number')) return String(actual) === String(expected);
	return stableStringify(actual) === stableStringify(expected);
}

export function diffNote(game: NormalizedGame, content: string, propertyMapping: PropertyMapping = {}): NoteDiff {
	const parsed = parseFrontmatter(content);
	const updatedAtKey = resolvePropertyMapping(propertyMapping).updated;
	const updatedAt: unknown = updatedAtKey === undefined ? undefined : parsed.frontmatter[updatedAtKey];
	const managed = buildManagedProperties(game, propertyMapping, {
		updatedAt: typeof updatedAt === 'string' ? updatedAt : undefined,
		omitAchievementProperties: !achievementsFresh(game),
	});
	const propertiesChanged = Object.entries(managed).some(([key, value]) => !managedValueEqual(parsed.frontmatter[key], value));
	const achievementsChanged = achievementsFresh(game) && replaceAchievementsBlock(content, renderAchievementsBlock(game)) !== content;
	return {
		changed: propertiesChanged || achievementsChanged,
		propertiesChanged,
		achievementsChanged,
		kind: achievementsChanged ? 'achievements' : propertiesChanged ? 'properties' : 'none',
	};
}

export const calculateNoteDiff = diffNote;
