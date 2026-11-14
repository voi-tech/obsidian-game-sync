/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
	function decorate<T extends HTMLElement>(element: T): T {
		const create = (tag: string, options?: { text?: string; cls?: string }) => {
			const child = decorate(document.createElement(tag));
			if (options?.text !== undefined) child.textContent = options.text;
			if (options?.cls !== undefined) child.className = options.cls;
			element.append(child);
			return child;
		};
		Object.defineProperties(element, {
			createEl: { value: create },
			createDiv: { value: (options?: { text?: string; cls?: string }) => create('div', options) },
			createSpan: { value: (options?: { text?: string; cls?: string }) => create('span', options) },
			empty: { value: () => { element.replaceChildren(); } },
		});
		return element;
	}
	class Modal {
		contentEl = decorate(document.createElement('div'));
		modalEl = document.createElement('div');
		constructor(public app: unknown) {}
		setTitle(): this { return this; }
		open(): void { (this as unknown as { onOpen(): void }).onOpen(); }
		close(): void { (this as unknown as { onClose(): void }).onClose(); }
	}
	class Setting {
		constructor(_container: HTMLElement) {}
		addButton(callback: (button: { setButtonText(text: string): unknown; onClick(handler: () => void): unknown }) => void): this {
			const button = { setButtonText: () => button, onClick: () => button };
			callback(button);
			return this;
		}
	}
	return { Modal, Setting, Notice: class {}, getLanguage: () => 'en' };
});

const { PurchaseImportModal } = await import('../src/ui/purchase-import-modal');

const note = (path: string, title: string) => ({ path, title, properties: {}, normalizedFilename: path.toLowerCase(), fingerprint: `fp-${path}` });

describe('purchase import modal', () => {
	it('retries only the notes that failed, never the ones already saved', async () => {
		const attempts: string[] = [];
		const writeFrontmatter = vi.fn(async (path: string) => {
			attempts.push(path);
			if (path === 'Games/Returnal.md' && attempts.filter((value) => value === path).length === 1) throw new Error('changed');
		});
		const modal = new PurchaseImportModal({} as never, {
			notesFolder: 'Games',
			propertyMapping: {},
			loadNotes: async () => [note('Games/Diablo IV.md', 'Diablo IV'), note('Games/Returnal.md', 'Returnal')] as never,
			writeFrontmatter,
			readClipboard: async () => 'date,product_name,price,currency\n2024-01-01,Diablo IV,249.00,PLN\n2024-02-01,Returnal,299.00,PLN\n',
			writeClipboard: async () => undefined,
			openUrl: () => undefined,
		});
		modal.open();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-purchase-paste]')!.click();
		await vi.waitFor(() => expect(modal.contentEl.querySelector('[data-purchase-apply]')).not.toBeNull());
		const apply = () => modal.contentEl.querySelector<HTMLButtonElement>('[data-purchase-apply]')!;

		apply().click();
		await vi.waitFor(() => expect(writeFrontmatter).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(apply().disabled).toBe(false));
		apply().click();
		await vi.waitFor(() => expect(writeFrontmatter).toHaveBeenCalledTimes(3));

		expect(attempts).toEqual(['Games/Diablo IV.md', 'Games/Returnal.md', 'Games/Returnal.md']);
	});
});
