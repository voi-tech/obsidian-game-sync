import { describe, expect, it } from 'vitest';
import { normalizeTitle } from '../src/identity/normalize-title';

describe('title normalization', () => {
	it('normalizes case, whitespace, marks and typographic punctuation', () => {
		expect(normalizeTitle('  RESIDENT\u00a0EVIL 4™  ')).toBe('resident evil 4');
		expect(normalizeTitle('The “Last” of Us — Part I')).toBe('the "last" of us - part i');
		expect(normalizeTitle('Pokémon®: Édition © complète')).toBe('pokémon: édition complète');
	});

	it('keeps semantic edition suffixes in the normalized title', () => {
		expect(normalizeTitle("The Last of Us Remastered")).toBe('the last of us remastered');
		expect(normalizeTitle('Resident Evil 4 Remake')).toBe('resident evil 4 remake');
		expect(normalizeTitle("Director’s Cut — Complete Edition")).toBe("director's cut - complete edition");
		expect(normalizeTitle('Final Fantasy VII Definitive Edition')).toBe('final fantasy vii definitive edition');
	});
});
