/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import type { SettingDefinition, SettingDefinitionGroup } from 'obsidian';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('obsidian', () => ({
	Notice: class { constructor(message: string) { notices.push(message); } },
	getLanguage: () => 'pl',
}));

(globalThis as unknown as Record<string, unknown>).createFragment = (callback: (fragment: unknown) => void) => {
	const fragment = document.createDocumentFragment();
	Object.assign(fragment, {
		createEl: (tag: string, options: { text?: string; href?: string } = {}) => {
			const element = document.createElement(tag);
			if (options.text !== undefined) element.textContent = options.text;
			if (options.href !== undefined) element.setAttribute('href', options.href);
			fragment.append(element);
			return element;
		},
		appendText: (text: string) => { fragment.append(document.createTextNode(text)); },
	});
	callback(fragment);
	return fragment;
};

const { templateKeyPage, templateKeyRows, templateSnippet } = await import('../src/ui/settings/template-key-catalog');
const { TEMPLATE_KEY_CATALOG } = await import('../src/vault/template-reference');

describe('template key catalog', () => {
	it('produces ready-to-paste snippets for scalars, arrays and object lists', () => {
		expect(templateSnippet('title')).toBe('{{title}}');
		expect(templateSnippet('genres')).toBe('{{join genres}}');
		expect(templateSnippet('playstationTrophies')).toBe('{{> playstationTrophies}}');
	});

	it('lists every catalog key once plus the combined achievements block', () => {
		const rows = templateKeyRows(true);
		expect(rows.map((row) => row.id)).toEqual([...TEMPLATE_KEY_CATALOG.map((entry) => entry.key), 'achievements']);
		expect(rows.find((row) => row.id === 'psnGold')?.group).toBe('playstation');
		expect(rows.find((row) => row.id === 'steamAchievements')?.group).toBe('blocks');
	});

	it('is a native page whose rows copy the snippet on click and are searchable by key', async () => {
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const page = templateKeyPage(true);
		expect(page).toMatchObject({ type: 'page', name: 'Klucze dostępne w szablonie' });
		const groups = (page.items ?? []).slice(1) as SettingDefinitionGroup[];
		expect(groups.map((group) => group.heading)).toEqual(['Gra', 'Steam', 'PlayStation', 'Zakup', 'Gotowe listy']);
		const title = groups[0].items?.find((item) => (item as SettingDefinition).aliases?.includes('title')) as SettingDefinition & { action: () => void; desc: DocumentFragment };
		expect(title.name).toBe('Tytuł gry');
		expect(title.desc.textContent).toBe('{{title}} · Przykład: Dead Space');
		title.action();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('{{title}}'));
		expect(notices.at(-1)).toBe('Skopiowano {{title}}');
	});

	it('reports a clipboard failure instead of failing silently', async () => {
		Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
		const groups = (templateKeyPage(true).items ?? []).slice(1) as SettingDefinitionGroup[];
		(groups[0].items?.[0] as SettingDefinition & { action: () => void }).action();
		await vi.waitFor(() => expect(notices.at(-1)).toBe('Nie udało się skopiować do schowka.'));
	});
});
