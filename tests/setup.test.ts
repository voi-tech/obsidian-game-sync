/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateState } from '../src/state/migrations';
import type { GameSyncData } from '../src/state/schema';
import type { ProviderConnectionStatus } from '../src/providers/provider';
import type { PreparedSync } from '../src/sync/service';

const obsidianMock = vi.hoisted(() => {
	class Modal {
		app: unknown;
		contentEl: HTMLElement;
		titleEl: HTMLElement;
		constructor(app: unknown) {
			this.app = app;
			this.contentEl = document.createElement('div');
			const attachCreateEl = (container: HTMLElement): void => {
				Object.defineProperty(container, 'createEl', { value: (tag: string): HTMLElement => {
					const element = document.createElement(tag);
					attachCreateEl(element);
					container.append(element);
					return element;
				} });
				Object.defineProperty(container, 'createDiv', { value: (): HTMLElement => container.createEl('div') });
			};
			attachCreateEl(this.contentEl);
			this.titleEl = document.createElement('h2');
		}
		setTitle(title: string): this {
			this.titleEl.textContent = title;
			return this;
		}
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
			this.settingEl = document.createElement('div');
			this.nameEl = document.createElement('span');
			this.descEl = document.createElement('span');
			this.controlEl = document.createElement('div');
			this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
			containerEl.append(this.settingEl);
		}
		setName(name: string): this { this.nameEl.textContent = name; return this; }
		setDesc(desc: string): this { this.descEl.textContent = desc; return this; }
		addText(callback: (component: { inputEl: HTMLInputElement; setPlaceholder(value: string): unknown }) => unknown): this {
			const inputEl = document.createElement('input');
			this.controlEl.append(inputEl);
			callback({ inputEl, setPlaceholder: (value: string) => { inputEl.placeholder = value; } });
			return this;
		}
		addToggle(callback: (component: { toggleEl: HTMLInputElement; setValue(value: boolean): unknown; onChange(handler: (value: boolean) => unknown): unknown }) => unknown): this {
			const toggleEl = document.createElement('input');
			toggleEl.type = 'checkbox';
			this.controlEl.append(toggleEl);
			callback({
				toggleEl,
				setValue: (value: boolean) => { toggleEl.checked = value; },
				onChange: (handler: (value: boolean) => unknown) => { toggleEl.addEventListener('change', () => void handler(toggleEl.checked)); },
			});
			return this;
		}
		addDropdown(callback: (component: { selectEl: HTMLSelectElement; addOption(value: string, label: string): unknown; setValue(value: string): unknown; onChange(handler: (value: string) => unknown): unknown }) => unknown): this {
			const selectEl = document.createElement('select');
			this.controlEl.append(selectEl);
			callback({
				selectEl,
				addOption: (value: string, label: string) => { selectEl.add(new Option(label, value)); },
				setValue: (value: string) => { selectEl.value = value; },
				onChange: (handler: (value: string) => unknown) => { selectEl.addEventListener('change', () => void handler(selectEl.value)); },
			});
			return this;
		}
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this {
			const buttonEl = document.createElement('button');
			this.controlEl.append(buttonEl);
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

const { SETUP_STEP_IDS, canAdvanceSetupStep, getSetupResume, nextSetupStep } = await import('../src/ui/setup/steps');
const { SetupModal } = await import('../src/ui/setup/setup-modal');

function connection(provider: 'steam' | 'playstation', state: ProviderConnectionStatus['state'] = 'connected'): ProviderConnectionStatus {
	return { provider, state, connected: state === 'connected' };
}

function setupFixture(overrides: Partial<ConstructorParameters<typeof SetupModal>[1]> = {}) {
	let state = migrateState(undefined);
	const saved: GameSyncData[] = [];
	let resolvePrepare!: (value: PreparedSync) => void;
	const prepareAll = vi.fn<() => Promise<PreparedSync>>(() => new Promise<PreparedSync>((resolve) => { resolvePrepare = resolve; }));
	const options = {
		stateStore: { load: vi.fn(async () => state), save: vi.fn(async (next: GameSyncData) => { state = next; }) },
		save: vi.fn(async (next: GameSyncData) => { state = next; saved.push(next); }),
		openConnection: vi.fn(),
		getConnectionStatus: vi.fn(async (provider: 'steam' | 'playstation') => connection(provider)),
		openTemplate: vi.fn(),
		fixTemplate: vi.fn(),
		validateTemplate: vi.fn((template: string) => { if (template.includes('INVALID')) throw new Error('raw-template-error'); }),
		prepareAll,
		onPreparedSync: vi.fn(),
		...overrides,
	};
	return { options, saved, getState: () => state, resolvePrepare: (value: PreparedSync) => resolvePrepare(value), modal: new SetupModal({} as never, options) };
}

function buttons(modal: InstanceType<typeof SetupModal>): HTMLButtonElement[] {
	return Array.from(modal.contentEl.querySelectorAll('button'));
}

function buttonWithText(modal: InstanceType<typeof SetupModal>, text: string): HTMLButtonElement {
	const button = buttons(modal).find((candidate) => candidate.textContent === text);
	if (button === undefined) throw new Error(`Missing button ${text}`);
	return button;
}

async function continueStep(modal: InstanceType<typeof SetupModal>): Promise<void> {
	buttonWithText(modal, 'Continue').click();
	await Promise.resolve();
	await Promise.resolve();
}

function enableSteam(modal: InstanceType<typeof SetupModal>): void {
	const toggle = modal.contentEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
	toggle.checked = true;
	toggle.dispatchEvent(new Event('change'));
}

describe('setup wizard', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		vi.clearAllMocks();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('defines exactly seven typed steps and deterministic transitions', () => {
		expect(SETUP_STEP_IDS).toHaveLength(7);
		expect(nextSetupStep(SETUP_STEP_IDS[0])).toBe(SETUP_STEP_IDS[1]);
		expect(nextSetupStep(SETUP_STEP_IDS[5])).toBe(SETUP_STEP_IDS[6]);
		expect(nextSetupStep(SETUP_STEP_IDS[6])).toBeUndefined();
		expect(canAdvanceSetupStep('providers', { hasProvider: false, templateValid: true })).toBe(false);
		expect(canAdvanceSetupStep('providers', { hasProvider: true, templateValid: true })).toBe(true);
		expect(canAdvanceSetupStep('vault', { hasProvider: true, templateValid: false })).toBe(false);
	});

	it('resumes initial fetch only after configuration save and opens editing after first sync', () => {
		expect(getSetupResume({ setupCompleted: false, firstSyncCompleted: false })).toEqual({ mode: 'setup', step: 'welcome-privacy' });
		expect(getSetupResume({ setupCompleted: true, firstSyncCompleted: false })).toEqual({ mode: 'initial-fetch-preview', step: 'initial-fetch-preview' });
		expect(getSetupResume({ setupCompleted: true, firstSyncCompleted: true })).toEqual({ mode: 'edit', step: 'welcome-privacy' });
	});

	it('validates providers and does not expose connection credentials in the wizard', async () => {
		const fixture = setupFixture();
		vi.spyOn(fixture.options, 'getConnectionStatus').mockRejectedValue(new Error('NPSSO_TEST_SECRET'));
		fixture.modal.onOpen();
		await vi.waitFor(() => expect(fixture.modal.contentEl.querySelector('[data-setup-step-id]')).not.toBeNull());
		await continueStep(fixture.modal);
		await continueStep(fixture.modal);
		expect(fixture.modal.contentEl.textContent).toContain('Select at least one provider.');
		const steamToggle = fixture.modal.contentEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
		steamToggle.checked = true;
		steamToggle.dispatchEvent(new Event('change'));
		await continueStep(fixture.modal);
		expect(fixture.modal.contentEl.dataset.setupStepId).toBe('connections');
		await vi.waitFor(() => expect(fixture.modal.contentEl.textContent).toContain('Status unavailable'));
		expect(fixture.modal.contentEl.querySelectorAll('input[type="password"]')).toHaveLength(0);
		expect(fixture.modal.contentEl.textContent).not.toMatch(/api.key|npsso|refresh.token|NPSSO_TEST_SECRET/i);
	});

	it('shows a localized template warning and uses injected open/fix actions without raw errors', async () => {
		const fixture = setupFixture();
		fixture.modal.onOpen();
		await vi.waitFor(() => expect(fixture.modal.contentEl.dataset.setupStepId).toBe('welcome-privacy'));
		for (let index = 0; index < 3; index += 1) {
			if (fixture.modal.contentEl.dataset.setupStepId === 'providers') enableSteam(fixture.modal);
			await continueStep(fixture.modal);
		}
		const templateInput = fixture.modal.contentEl.querySelector('[data-setup-field="templatePath"]') as HTMLInputElement;
		templateInput.value = 'INVALID';
		templateInput.dispatchEvent(new Event('input'));
		await continueStep(fixture.modal);
		expect(fixture.modal.contentEl.textContent).toContain('The template could not be validated.');
		expect(fixture.modal.contentEl.textContent).not.toContain('raw-template-error');
		buttonWithText(fixture.modal, 'Open template').click();
		buttonWithText(fixture.modal, 'Fix template').click();
		expect(fixture.options.openTemplate).toHaveBeenCalledTimes(1);
		expect(fixture.options.fixTemplate).toHaveBeenCalledTimes(1);
	});

	it('saves setupCompleted before preparing the initial preview and never auto-applies', async () => {
		const fixture = setupFixture();
		fixture.modal.onOpen();
		await vi.waitFor(() => expect(fixture.modal.contentEl.dataset.setupStepId).toBe('welcome-privacy'));
		for (let index = 0; index < 6; index += 1) {
			if (fixture.modal.contentEl.dataset.setupStepId === 'providers') enableSteam(fixture.modal);
			await continueStep(fixture.modal);
		}
		expect(fixture.modal.contentEl.dataset.setupStepId).toBe('initial-fetch-preview');
		buttonWithText(fixture.modal, 'Fetch and preview').click();
		await vi.waitFor(() => expect(fixture.options.save).toHaveBeenCalledTimes(1));
		expect(fixture.getState().settings.setupCompleted).toBe(true);
		await vi.waitFor(() => expect(fixture.options.prepareAll).toHaveBeenCalledTimes(1));
		fixture.resolvePrepare({ plan: { operations: [] } } as unknown as PreparedSync);
		await vi.waitFor(() => expect(fixture.options.onPreparedSync).toHaveBeenCalledTimes(1));
		expect(fixture.options).not.toHaveProperty('applySelection');
	});

	it('ignores a late prepared result after close', async () => {
		const fixture = setupFixture();
		fixture.modal.onOpen();
		await vi.waitFor(() => expect(fixture.modal.contentEl.dataset.setupStepId).toBe('welcome-privacy'));
		for (let index = 0; index < 6; index += 1) {
			if (fixture.modal.contentEl.dataset.setupStepId === 'providers') enableSteam(fixture.modal);
			await continueStep(fixture.modal);
		}
		buttonWithText(fixture.modal, 'Fetch and preview').click();
		await vi.waitFor(() => expect(fixture.options.prepareAll).toHaveBeenCalledTimes(1));
		fixture.modal.onClose();
		fixture.resolvePrepare({ plan: { operations: [] } } as unknown as PreparedSync);
		await Promise.resolve();
		await Promise.resolve();
		expect(fixture.options.onPreparedSync).not.toHaveBeenCalled();
	});

	it('renders both supported languages', async () => {
		for (const language of ['en', 'pl']) {
			obsidianMock.getLanguage.mockReturnValue(language);
			const fixture = setupFixture();
			fixture.modal.onOpen();
			await vi.waitFor(() => expect(fixture.modal.contentEl.dataset.setupStepId).toBe('welcome-privacy'));
			expect(fixture.modal.contentEl.textContent).not.toContain('setup.welcome.title');
			fixture.modal.onClose();
		}
	});
});
