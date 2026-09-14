import type { CanonicalGame } from '../model/canonical-game';

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
		identity: game.identity,
		title: game.title,
		aliases: game.aliases,
		lastPlayed: game.lastPlayed,
		activity: game.activity,
		metadata: game.metadata,
		platforms: [...game.platforms].sort((left, right) => left.id.localeCompare(right.id)),
		playtime: game.playtime.canonical,
		achievements: game.achievements,
	};
	return `canonical:${hash(stableStringify(payload))}`;
}

export interface SyncedCanonicalGameState {
	readonly canonicalKey: string;
	readonly externalIds: CanonicalGame['identity']['externalIds'];
	readonly fingerprint: string;
	readonly syncedAt: string;
}
