/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoBodyHeadingMatchingModalTitle } from './ui-helpers';

const obsidianMock = vi.hoisted(() => {
	class Modal {
		contentEl: HTMLElement;
		constructor(public readonly app: unknown) {
			this.contentEl = document.createElement('div');
			const decorate = (element: HTMLElement): void => {
				Object.defineProperty(element, 'createEl', { value: (tag: string): HTMLElement => {
					const child = document.createElement(tag);
					decorate(child);
					element.append(child);
					return child;
				} });
			};
			decorate(this.contentEl);
		}
		setTitle(_title: string): this { return this; }
		close(): void { this.onClose(); }
		onOpen(): void {}
		onClose(): void {}
	}

	class Setting {
		settingEl: HTMLElement;
		constructor(containerEl: HTMLElement) {
			this.settingEl = document.createElement('div');
			this.settingEl.className = 'setting-item';
			containerEl.append(this.settingEl);
		}
		setName(value: string): this { this.settingEl.dataset.settingName = value; return this; }
		setDesc(value: string): this { this.settingEl.dataset.settingDescription = value; return this; }
		addText(callback: (component: { inputEl: HTMLInputElement }) => unknown): this {
			const inputEl = document.createElement('input');
			this.settingEl.append(inputEl);
			callback({ inputEl });
			return this;
		}
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this {
			const buttonEl = document.createElement('button');
			this.settingEl.append(buttonEl);
			const component = {
				buttonEl,
				setButtonText: (value: string) => { buttonEl.textContent = value; return component; },
				setCta: () => component,
				setDisabled: (value: boolean) => { buttonEl.disabled = value; return component; },
				onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; },
			};
			callback(component);
			return this;
		}
		addToggle(callback: (component: { toggleEl: HTMLInputElement; setValue(value: boolean): unknown; onChange(handler: (value: boolean) => unknown): unknown }) => unknown): this {
			const toggleEl = document.createElement('input');
			toggleEl.type = 'checkbox';
			this.settingEl.append(toggleEl);
			const component = {
				toggleEl,
				setValue: (value: boolean) => { toggleEl.checked = value; return component; },
				onChange: (handler: (value: boolean) => unknown) => { toggleEl.addEventListener('change', () => void handler(toggleEl.checked)); return component; },
			};
			callback(component);
			return this;
		}
	}

	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { IgnoredGamesModal } = await import('../src/ui/ignored-games-modal');
import type { IgnoredGameEntry, IgnoredGamesAdapter } from '../src/ui/ignored-games-modal';

function entries(): IgnoredGameEntry[] {
	return [
		{ kind: 'canonical', id: 'canonical:one', label: 'Hades', provider: 'steam' },
		{ kind: 'providerRef', id: 'steam:10', label: 'Hades on Steam', provider: 'steam' },
		{ kind: 'providerRef', id: 'playstation:20', label: 'Hades on PlayStation', provider: 'playstation' },
	];
}

describe('IgnoredGamesModal', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('searches entries and restores selected IDs through the adapter, then refreshes the list', async () => {
		let current = entries();
		const restore = vi.fn(async (ids: readonly string[]) => { current = current.filter((entry) => !ids.includes(entry.id)); });
		const list = vi.fn(() => current);
		const adapter: IgnoredGamesAdapter = { entries: current, list, restore };
		const modal = new IgnoredGamesModal({} as never, { adapter });
		modal.onOpen();
		expectNoBodyHeadingMatchingModalTitle(modal.contentEl, 'Ignored games');

		const search = modal.contentEl.querySelector<HTMLInputElement>('[data-ignored-games-search]')!;
		search.value = 'playstation';
		search.dispatchEvent(new Event('input'));
		expect(modal.contentEl.querySelector<HTMLElement>('[data-ignored-game-row="steam:10"]')!.hidden).toBe(true);
		expect(modal.contentEl.querySelector<HTMLElement>('[data-ignored-game-row="playstation:20"]')!.hidden).toBe(false);

		search.value = '';
		search.dispatchEvent(new Event('input'));
		const checkboxes = modal.contentEl.querySelectorAll<HTMLInputElement>('[data-ignored-game-checkbox]');
		checkboxes[0].checked = true;
		checkboxes[0].dispatchEvent(new Event('change'));
		checkboxes[1].checked = true;
		checkboxes[1].dispatchEvent(new Event('change'));
		modal.contentEl.querySelector<HTMLButtonElement>('[data-ignored-games-restore-selected]')!.click();
		await vi.waitFor(() => expect(restore).toHaveBeenCalledWith(['canonical:one', 'steam:10']));
		await vi.waitFor(() => expect(list).toHaveBeenCalled());
		await vi.waitFor(() => expect(modal.contentEl.querySelectorAll('[data-ignored-game-row]')).toHaveLength(1));
	});

	it('restores one entry with its exact canonical or provider reference ID', async () => {
		const restore = vi.fn().mockResolvedValue(undefined);
		const modal = new IgnoredGamesModal({} as never, { adapter: { entries: entries(), restore, list: () => entries() } });
		modal.onOpen();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-ignored-game-restore="steam:10"]')!.click();
		await vi.waitFor(() => expect(restore).toHaveBeenCalledWith(['steam:10']));
	});

	it('renders Polish labels, hides raw errors, and ignores pending refresh after close', async () => {
		let resolveRestore!: () => void;
		const restore = vi.fn(() => new Promise<void>((resolve) => { resolveRestore = resolve; }));
		const list = vi.fn(() => entries());
		const modal = new IgnoredGamesModal({} as never, { adapter: { entries: entries(), restore, list } });
		modal.onOpen();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-ignored-game-restore="steam:10"]')!.click();
		modal.onClose();
		resolveRestore();
		await Promise.resolve();
		expect(list).not.toHaveBeenCalled();

		obsidianMock.getLanguage.mockReturnValue('pl');
		const polish = new IgnoredGamesModal({} as never, { adapter: { entries: entries(), restore: vi.fn().mockRejectedValue(new Error('SECRET_ERROR')), list: () => entries() } });
		polish.onOpen();
		expect(polish.contentEl.textContent).toContain('Przywróć zaznaczone');
		polish.contentEl.querySelector<HTMLButtonElement>('[data-ignored-game-restore="steam:10"]')!.click();
		await vi.waitFor(() => expect(polish.contentEl.textContent).toContain('Nie udało się przywrócić wybranych gier.'));
		expect(polish.contentEl.textContent).not.toContain('SECRET_ERROR');
	});
});
