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

	it('ignores delimiters inside YAML frontmatter values', () => {
		const note = `---\nnotes: |\n  %% game-sync:achievements %%\n  keep me\n  %% /game-sync:achievements %%\n---\n# Body`;
		expect(replaceAchievementsBlock(note, replacement)).toBe(`${note}\n\n${replacement}`);
	});

	it('ignores delimiters inside fenced code examples', () => {
		const note = `# Docs\n\n\`\`\`md\n${block}\n\`\`\`\n\n${block}`;
		expect(replaceAchievementsBlock(note, replacement)).toBe(`# Docs\n\n\`\`\`md\n${block}\n\`\`\`\n\n${replacement}`);
	});

	it('ignores delimiters that are not whole lines', () => {
		const note = 'Inline %% game-sync:achievements %% text %% /game-sync:achievements %% stays';
		expect(replaceAchievementsBlock(note, replacement)).toBe(`${note}\n\n${replacement}`);
	});

	it('refuses nested or unbalanced delimiters instead of deleting user text', () => {
		const nested = `%% game-sync:achievements %%\nuser paragraph\n${block}`;
		expect(() => replaceAchievementsBlock(nested, replacement)).toThrow(VaultConflictError);
		expect(() => replaceAchievementsBlock('%% /game-sync:achievements %%\n\n%% game-sync:achievements %%', replacement)).toThrow(VaultConflictError);
	});

	it('handles CRLF line endings', () => {
		const crlf = 'before\r\n\r\n%% game-sync:achievements %%\r\nold\r\n%% /game-sync:achievements %%\r\nafter';
		expect(replaceAchievementsBlock(crlf, replacement)).toBe(`before\r\n\r\n${replacement}\r\nafter`);
	});

	it('follows CommonMark fence rules: a closer has no info string, a backtick opener has no backticks in its info string', () => {
		const block = '%% game-sync:achievements %%\nUSER EXAMPLE\n%% /game-sync:achievements %%';
		const stillFenced = `\`\`\`md\n\`\`\`not-a-close\n${block}\n\`\`\`\n`;
		expect(replaceAchievementsBlock(stillFenced, 'NEW')).toContain('USER EXAMPLE');

		const inlineNotFence = `\`\`\` inline \` code\n${block}`;
		expect(replaceAchievementsBlock(inlineNotFence, 'NEW')).not.toContain('USER EXAMPLE');
		const tabIndented = `\t\`\`\`\n${block}`;
		expect(replaceAchievementsBlock(tabIndented, 'NEW')).not.toContain('USER EXAMPLE');
	});

	it('finds a block right after a BOM without frontmatter', () => {
		expect(replaceAchievementsBlock('\uFEFF%% game-sync:achievements %%\nold\n%% /game-sync:achievements %%', 'NEW')).toBe('\uFEFFNEW');
	});
});
