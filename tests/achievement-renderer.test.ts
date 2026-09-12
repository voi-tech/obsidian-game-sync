import { describe, expect, it } from 'vitest';
import { renderAchievementsBlock } from '../src/vault/achievement-renderer';

const steam = {
	earned: 1,
	total: 2,
	progress: 50,
	achievements: [
		{ id: 's1', name: 'The Fool', unlocked: true, hidden: true, unlockedAt: '2026-08-12', rarityPercent: 35.1 },
		{ id: 's2', name: 'Secret title', description: 'Do secret thing', unlocked: false, hidden: true },
	],
};

const playstation = {
	earned: 1,
	total: 2,
	progress: 50,
	achievements: [
		{ id: 'p1', name: 'Bronze', unlocked: true, hidden: false, trophyType: 'bronze' as const, unlockedAt: '2026-08-13' },
		{ id: 'p2', name: 'Platinum', unlocked: false, hidden: false, trophyType: 'platinum' as const },
	],
};

describe('managed achievement rendering', () => {
	it('renders Steam and PlayStation systems separately', () => {
		const block = renderAchievementsBlock({ steam, playstation });
		expect(block).toContain('%% game-sync:achievements %%');
		expect(block).toContain('## Steam achievements');
		expect(block).toContain('## PlayStation trophies');
		expect(block).toContain('1 / 2 · 50.00%');
		expect(block).not.toContain('100%');
	});

	it('does not leak locked hidden spoilers but reveals unlocked hidden names', () => {
		const block = renderAchievementsBlock({ steam });
		expect(block).toContain('The Fool');
		expect(block).not.toContain('Secret title');
		expect(block).toContain('🔒 Hidden achievement');

		const revealed = renderAchievementsBlock({ steam }, { revealHidden: true });
		expect(revealed).toContain('Secret title');
	});

	it('renders optional rarity, dates and trophy types only when enabled', () => {
		const plain = renderAchievementsBlock({ playstation });
		expect(plain).not.toContain('🥉');
		expect(plain).not.toContain('2026-08-13');

		const detailed = renderAchievementsBlock({ steam, playstation }, { showRarity: true, showUnlockDate: true, showTrophyType: true });
		expect(detailed).toContain('35.10%');
		expect(detailed).toContain('2026-08-12');
		expect(detailed).toContain('🥉 Bronze');
		expect(detailed).toContain('🏆 Platinum');
	});

	it('returns no block when no provider has achievements', () => {
		expect(renderAchievementsBlock({})).toBe('');
	});
});
