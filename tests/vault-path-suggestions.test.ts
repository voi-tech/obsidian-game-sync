import { describe, expect, it } from 'vitest';
import { collectVaultPathSuggestions, filterVaultPathSuggestions } from '../src/ui/settings/vault-path-suggestions';

describe('vault path suggestions', () => {
	it('collects sorted folder and template candidates from vault entries', () => {
		const entries = [
			{ path: 'Templates/game.md', kind: 'file' as const, extension: 'md' },
			{ path: 'Games/Library', kind: 'folder' as const },
			{ path: 'Games', kind: 'folder' as const },
			{ path: 'Templates/archive.tmpl', kind: 'file' as const, extension: 'tmpl' },
			{ path: 'Assets/cover.png', kind: 'file' as const, extension: 'png' },
		];

		expect(collectVaultPathSuggestions(entries, 'folder')).toEqual(['Games', 'Games/Library']);
		expect(collectVaultPathSuggestions(entries, 'template')).toEqual(['Templates/archive.tmpl', 'Templates/game.md']);
	});

	it('filters candidates by a case-insensitive path substring', () => {
		expect(filterVaultPathSuggestions(['Games', 'Games/Library', 'Templates/game.md'], 'library')).toEqual(['Games/Library']);
		expect(filterVaultPathSuggestions(['Games', 'Games/Library', 'Templates/game.md'], 'GAME')).toEqual(['Games', 'Games/Library', 'Templates/game.md']);
	});
});
