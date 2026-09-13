import { Modal, Setting, type App } from 'obsidian';
import { t } from '../../i18n';
import type { GameProvider } from '../../model/provider';
import type { GameSyncSettings } from '../../model/settings';
import { migrateState } from '../../state/migrations';
import type { GameSyncData } from '../../state/schema';
import type { StateStore } from '../../state/store';
import type { PreparedSync } from '../../sync/service';
import type { ProviderConnectionStatus } from '../../providers/provider';
import { renderTemplate } from '../../vault/template';
import { getSetupResume, nextSetupStep, previousSetupStep, SETUP_STEP_IDS, type SetupStepId } from './steps';

export interface SetupModalOptions {
	stateStore: StateStore;
	save: (state: GameSyncData) => Promise<void>;
	openConnection: (provider: GameProvider) => void;
	getConnectionStatus: (provider: GameProvider) => Promise<ProviderConnectionStatus>;
	openTemplate: () => void;
	fixTemplate: () => void;
	validateTemplate?: (templatePath: string) => void | Promise<void>;
	prepareAll: () => Promise<PreparedSync>;
	onPreparedSync: (prepared: PreparedSync) => void | Promise<void>;
}

type SetupButton = { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown };

function safeTemplateValidation(templatePath: string): void {
	if (templatePath.trim().length === 0) return;
	renderTemplate(templatePath, { title: 'Game Sync' } as never);
}

function safeConnectionLabel(status: ProviderConnectionStatus): string {
	if (status.state === 'connected') return t('setup.connections.statusConnected');
	if (status.state === 'needs-auth') return t('setup.connections.statusNeedsAuth');
	if (status.state === 'error') return t('setup.connections.statusError');
	return t('setup.connections.statusDisconnected');
}

export class SetupModal extends Modal {
	private state?: GameSyncData;
	private currentStep: SetupStepId = SETUP_STEP_IDS[0];
	private lifecycle = 0;
	private isOpen = false;
	private validationEl?: HTMLElement;
	private pending = false;
	private stepEl?: HTMLElement;

	constructor(app: App, private readonly options: SetupModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		const version = ++this.lifecycle;
		this.setTitle(t('setup.welcome.title'));
		this.contentEl.replaceChildren();
		void this.load(version);
	}

	override onClose(): void {
		this.isOpen = false;
		this.lifecycle += 1;
		this.pending = false;
	}

	private isCurrent(version: number): boolean {
		return this.isOpen && this.lifecycle === version;
	}

	private async load(version: number): Promise<void> {
		try {
			this.state = migrateState(await this.options.stateStore.load());
		} catch {
			this.state = migrateState(undefined);
		}
		if (!this.isCurrent(version) || this.state === undefined) return;
		this.currentStep = getSetupResume(this.state.settings).step;
		this.renderStep();
	}

	private settings(): GameSyncSettings {
		if (this.state === undefined) throw new Error('Setup state is not loaded.');
		return this.state.settings;
	}

	private get viewEl(): HTMLElement {
		return this.stepEl ?? this.contentEl;
	}

