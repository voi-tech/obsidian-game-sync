/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEMPLATE_HELPERS, TEMPLATE_PARTIALS, TEMPLATE_PUBLIC_KEYS } from '../src/vault/template-reference';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement {
		Object.defineProperties(element, {
			createEl: { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } },
			createDiv: { value: () => { const child = decorate(document.createElement('div')); element.append(child); return child; } },
		});
		return element;
	}

	class Modal {
		contentEl = decorate(document.createElement('div'));
		constructor(public readonly app: unknown) {}
		setTitle(title: string): this { this.contentEl.dataset.title = title; return this; }
		close(): void {}
	}

	class Setting {
		constructor(containerEl: HTMLElement) { this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item'; containerEl.append(this.settingEl); }
		settingEl: HTMLElement;
		setName(value: string): this { this.settingEl.dataset.settingName = value; return this; }
		setDesc(_value: string): this { return this; }
		addText(callback: (component: { inputEl: HTMLInputElement }) => unknown): this {
			const inputEl = document.createElement('input');
			this.settingEl.append(inputEl);
			callback({ inputEl });
			return this;
		}
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; onClick(handler: () => unknown): unknown }) => unknown): this {
			const buttonEl = document.createElement('button');
			this.settingEl.append(buttonEl);
			const component = {
				buttonEl,
				setButtonText: (value: string) => { buttonEl.textContent = value; return component; },
				onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; },
			};
			callback(component);
			return this;
		}
	}

	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { TemplateKeysModal } = await import('../src/ui/template-keys-modal');

describe('Template keys modal', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('covers every public key, helper and partial exactly once in seven categories', () => {
		const modal = new TemplateKeysModal({} as never);
		modal.onOpen();
		expect(Array.from(modal.contentEl.querySelectorAll('h2')).map((element) => element.textContent)).toEqual([
			'Common', 'Steam', 'PlayStation', 'Achievements', 'Purchase data', 'Convenience', 'Helpers',
		]);
		const rendered = Array.from(modal.contentEl.querySelectorAll<HTMLElement>('[data-template-key]')).map((element) => element.dataset.templateKey);
		expect(rendered).toHaveLength(new Set([...TEMPLATE_PUBLIC_KEYS, ...TEMPLATE_HELPERS, ...TEMPLATE_PARTIALS]).size);
		expect(new Set(rendered).size).toBe(rendered.length);
		expect(new Set(rendered)).toEqual(new Set([...TEMPLATE_PUBLIC_KEYS, ...TEMPLATE_HELPERS, ...TEMPLATE_PARTIALS]));
	});

	it('filters by key, category and label', () => {
		const modal = new TemplateKeysModal({} as never);
		modal.onOpen();
		const search = modal.contentEl.querySelector<HTMLInputElement>('[data-template-search]')!;
		search.value = 'steam';
		search.dispatchEvent(new Event('input'));
		const visible = Array.from(modal.contentEl.querySelectorAll<HTMLElement>('[data-template-key]')).filter((element) => element.hidden === false);
		expect(visible.length).toBeGreaterThan(0);
		expect(visible.every((element) => element.dataset.templateKey?.toLowerCase().includes('steam') || element.dataset.templateCategory?.toLowerCase().includes('steam'))).toBe(true);
	});

	it('reports clipboard success and failure without exposing an exception', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
		const modal = new TemplateKeysModal({} as never);
		modal.onOpen();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-template-copy="title"]')!.click();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('{{title}}'));
		await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Copied'));

		writeText.mockRejectedValueOnce(new Error('raw clipboard exception'));
		modal.contentEl.querySelector<HTMLButtonElement>('[data-template-copy="id"]')!.click();
		await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Could not copy'));
		expect(modal.contentEl.textContent).not.toContain('raw clipboard exception');
	});

	it('shows a safe message when Clipboard API is unavailable', async () => {
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
		const modal = new TemplateKeysModal({} as never);
		modal.onOpen();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-template-copy="title"]')!.click();
		await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Clipboard is unavailable'));
	});
});
