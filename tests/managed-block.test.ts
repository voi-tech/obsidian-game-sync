import { describe, expect, it } from 'vitest';
import { VaultConflictError } from '../src/network/errors';
import { replaceAchievementsBlock } from '../src/vault/managed-block';

const block = '%% game-sync:achievements %%\n\nold\n\n%% /game-sync:achievements %%';
const replacement = '%% game-sync:achievements %%\n\nnew\n\n%% /game-sync:achievements %%';

describe('managed achievement block replacement', () => {
	it('appends a new block safely', () => {
		expect(replaceAchievementsBlock('# Note', replacement)).toBe(`# Note\n\n${replacement}`);
	});

	it('replaces exactly one existing block', () => {
		expect(replaceAchievementsBlock(`before\n\n${block}\n\nafter`, replacement)).toBe(`before\n\n${replacement}\n\nafter`);
	});

	it('preserves the existing block when the fresh render is empty', () => {
		expect(replaceAchievementsBlock(block, '')).toBe(block);
	});

	it('rejects two blocks as a vault conflict', () => {
		expect(() => replaceAchievementsBlock(`${block}\n\n${block}`, replacement)).toThrow(VaultConflictError);
	});
});
