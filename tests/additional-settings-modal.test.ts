/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import { DEFAULT_PROPERTY_MAPPING } from '../src/model/property-mapping';
import { PROPERTY_MAPPING_GROUPS } from '../src/ui/settings/property-settings';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement {
		Object.defineProperties(element, {
			createEl: { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } },
			createDiv: { value: () => { const child = decorate(document.createElement('div')); element.append(child); return child; } },
		});
		return element;
	}

	class Modal {
		contentEl: HTMLElement;
		titleEl: HTMLElement;
		constructor(public readonly app: unknown) { this.contentEl = decorate(document.createElement('div')); this.titleEl = document.createElement('h2'); }
		setTitle(title: string): this { this.titleEl.textContent = title; return this; }
		close(): void { this.onClose(); }
		onOpen(): void {}
		onClose(): void {}
	}

	class Setting {
		settingEl: HTMLElement;
		nameEl: HTMLElement;
		descEl: HTMLElement;
		controlEl: HTMLElement;
		constructor(containerEl: HTMLElement) {
			this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item';
			this.nameEl = document.createElement('div'); this.descEl = document.createElement('div'); this.controlEl = document.createElement('div');
			this.settingEl.append(this.nameEl, this.descEl, this.controlEl); containerEl.append(this.settingEl);
		}
		setName(value: string): this { this.nameEl.textContent = value; this.settingEl.dataset.settingName = value; return this; }
		setDesc(value: string): this { this.descEl.textContent = value; this.settingEl.dataset.settingDescription = value; return this; }
		setHeading(): this { return this; }
		addText(callback: (component: { inputEl: HTMLInputElement; setPlaceholder(value: string): unknown; onChange(handler: (value: string) => unknown): unknown }) => unknown): this {
			const inputEl = document.createElement('input'); this.controlEl.append(inputEl);
			const component = { inputEl, setPlaceholder: (value: string) => { inputEl.placeholder = value; return component; }, onChange: (handler: (value: string) => unknown) => { inputEl.addEventListener('change', () => void handler(inputEl.value)); return component; } };
			callback(component); return this;
		}
		addToggle(callback: (component: { toggleEl: HTMLInputElement; setValue(value: boolean): unknown; onChange(handler: (value: boolean) => unknown): unknown }) => unknown): this {
			const toggleEl = document.createElement('input'); toggleEl.type = 'checkbox'; this.controlEl.append(toggleEl);
			const component = { toggleEl, setValue: (value: boolean) => { toggleEl.checked = value; return component; }, onChange: (handler: (value: boolean) => unknown) => { toggleEl.addEventListener('change', () => void handler(toggleEl.checked)); return component; } };
			callback(component); return this;
		}
		addDropdown(callback: (component: { selectEl: HTMLSelectElement; addOption(value: string, label: string): unknown; setValue(value: string): unknown; onChange(handler: (value: string) => unknown): unknown }) => unknown): this {
			const selectEl = document.createElement('select'); this.controlEl.append(selectEl);
			const component = { selectEl, addOption: (value: string, label: string) => { const option = document.createElement('option'); option.value = value; option.textContent = label; selectEl.append(option); return component; }, setValue: (value: string) => { selectEl.value = value; return component; }, onChange: (handler: (value: string) => unknown) => { selectEl.addEventListener('change', () => void handler(selectEl.value)); return component; } };
			callback(component); return this;
		}
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this {
			const buttonEl = document.createElement('button'); this.controlEl.append(buttonEl);
			const component = { buttonEl, setButtonText: (value: string) => { buttonEl.textContent = value; return component; }, setCta: () => component, setDisabled: (value: boolean) => { buttonEl.disabled = value; return component; }, onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; } };
			callback(component); return this;
		}
	}

	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { AdditionalSettingsModal } = await import('../src/ui/settings/additional-settings-modal');

function fixture() {
	const current = structuredClone(DEFAULT_SETTINGS);
	const mapping: Record<string, string | null | false> = {};
	const host = {
		readSettings: vi.fn(async () => structuredClone(current)),
		writeSettings: vi.fn(async (settings: typeof current) => { Object.assign(current, structuredClone(settings)); }),
		readPropertyMapping: vi.fn(async () => structuredClone(mapping)),
		writePropertyMapping: vi.fn(async (next: typeof mapping) => { Object.assign(mapping, structuredClone(next)); }),
		openIgnoredGames: vi.fn(),
		openMatchManager: vi.fn(),
		copyDiagnostics: vi.fn(),
	};
	return { current, host, modal: new AdditionalSettingsModal({} as never, host) };
}

function buttons(modal: InstanceType<typeof AdditionalSettingsModal>): HTMLButtonElement[] { return Array.from(modal.contentEl.querySelectorAll('button')); }

async function open(modal: InstanceType<typeof AdditionalSettingsModal>): Promise<void> {
	modal.onOpen();
	await vi.waitFor(() => expect(modal.contentEl.querySelector('[data-additional-settings]')).not.toBeNull());
}

