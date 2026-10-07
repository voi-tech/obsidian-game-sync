import { describe, expect, it } from 'vitest';
import type { NormalizedGame } from '../src/model/game';
import type { ProviderGame } from '../src/model/provider';
import { buildTemplateContext, renderFilename, renderTemplate } from '../src/vault/template';
import { TEMPLATE_KEY_CATALOG, TEMPLATE_PUBLIC_KEYS } from '../src/vault/template-reference';
import { buildCanonicalTemplateContext } from '../src/vault/canonical-template';
import type { CanonicalGame } from '../src/model/canonical-game';

function makeProvider(provider: ProviderGame['provider'], overrides: Partial<ProviderGame> = {}): ProviderGame {
	return {
		provider,
		providerGameId: provider === 'steam' ? '1091500' : 'concept-1',
		title: 'Cyberpunk 2077',
		releaseDate: '2020-12-10',
		developers: ['CD PROJEKT RED'],
		publishers: ['CD PROJEKT'],
		genres: ['RPG', 'Action'],
		platforms: provider === 'steam' ? ['pc'] : ['ps5'],
		owned: true,
		playtimeMinutes: provider === 'steam' ? 90 : 30,
		lastPlayed: provider === 'steam' ? '2026-08-12' : '2026-08-13',
		freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
		identity:
			provider === 'steam'
				? { provider: 'steam', appId: 1091500 }
			: { provider: 'playstation', conceptId: 'concept-1', titleIds: ['title-1'], npCommunicationIds: ['comm-1'] },
		...overrides,
	};
}

function makeGame(): NormalizedGame {
	const steam = makeProvider('steam', {
		sourceUrl: 'https://store.steampowered.com/app/1091500',
		achievements: {
			earned: 1,
			total: 2,
			progress: 50,
			achievements: [
				{ id: 'a1', name: 'The Fool', unlocked: true, hidden: false },
				{ id: 'a2', name: 'Secret', description: 'Hidden description', iconUrl: 'https://example.com/secret.png', unlocked: false, hidden: true },
			],
		},
	});
	const playstation = makeProvider('playstation', {
		providerGameId: 'concept-1',
		sourceUrl: 'https://playstation.com/game/concept-1',
		achievements: {
			earned: 2,
			total: 3,
			progress: 66.67,
			achievements: [{ id: 't1', name: 'Bronze', unlocked: true, hidden: false, trophyType: 'bronze' }],
		},
	});
	return {
		identity: {
			canonicalId: 'game-sync:cyberpunk-2077',
			steamAppId: 1091500,
			playstation: { conceptId: 'concept-1', titleIds: ['title-1'], npCommunicationIds: ['comm-1'] },
		},
		canonicalId: 'game-sync:cyberpunk-2077',
		title: 'Cyberpunk 2077',
		originalTitle: 'Cyberpunk 2077',
		releaseDate: '2020-12-10',
		description: 'Night City',
		cover: 'https://example.com/cover.jpg',
		developers: ['CD PROJEKT RED'],
		publishers: ['CD PROJEKT'],
		genres: ['RPG', 'Action'],
		platforms: ['pc', 'ps5'],
		providers: { steam, playstation },
		owned: true,
		acquisitionType: 'purchased',
		playtimeMinutes: 120,
		lastPlayed: '2026-08-13',
	};
}

function makeCanonicalGame(): CanonicalGame {
	return {
		identity: { canonicalKey: 'gametrack:canonical-game', externalIds: { gametrack: 'canonical-game', igdb: 42, steam: '1091500' } },
		title: 'Canonical Game',
		metadata: { releaseDate: '2024-03-04', developers: ['Studio'], publishers: ['Publisher'], genres: ['Action'], summary: 'Summary', cover: 'https://example.com/cover.jpg' },
		platforms: [{ id: 'steam', source: 'gametrack', owned: true }],
		playtime: { canonical: { minutes: 90, source: 'gametrack', confidence: 'high' }, observations: [] },
		achievements: [{ source: 'steam', unlocked: 1, total: 2, completionPercent: 50, confidence: 'high', details: [{ id: 'a1', name: 'First', unlocked: true, hidden: false }] }],
		provenance: { provider: 'gametrack', sourceId: 'canonical-game', schemaSignature: 'schema' },
	};
}

