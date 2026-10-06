import { describe, expect, it } from 'vitest';
import { applyManagedProperties, InvalidFrontmatterError, parseFrontmatter, serializeNote, updateFrontmatter } from '../src/vault/frontmatter';

describe('frontmatter primitives', () => {
	it('reads YAML identities with inline comments and quoted commas', () => {
		const parsed = parseFrontmatter('---\ngame-sync-id: "007" # identity\nproviders: ["one, two", steam]\ncustom:\n  title: Nested\n---\nBody');
		expect(parsed.frontmatter).toEqual({ 'game-sync-id': '007', providers: ['one, two', 'steam'], custom: { title: 'Nested' } });
	});

	it('preserves comments, nested properties, BOM and the exact CRLF body on update', () => {
		const content = '\uFEFF---\r\n# user comment\r\ncustom:\r\n  nested: true # keep\r\ntitle: Old\r\n---\r\nBody\r\n\r\n---not a delimiter\r\n';
		const updated = applyManagedProperties(content, { title: 'New' });
		expect(updated).toContain('# user comment');
		expect(updated).toContain('nested: true # keep');
		expect(updated.startsWith('\uFEFF---\r\n')).toBe(true);
		expect(parseFrontmatter(updated).body).toBe(parseFrontmatter(content).body);
		expect(parseFrontmatter(updated).frontmatter.custom).toEqual({ nested: true });
	});

	it('round-trips string identifiers and empty lists without changing their types', () => {
		const properties = { 'steam-id': '007', title: 'true', description: 'null', developers: [], providers: ['steam'] };
		expect(parseFrontmatter(serializeNote(properties, 'Body')).frontmatter).toEqual(properties);
	});

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

	it.each(['---\ntitle: [broken\n---\nBody', '---\ntitle: First\ntitle: Second\n---\nBody', '---\n- list\n---\nBody', '---\ntitle: Missing close\n---suffix'])('refuses invalid or ambiguous frontmatter', (content) => {
		expect(() => parseFrontmatter(content)).toThrow(InvalidFrontmatterError);
	});

	it('refuses a managed anchor change that would change an unrelated user alias', () => {
		const content = '---\ntitle: &name Old\ncustom: *name\n---\nBody';
		expect(() => applyManagedProperties(content, { title: 'New' })).toThrow(InvalidFrontmatterError);
	});

	it('leaves an unchanged document byte-exact and supports removing only one property', () => {
		const content = '---\n# keep\ntitle: "Old"\ncustom: [one, two]\n---\nBody';
		expect(updateFrontmatter(content, () => undefined)).toBe(content);
		const updated = updateFrontmatter(content, (properties) => { delete properties.title; });
		expect(parseFrontmatter(updated).frontmatter).toEqual({ custom: ['one', 'two'] });
		expect(updated).toContain('# keep');
	});

	it('serializes custom property names as keys rather than YAML structure', () => {
		const properties = { 'title: custom': 'Game', 'line\nbreak': 'value' };
		expect(parseFrontmatter(serializeNote(properties, 'Body')).frontmatter).toEqual(properties);
	});
});