describe('Additional settings', () => {
	beforeEach(() => { document.body.replaceChildren(); obsidianMock.getLanguage.mockReturnValue('en'); });

	it('starts as a short launcher instead of rendering every advanced field', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		expect(fixtureData.modal.titleEl.textContent).toBe('Additional settings');
		expect(fixtureData.modal.contentEl.textContent).toContain('Library filters');
		expect(fixtureData.modal.contentEl.textContent).toContain('Game matches');
		expect(fixtureData.modal.contentEl.textContent).not.toContain('Include unplayed games');
		expect(fixtureData.modal.contentEl.querySelector('[data-settings-field="metadataLanguage"]')).toBeNull();
		expect(buttons(fixtureData.modal).map((button) => button.textContent)).toEqual(['Configure', 'Configure', 'Configure', 'Configure', 'Configure', 'Manage', 'Manage', 'Open']);
	});

	it('shows only library filters inside their focused view and returns to the launcher', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[0].click();
		expect(fixtureData.modal.contentEl.querySelector('[data-additional-view="library"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelectorAll('[data-settings-field^="include"]').length).toBe(5);
		expect(fixtureData.modal.contentEl.querySelector('[data-settings-field="metadataLanguage"]')).toBeNull();
		fixtureData.modal.contentEl.querySelector<HTMLButtonElement>('[data-additional-back]')!.click();
		expect(fixtureData.modal.contentEl.querySelector('[data-additional-settings]')).not.toBeNull();
	});

	it('keeps metadata controls together without library or history controls', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[2].click();
		expect(fixtureData.modal.contentEl.querySelector('[data-additional-view="metadata"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelectorAll('[data-settings-field="metadataLanguage"], [data-settings-field="metadataPreference"]').length).toBe(2);
		expect(fixtureData.modal.contentEl.querySelectorAll('[data-settings-field="showAchievementRarity"], [data-settings-field="showTrophyType"], [data-settings-field="showUnlockDate"]').length).toBe(3);
		expect(fixtureData.modal.contentEl.querySelector('[data-settings-field="includeUnplayed"]')).toBeNull();
	});

	it('exposes optional platform data separately from library settings', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[3].click();
		expect(fixtureData.modal.contentEl.querySelector('[data-settings-field="steamEnricherEnabled"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelector('[data-settings-field="playstationEnricherEnabled"]')).not.toBeNull();
	});

	it('reveals the history path only after enabling history', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[4].click();
		expect(fixtureData.modal.contentEl.querySelector('[data-settings-field="historyPath"]')).toBeNull();
		const toggle = fixtureData.modal.contentEl.querySelector<HTMLInputElement>('[data-settings-field="recordHistory"]')!;
		toggle.checked = true;
		toggle.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(fixtureData.modal.contentEl.querySelector('[data-settings-field="historyPath"]')).not.toBeNull());
		expect(fixtureData.modal.contentEl.querySelector<HTMLInputElement>('[data-settings-field="historyPath"]')?.placeholder).toBe('archive/game-sync/game-events.jsonl');
	});

	it('opens the existing managers and diagnostics action from the launcher', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[5].click();
		buttons(fixtureData.modal)[6].click();
		buttons(fixtureData.modal)[7].click();
		expect(fixtureData.host.openIgnoredGames).toHaveBeenCalledOnce();
		expect(fixtureData.host.openMatchManager).toHaveBeenCalledOnce();
		expect(fixtureData.host.copyDiagnostics).toHaveBeenCalledOnce();
	});

	it('loads property mapping only after opening its focused view', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		expect(fixtureData.host.readPropertyMapping).not.toHaveBeenCalled();
		buttons(fixtureData.modal)[1].click();
		await vi.waitFor(() => expect(fixtureData.host.readPropertyMapping).toHaveBeenCalledOnce());
		expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="title"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="gameSyncId"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="steamId"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelectorAll('[data-property-destination]')).toHaveLength(Object.keys(DEFAULT_PROPERTY_MAPPING).length);
		expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="igdbId"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="gametrackId"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="steamAchievementsTotal"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="updated"]')).not.toBeNull();
		expect(fixtureData.modal.contentEl.querySelectorAll('[data-property-mapping-group]')).toHaveLength(PROPERTY_MAPPING_GROUPS.length);
	});

	it('shows a concrete example beside each mapped attribute', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[1].click();
		await vi.waitFor(() => expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="title"]')).not.toBeNull());
		expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="title"]')?.closest('.setting-item')?.textContent).toContain('Example: Dead Space');
	});

	it('does not render an enable toggle for attribute mappings', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[1].click();
		await vi.waitFor(() => expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="title"]')).not.toBeNull());
		expect(fixtureData.modal.contentEl.querySelector('[data-property-enabled]')).toBeNull();
	});

	it('persists an arbitrary destination across reopening the property view', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[1].click();
		await vi.waitFor(() => expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="title"]')).not.toBeNull());
		const input = fixtureData.modal.contentEl.querySelector<HTMLInputElement>('[data-property-destination="title"]')!;
		input.value = 'game-title';
		input.dispatchEvent(new Event('input'));
		await vi.waitFor(() => expect(fixtureData.host.writePropertyMapping).toHaveBeenCalledWith(expect.objectContaining({ title: 'game-title' })));
		fixtureData.modal.onClose();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[1].click();
		await vi.waitFor(() => expect(fixtureData.modal.contentEl.querySelector<HTMLInputElement>('[data-property-destination="title"]')?.value).toBe('game-title'));
	});

	it('treats an empty destination as a disabled mapping and persists it', async () => {
		const fixtureData = fixture();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[1].click();
		await vi.waitFor(() => expect(fixtureData.modal.contentEl.querySelector('[data-property-destination="title"]')).not.toBeNull());
		const input = fixtureData.modal.contentEl.querySelector<HTMLInputElement>('[data-property-destination="title"]')!;
		input.value = '';
		input.dispatchEvent(new Event('input'));
		await vi.waitFor(() => expect(fixtureData.host.writePropertyMapping).toHaveBeenCalledWith(expect.objectContaining({ title: null })));
		fixtureData.modal.onClose();
		await open(fixtureData.modal);
		buttons(fixtureData.modal)[1].click();
		await vi.waitFor(() => expect(fixtureData.modal.contentEl.querySelector<HTMLInputElement>('[data-property-destination="title"]')?.value).toBe(''));
	});
});
