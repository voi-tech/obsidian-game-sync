import { describe, expect, it } from 'vitest';
import { applyManagedProperties, parseFrontmatter, serializeNote } from '../src/vault/frontmatter';

describe('frontmatter primitives', () => {
	it('parses basic Obsidian frontmatter and preserves the body', () => {
		const parsed = parseFrontmatter('---\nstatus: playing\ntags:\n  - games\n---\n# My note\n\nBody');

		expect(parsed.frontmatter).toEqual({ status: 'playing', tags: ['games'] });
		expect(parsed.body).toBe('# My note\n\nBody');
	});

	it('applies only supplied managed values and keeps unrelated properties', () => {
		const content = '---\nstatus: playing\ncustom: keep\n---\nBody';
		const updated = applyManagedProperties(content, { title: 'New title', ignored: undefined });

		expect(parseFrontmatter(updated).frontmatter).toEqual({ status: 'playing', custom: 'keep', title: 'New title' });
		expect(parseFrontmatter(updated).body).toBe('Body');
	});

	it('serializes a note without changing body content', () => {
		expect(serializeNote({ type: 'game', tags: ['games', 'rpg'] }, '# Title\n\nBody')).toBe(
		'---\ntype: game\ntags:\n  - games\n  - rpg\n---\n# Title\n\nBody',
	);
	});
});