	private element<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
		return this.viewEl.createEl(tag);
	}

	private heading(title: string, description?: string): void {
		this.setTitle(title);
		const heading = this.element('h3');
		heading.textContent = title;
		if (description !== undefined) {
			const paragraph = this.element('p');
			paragraph.textContent = description;
		}
	}

	private status(message: string): void {
		if (this.validationEl === undefined) this.validationEl = this.element('p');
		this.validationEl.textContent = message;
	}

	private textSetting(name: string, value: string, field: keyof GameSyncSettings): void {
		new Setting(this.viewEl).setName(name).addText((component) => {
			component.inputEl.value = value;
			component.inputEl.dataset.setupField = field;
			component.inputEl.addEventListener('input', () => {
				const next = component.inputEl.value;
				if (field === 'notesFolder') this.settings().notesFolder = next;
				if (field === 'filenamePattern') this.settings().filenamePattern = next;
				if (field === 'templatePath') this.settings().templatePath = next;
				if (field === 'basePath') this.settings().basePath = next;
				if (field === 'historyPath') this.settings().historyPath = next;
				if (field === 'backgroundIntervalMinutes') this.settings().backgroundIntervalMinutes = Number(next);
			});
		});
	}

	private toggleSetting(name: string, value: boolean, onChange: (next: boolean) => void): void {
		new Setting(this.viewEl).setName(name).addToggle((component) => {
			component.setValue(value);
			component.onChange(onChange);
		});
	}

	private action(name: string, callback: () => void): void {
		new Setting(this.viewEl).addButton((button) => {
			button.setButtonText(name);
			button.onClick(callback);
		});
	}

	private navigation(): void {
		const navigation = new Setting(this.viewEl);
		const previous = previousSetupStep(this.currentStep);
		if (previous !== undefined) {
			navigation.addButton((button) => {
				button.setButtonText(t('setup.common.back'));
				button.onClick(() => {
					this.currentStep = previous;
					this.renderStep();
				});
			});
		}
		if (this.currentStep !== SETUP_STEP_IDS[6]) {
			navigation.addButton((button) => {
				button.setButtonText(t('setup.common.continue'));
				button.setCta();
				button.onClick(() => void this.advance());
			});
		}
	}

	private async advance(): Promise<void> {
		if (this.currentStep === 'providers' && !this.hasProvider()) {
			this.status(t('setup.providers.required'));
			return;
		}
		if (this.currentStep === 'vault') {
			const valid = await this.validateVault();
			if (!valid) return;
		}
		const next = nextSetupStep(this.currentStep);
		if (next === undefined) return;
		this.currentStep = next;
		this.renderStep();
	}

	private hasProvider(): boolean {
		const providers = this.settings().enabledProviders;
		return providers.steam || providers.playstation;
	}

	private async validateVault(): Promise<boolean> {
		try {
			await (this.options.validateTemplate ?? safeTemplateValidation)(this.settings().templatePath);
			return true;
		} catch {
			this.status(t('setup.vault.templateInvalid'));
			this.action(t('setup.vault.openTemplate'), this.options.openTemplate);
			this.action(t('setup.vault.fixTemplate'), this.options.fixTemplate);
			return false;
		}
	}

	private renderStep(): void {
		if (!this.isOpen || this.state === undefined) return;
		this.contentEl.replaceChildren();
		this.stepEl = this.contentEl.createDiv();
		this.stepEl.dataset.setupStepId = this.currentStep;
		this.contentEl.dataset.setupStepId = this.currentStep;
		this.validationEl = undefined;
		switch (this.currentStep) {
			case 'welcome-privacy': this.renderWelcome(); break;
			case 'providers': this.renderProviders(); break;
			case 'connections': this.renderConnections(); break;
			case 'vault': this.renderVault(); break;
			case 'library-filters': this.renderFilters(); break;
			case 'sync-behavior-history': this.renderBehavior(); break;
			case 'initial-fetch-preview': this.renderInitialFetch(); break;
		}
	}

	private renderWelcome(): void {
		this.heading(t('setup.welcome.title'));
		const privacy = this.element('p');
		privacy.textContent = t('setup.welcome.privacy');
		const secrets = this.element('p');
		secrets.textContent = t('setup.welcome.secrets');
		this.navigation();
	}

	private renderProviders(): void {
		this.heading(t('setup.providers.title'), t('setup.providers.description'));
		this.toggleSetting(t('setup.providers.steam'), this.settings().enabledProviders.steam, (value) => { this.settings().enabledProviders.steam = value; });
		this.toggleSetting(t('setup.providers.playstation'), this.settings().enabledProviders.playstation, (value) => { this.settings().enabledProviders.playstation = value; });
		this.validationEl = this.element('p');
		this.navigation();
	}

	private renderConnections(): void {
		this.heading(t('setup.connections.title'), t('setup.connections.description'));
		for (const provider of ['steam', 'playstation'] as const) {
			const key = provider === 'steam' ? 'setup.connections.openSteam' : 'setup.connections.openPlayStation';
			this.action(t(key), () => this.options.openConnection(provider));
			const status = this.element('p');
			status.dataset.setupProviderStatus = provider;
			status.textContent = t('setup.connections.statusUnknown');
			void this.loadConnectionStatus(provider, status, this.lifecycle);
		}
		this.navigation();
	}

	private async loadConnectionStatus(provider: GameProvider, statusEl: HTMLElement, version: number): Promise<void> {
		try {
			const status = await this.options.getConnectionStatus(provider);
			if (this.isCurrent(version)) statusEl.textContent = safeConnectionLabel(status);
		} catch {
			if (this.isCurrent(version)) statusEl.textContent = t('setup.connections.statusUnknown');
		}
	}

	private renderVault(): void {
		this.heading(t('setup.vault.title'));
		this.textSetting(t('setup.vault.folder'), this.settings().notesFolder, 'notesFolder');
		this.textSetting(t('setup.vault.pattern'), this.settings().filenamePattern, 'filenamePattern');
		this.textSetting(t('setup.vault.template'), this.settings().templatePath, 'templatePath');
		this.textSetting(t('setup.vault.base'), this.settings().basePath, 'basePath');
		this.toggleSetting(t('setup.vault.createBase'), this.settings().createBase, (value) => { this.settings().createBase = value; });
		this.validationEl = this.element('p');
		this.navigation();
	}

	private renderFilters(): void {
		this.heading(t('setup.filters.title'));
		this.toggleSetting(t('setup.filters.includeUnplayed'), this.settings().includeUnplayed, (value) => { this.settings().includeUnplayed = value; });
		this.toggleSetting(t('setup.filters.includeFreeToPlay'), this.settings().includeFreeToPlay, (value) => { this.settings().includeFreeToPlay = value; });
		this.toggleSetting(t('setup.filters.includePreviouslyPlayedNoLongerOwned'), this.settings().includePreviouslyPlayedNoLongerOwned, (value) => { this.settings().includePreviouslyPlayedNoLongerOwned = value; });
		this.toggleSetting(t('setup.filters.includeDemosTrials'), this.settings().includeDemosTrials, (value) => { this.settings().includeDemosTrials = value; });
		this.toggleSetting(t('setup.filters.includeBetasTestApps'), this.settings().includeBetasTestApps, (value) => { this.settings().includeBetasTestApps = value; });
		this.navigation();
	}

	private renderBehavior(): void {
		this.heading(t('setup.behavior.title'));
		new Setting(this.viewEl).setName(t('setup.behavior.previewMode')).addDropdown((component) => {
			component.addOption('always', t('setup.behavior.previewAlways'));
			component.addOption('first-and-review', t('setup.behavior.previewFirst'));
			component.addOption('review-only', t('setup.behavior.previewReview'));
			component.setValue(this.settings().previewMode);
			component.onChange((value) => { this.settings().previewMode = value as GameSyncSettings['previewMode']; });
		});
		this.toggleSetting(t('setup.behavior.backgroundSync'), this.settings().backgroundSync, (value) => { this.settings().backgroundSync = value; });
		this.toggleSetting(t('setup.behavior.recordHistory'), this.settings().recordHistory, (value) => { this.settings().recordHistory = value; });
		this.textSetting(t('setup.behavior.backgroundInterval'), String(this.settings().backgroundIntervalMinutes), 'backgroundIntervalMinutes');
		this.textSetting(t('setup.behavior.historyPath'), this.settings().historyPath, 'historyPath');
		this.navigation();
	}

	private renderInitialFetch(): void {
		this.heading(t('setup.initialFetch.title'), t('setup.initialFetch.description'));
		new Setting(this.viewEl).addButton((button) => {
			button.setButtonText(t('setup.initialFetch.fetch')).setCta();
			button.onClick(() => void this.prepareInitialSync(button));
		});
	}

	private async prepareInitialSync(button: SetupButton): Promise<void> {
		if (this.pending || !this.isOpen || this.state === undefined) return;
		const version = this.lifecycle;
		this.pending = true;
		button.setDisabled(true);
		this.status(t('setup.initialFetch.preparing'));
		const nextState = migrateState(this.state);
		nextState.settings.setupCompleted = true;
		try {
			await this.options.save(nextState);
		} catch {
			if (this.isCurrent(version)) {
				this.status(t('setup.initialFetch.saveFailed'));
				this.pending = false;
				button.setDisabled(false);
			}
			return;
		}
		if (!this.isCurrent(version)) return;
		this.state = nextState;
		try {
			const prepared = await this.options.prepareAll();
			if (!this.isCurrent(version)) return;
			await this.options.onPreparedSync(prepared);
		} catch {
			if (this.isCurrent(version)) this.status(t('setup.initialFetch.prepareFailed'));
		} finally {
			if (this.isCurrent(version)) {
				this.pending = false;
				button.setDisabled(false);
			}
		}
	}
}
