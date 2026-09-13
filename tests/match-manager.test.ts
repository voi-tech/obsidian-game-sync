/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
				Object.defineProperty(element, 'createDiv', { value: (): HTMLElement => element.createEl('div') });
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
		addDropdown(callback: (component: { selectEl: HTMLSelectElement; addOption(value: string, label: string): unknown; setValue(value: string): unknown; onChange(handler: (value: string) => unknown): unknown; setDisabled(value: boolean): unknown }) => unknown): this {
			const selectEl = document.createElement('select');
			this.settingEl.append(selectEl);
			const component = {
				selectEl,
				addOption: (value: string, label: string) => { const option = document.createElement('option'); option.value = value; option.textContent = label; selectEl.append(option); return component; },
				setValue: (value: string) => { selectEl.value = value; return component; },
				onChange: (handler: (value: string) => unknown) => { selectEl.addEventListener('change', () => void handler(selectEl.value)); return component; },
				setDisabled: (value: boolean) => { selectEl.disabled = value; return component; },
			};
			callback(component);
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
	}

	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { MatchManagerModal } = await import('../src/ui/match-manager');
import type { MatchManagerAdapter, MatchManagerRow } from '../src/ui/match-manager';

function rows(): MatchManagerRow[] {
	return [
		{
			category: 'merged',
			canonicalId: 'canonical:merged',
			title: 'Merged game',
			existingPath: 'Games/Merged.md',
			providers: [
				{ provider: 'steam', providerRef: 'steam:10', providerName: 'Steam copy' },
				{ provider: 'playstation', providerRef: 'playstation:20', providerName: 'PlayStation copy' },
			],
		},
		{
			category: 'kept-separate',
			leftCanonicalId: 'canonical:left',
			rightCanonicalId: 'canonical:right',
			title: 'Separate game',
			existingPath: 'Games/Separate.md',
			providers: [],
		},
		{
			category: 'unresolved',
			canonicalId: 'canonical:unresolved',
			title: 'Unresolved game',
			existingPath: 'Games/Unresolved.md',
			providers: [],
		},
	];
}

function adapter(overrides: Partial<MatchManagerAdapter> = {}): MatchManagerAdapter {
	return {
		rows: rows(),
		prepareUnmerge: vi.fn().mockResolvedValue({ planId: 'plan:prepared', preview: { safe: true } }),
		allowMatchingAgain: vi.fn().mockResolvedValue(undefined),
		onPreparedUnmerge: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe('MatchManagerModal', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('renders exactly the three tabs, searchable rows, and explicit provider choices', () => {
		const modal = new MatchManagerModal({} as never, { adapter: adapter() });
		modal.onOpen();

		expect(Array.from(modal.contentEl.querySelectorAll<HTMLElement>('[data-match-manager-tab]')).map((element) => element.textContent)).toEqual(['Merged', 'Kept separate', 'Unresolved']);
		expect(modal.contentEl.querySelectorAll('[data-match-manager-row]')).toHaveLength(3);
		expect(modal.contentEl.querySelectorAll('[data-match-provider-option]')).toHaveLength(2);

		const search = modal.contentEl.querySelector<HTMLInputElement>('[data-match-manager-search]')!;
		modal.contentEl.querySelector<HTMLButtonElement>('[data-match-manager-tab="unresolved"]')!.click();
		search.value = 'unresolved';
		search.dispatchEvent(new Event('input'));
		expect(modal.contentEl.querySelector<HTMLElement>('[data-match-manager-row="canonical:merged"]')!.hidden).toBe(true);
		expect(modal.contentEl.querySelector<HTMLElement>('[data-match-manager-row="canonical:unresolved"]')!.hidden).toBe(false);
	});

	it('requires provider selection, prepares only through the callback, and forwards the prepared result', async () => {
		const prepareUnmerge = vi.fn().mockResolvedValue({ planId: 'plan:prepared', preview: { safe: true } });
		const onPreparedUnmerge = vi.fn().mockResolvedValue(undefined);
		const modal = new MatchManagerModal({} as never, { adapter: adapter({ prepareUnmerge, onPreparedUnmerge }) });
		modal.onOpen();

		const prepare = modal.contentEl.querySelector<HTMLButtonElement>('[data-match-manager-prepare]')!;
		expect(prepare.disabled).toBe(true);
		prepare.click();
		await Promise.resolve();
		expect(prepareUnmerge).not.toHaveBeenCalled();

		const select = modal.contentEl.querySelector<HTMLSelectElement>('[data-match-manager-provider-select]')!;
		select.value = 'playstation';
		select.dispatchEvent(new Event('change'));
		prepare.click();
		await vi.waitFor(() => expect(prepareUnmerge).toHaveBeenCalledWith('canonical:merged', 'playstation'));
		await vi.waitFor(() => expect(onPreparedUnmerge).toHaveBeenCalledWith({ planId: 'plan:prepared', preview: { safe: true } }));
		expect(modal.contentEl.querySelector('[data-match-manager-apply]')).toBeNull();
		await vi.waitFor(() => expect(modal.contentEl.querySelector('[data-match-manager-prepared]')?.textContent).toContain('plan:prepared'));
	});

	it('sends both explicit canonical IDs for kept-separate rows', async () => {
		const allowMatchingAgain = vi.fn().mockResolvedValue(undefined);
		const modal = new MatchManagerModal({} as never, { adapter: adapter({ allowMatchingAgain }) });
		modal.onOpen();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-match-manager-tab="kept-separate"]')!.click();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-match-manager-allow]')!.click();
		await vi.waitFor(() => expect(allowMatchingAgain).toHaveBeenCalledWith('canonical:left', 'canonical:right'));
	});

	it('localizes both languages, hides raw errors, and ignores late prepare callbacks after close', async () => {
		let resolvePrepare!: (value: { planId: string; preview: unknown }) => void;
		const prepareUnmerge = vi.fn(() => new Promise<{ planId: string; preview: unknown }>((resolve) => { resolvePrepare = resolve; }));
		const modal = new MatchManagerModal({} as never, { adapter: adapter({ prepareUnmerge }) });
		modal.onOpen();
		const select = modal.contentEl.querySelector<HTMLSelectElement>('[data-match-manager-provider-select]')!;
		select.value = 'steam';
		select.dispatchEvent(new Event('change'));
		modal.contentEl.querySelector<HTMLButtonElement>('[data-match-manager-prepare]')!.click();
		modal.onClose();
		resolvePrepare({ planId: 'plan:late', preview: 'SECRET_PREVIEW' });
		await Promise.resolve();
		expect(modal.contentEl.textContent).not.toContain('SECRET_PREVIEW');

		obsidianMock.getLanguage.mockReturnValue('pl');
		const polish = new MatchManagerModal({} as never, { adapter: adapter() });
		polish.onOpen();
		expect(Array.from(polish.contentEl.querySelectorAll<HTMLElement>('[data-match-manager-tab]')).map((element) => element.textContent)).toEqual(['Scalone', 'Zachowane osobno', 'Nierozstrzygnięte']);
	});
});