describe('stable Handlebars template contract', () => {
	it('documents every public template key with a description and example', () => {
		expect(TEMPLATE_KEY_CATALOG.map((entry) => entry.key)).toEqual([...TEMPLATE_PUBLIC_KEYS]);
		for (const entry of TEMPLATE_KEY_CATALOG) {
			expect(entry.description.en.length).toBeGreaterThan(0);
			expect(entry.description.pl.length).toBeGreaterThan(0);
			expect(entry.example.length).toBeGreaterThan(0);
		}
	});

	it('exposes the complete flat public context independently of property mappings', () => {
		const context = buildTemplateContext(makeGame(), { updatedAt: '2026-09-12T12:30:00.000Z' });
		expect(Object.keys(context).sort()).toEqual([...TEMPLATE_PUBLIC_KEYS].sort());

		expect(context).toMatchObject({
			id: 'game-sync:cyberpunk-2077',
			title: 'Cyberpunk 2077',
			original: 'Cyberpunk 2077',
			year: 2020,
			released: '2020-12-10',
			playtime: 120,
			playtimeHours: 2,
			steamId: '1091500',
			playstationId: 'concept-1',
			updated: '2026-09-12T12:30:00.000Z',
		});
		expect(context.genres).toEqual(['RPG', 'Action']);
		expect(context.steamAchievements).toHaveLength(2);
		expect(context.playstationTrophies).toHaveLength(1);

		const rendered = renderTemplate('{{title}}|{{join genres ", "}}|{{steamId}}|{{playtime}}', context);
		expect(rendered).toBe('Cyberpunk 2077|RPG, Action|1091500|120');
		expect(renderTemplate('{{join genres}}', context)).toBe('RPG, Action');
	});

	it('does not expose locked hidden achievement fields without explicit reveal', () => {
		const hidden = buildTemplateContext(makeGame()).steamAchievements.find((achievement) => achievement.id === 'a2');
		expect(hidden).toMatchObject({ id: 'a2', hidden: true, unlocked: false });
		expect(hidden).not.toHaveProperty('name');
		expect(hidden).not.toHaveProperty('description');
		expect(hidden).not.toHaveProperty('iconUrl');

		const revealed = buildTemplateContext(makeGame(), { revealHidden: true }).steamAchievements.find((achievement) => achievement.id === 'a2');
		expect(revealed).toMatchObject({ name: 'Secret', description: 'Hidden description', iconUrl: 'https://example.com/secret.png' });
	});

	it('supports helpers, each achievement arrays and Obsidian date placeholders', () => {
		const context = buildTemplateContext(makeGame());
		const rendered = renderTemplate(
			'{{hours 90}}|{{percent 70.456}}|{{date released}}|{{date:YYYY-MM-DD}}|{{#each steamAchievements}}{{name}};{{/each}}',
			context,
			{ now: new Date('2026-09-12T15:04:05.000Z') },
		);
		expect(rendered).toBe('1.5|70.46|2020-12-10|2026-09-12|The Fool;;');
	});

	it('registers the required partials and handles empty optional date values', () => {
		const context = buildTemplateContext(makeGame());
		expect(renderTemplate('{{> steamAchievements}}', context)).toContain('The Fool');
		expect(renderTemplate('{{date missingValue}}', context)).toBe('');
	});

	it('sanitizes filenames and falls back for empty patterns', () => {
		const context = buildTemplateContext(makeGame());
		expect(renderFilename('{{title}}: deluxe/edition', context)).toBe('Cyberpunk 2077 deluxe edition');
		expect(renderFilename('', context)).toBe('Cyberpunk 2077');
		expect(renderFilename('{{missingValue}}', context)).toBe('Cyberpunk 2077');
		expect(renderFilename('{{title}}', buildTemplateContext({ ...makeGame(), title: '/:*?' }))).toBe('game');
	});

	it('wraps template compilation errors', () => {
		expect(() => renderTemplate('{{#if', buildTemplateContext(makeGame()))).toThrow(/Template rendering failed/);
	});

	it('adapts canonical games to the existing flat template contract', () => {
		const context = buildCanonicalTemplateContext(makeCanonicalGame());
		expect(Object.keys(context).sort()).toEqual([...TEMPLATE_PUBLIC_KEYS].sort());
		expect(context).toMatchObject({ id: 'gametrack:canonical-game', title: 'Canonical Game', released: '2024-03-04', playtime: 90, playtimeHours: 1.5, acquisitionType: 'unknown', steamId: '1091500', steamAchievementsEarned: 1, steamAchievementsTotal: 2, steamAchievementsProgress: 50 });
		expect(renderTemplate('{{title}}|{{released}}|{{playtimeHours}}|{{steamAchievementsEarned}}|{{join providers ","}}', context)).toBe('Canonical Game|2024-03-04|1.5|1|gametrack,steam');
	});

	it('keeps zero trophy categories in the canonical template context for an empty reliable details snapshot', () => {
		const context = buildCanonicalTemplateContext({
			...makeCanonicalGame(),
			achievements: [{ source: 'playstation', unlocked: 0, total: 0, completionPercent: 0, confidence: 'high', details: [] }],
		});

		expect(context).toMatchObject({ psnBronze: 0, psnSilver: 0, psnGold: 0, psnPlatinum: 0 });
	});

	it('keeps trophy categories undefined when no reliable category snapshot exists', () => {
		const withoutSummary = buildCanonicalTemplateContext(makeCanonicalGame());
		const withoutDetails = buildCanonicalTemplateContext({
			...makeCanonicalGame(),
			achievements: [{ source: 'playstation', unlocked: 0, total: 0, completionPercent: 0, confidence: 'high' }],
		});

		expect(withoutSummary.psnBronze).toBeUndefined();
		expect(withoutDetails.psnBronze).toBeUndefined();
	});
});
