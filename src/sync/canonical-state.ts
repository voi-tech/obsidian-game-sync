import type { CanonicalGame } from '../model/canonical-game';
import { buildCanonicalManagedProperties } from '../vault/canonical-projection';

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(',')}}`;
}

function hash(value: string): string {
	let result = 2166136261;
	for (const character of value) {
		result ^= character.charCodeAt(0);
		result = Math.imul(result, 16777619);
	}
	return (result >>> 0).toString(16).padStart(8, '0');
}

export function canonicalGameFingerprint(game: CanonicalGame): string {
	const payload = {
		projected: buildCanonicalManagedProperties(game),
	};
	return `canonical:${hash(stableStringify(payload))}`;
}

/** Source content revision excludes retrieval timestamps and diagnostics. */
export function canonicalLibraryRevision(games: readonly CanonicalGame[]): string {
	return hash(stableStringify([...games].sort((left, right) => left.identity.canonicalKey.localeCompare(right.identity.canonicalKey))));
}

export interface SyncedCanonicalGameState {
	readonly canonicalKey: string;
	readonly externalIds: CanonicalGame['identity']['externalIds'];
	readonly fingerprint: string;
	readonly syncedAt: string;
}
