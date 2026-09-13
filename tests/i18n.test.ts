import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ getLanguage: vi.fn(() => 'en') }));

import { getLanguage } from 'obsidian';
import { en } from '../src/i18n/en';
import { pl } from '../src/i18n/pl';
import { t } from '../src/i18n';

type JsonObject = { readonly [key: string]: string | JsonObject };

function treeShape(value: JsonObject, prefix = ''): Record<string, 'leaf' | 'branch'> {
	const shape: Record<string, 'leaf' | 'branch'> = {};
	for (const [key, child] of Object.entries(value)) {
		const path = prefix === '' ? key : `${prefix}.${key}`;
		if (typeof child === 'string') shape[path] = 'leaf';
		else {
			shape[path] = 'branch';
			Object.assign(shape, treeShape(child, path));
		}
	}
	return shape;
}

function leafValues(value: JsonObject, prefix = ''): Record<string, string> {
	const leaves: Record<string, string> = {};
	for (const [key, child] of Object.entries(value)) {
		const path = prefix === '' ? key : `${prefix}.${key}`;
		if (typeof child === 'string') leaves[path] = child;
		else Object.assign(leaves, leafValues(child, path));
	}
	return leaves;
}

function placeholderNames(value: string): string[] {
	return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
}

describe('typed Game Sync translations', () => {
	const language = vi.mocked(getLanguage);

	beforeEach(() => {
		language.mockReturnValue('en');
	});

	it('keeps English and Polish trees and placeholder names identical', () => {
		expect(treeShape(pl)).toEqual(treeShape(en));

		const english = leafValues(en);
		const polish = leafValues(pl);
		expect(Object.keys(polish).sort()).toEqual(Object.keys(english).sort());
		for (const path of Object.keys(english)) {
			expect(placeholderNames(polish[path]), path).toEqual(placeholderNames(english[path]));
		}
	});

	it('uses English by default and for non-Polish Obsidian languages', () => {
		expect(t('sync.title')).toBe(en.sync.title);
		language.mockReturnValue('de');
		expect(t('sync.title')).toBe(en.sync.title);
	});

	it('selects Polish for every pl-prefixed language', () => {
		language.mockReturnValue('pl');
		expect(t('sync.title')).toBe(pl.sync.title);
		language.mockReturnValue('pl-PL');
		expect(t('sync.summary.gamesFetched', { count: 3 })).toBe('Pobrane gry: 3');
	});

	it('interpolates named parameters as literal text', () => {
		language.mockReturnValue('en');
		expect(t('sync.summary.gamesFetched', { count: 3 })).toBe('Games fetched: 3');
		expect(t('sync.messages.providerFailed', { provider: '<Steam>' })).toBe('The <Steam> provider failed.');
	});
});
