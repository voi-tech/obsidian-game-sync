import { describe, expect, it } from 'vitest';
import type { MetadataProvider } from '../src/metadata/provider';
import { resolveCanonicalMetadata } from '../src/metadata/resolver';
import type { CanonicalGameCandidate } from '../src/identity/resolver';

function game(overrides: Partial<CanonicalGameCandidate> = {}): CanonicalGameCandidate {
	return {
		canonicalId: 'canonical-1',
		title: 'Stable Canonical Title',
		developers: ['Existing Studio'],
		publishers: [],
		genres: ['Action'],
		platforms: ['pc'],
		providers: {
			steam: { providerGameId: '10', playtimeMinutes: 120 },
			playstation: { providerGameId: 'concept-10', trophies: { earned: 2, total: 10 } },
		},
		...overrides,
	};
}

describe('canonical metadata resolver', () => {
	it('selects metadata per field with Steam-first automatic fallback', async () => {
		const steam: MetadataProvider = {
			id: 'steam',
			enrich: async () => ({ provider: 'steam', description: 'Steam description', genres: ['RPG'], cover: 'steam-cover' }),
		};
		const playstation: MetadataProvider = {
			id: 'playstation',
			enrich: async () => ({ provider: 'playstation', description: 'PS description', platforms: ['ps5'] }),
		};

		const resolved = await resolveCanonicalMetadata(game(), [steam, playstation], 'english');

		expect(resolved.title).toBe('Stable Canonical Title');
		expect(resolved.description).toBe('Steam description');
		expect(resolved.genres).toEqual(['RPG']);
		expect(resolved.platforms).toEqual(['ps5']);
	});

	it('honors explicit source preference per field and accepts existing metadata preferences', async () => {
		const steam: MetadataProvider = {
			id: 'steam',
			enrich: async () => ({ provider: 'steam', title: 'Steam Title', description: 'Steam description' }),
		};
		const playstation: MetadataProvider = {
			id: 'playstation',
			enrich: async () => ({ provider: 'playstation', title: 'PlayStation Title', description: 'PS description' }),
		};

		const resolved = await resolveCanonicalMetadata(game(), [steam, playstation], 'polish', {
			sourcePreference: 'playstation-first',
			metadataPreference: 'polish',
		});

		expect(resolved.title).toBe('PlayStation Title');
		expect(resolved.description).toBe('PS description');
	});

	it('handles null providers and preserves nested provider-specific state', async () => {
		const nullProvider: MetadataProvider = {
			id: 'steam',
			enrich: async () => null,
		};
		const resolved = await resolveCanonicalMetadata(game(), [nullProvider], 'follow-obsidian');

		expect(resolved.title).toBe('Stable Canonical Title');
		expect(resolved.providers).toEqual(game().providers);
	});

	it('deep-merges partial nested provider state without dropping existing keys', async () => {
		const enrichment: MetadataProvider = {
			id: 'steam',
			enrich: async () => ({
				provider: 'steam',
				providerState: { achievements: { earned: 5 }, nested: { current: 'new' } },
			}),
		};
		const candidate = game({
			providers: {
				steam: {
					providerGameId: '10',
					achievements: { earned: 2, total: 10, other: 'keep' },
					nested: { current: 'old', retained: true },
				},
			},
		});

		const resolved = await resolveCanonicalMetadata(candidate, [enrichment], 'english');

		expect(resolved.providers?.steam).toEqual({
			providerGameId: '10',
			achievements: { earned: 5, total: 10, other: 'keep' },
			nested: { current: 'new', retained: true },
		});
		expect(candidate.providers?.steam).toEqual({
			providerGameId: '10',
			achievements: { earned: 2, total: 10, other: 'keep' },
			nested: { current: 'old', retained: true },
		});
	});

	it('does not require external metadata registrations', async () => {
		const resolved = await resolveCanonicalMetadata(game(), [], 'english');

		expect(resolved).toEqual(game());
	});
});
