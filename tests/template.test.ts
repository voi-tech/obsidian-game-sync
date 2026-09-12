import { describe, expect, it } from 'vitest';
import type { NormalizedGame } from '../src/model/game';
import type { ProviderGame } from '../src/model/provider';
import { buildTemplateContext, renderFilename, renderTemplate } from '../src/vault/template';

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
				{ id: 'a2', name: 'Secret', unlocked: false, hidden: true },
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

describe('stable Handlebars template contract', () => {
	it('exposes the complete flat public context independently of property mappings', () => {
		const context = buildTemplateContext(makeGame(), { updatedAt: '2026-09-12T12:30:00.000Z' });

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
	});

	it('supports helpers, each achievement arrays and Obsidian date placeholders', () => {
		const context = buildTemplateContext(makeGame());
		const rendered = renderTemplate(
			'{{hours 90}}|{{percent 70.456}}|{{date released}}|{{date:YYYY-MM-DD}}|{{#each steamAchievements}}{{name}};{{/each}}',
			context,
			{ now: new Date('2026-09-12T15:04:05.000Z') },
		);
		expect(rendered).toBe('1.5|70.46|2020-12-10|2026-09-12|The Fool;Secret;');
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
	});

	it('wraps template compilation errors', () => {
		expect(() => renderTemplate('{{#if', buildTemplateContext(makeGame()))).toThrow(/Template rendering failed/);
	});
});
