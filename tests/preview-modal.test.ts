/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Operation } from '../src/model/operations';
import type { PreparedSync } from '../src/sync/service';

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
		setDesc(_value: string): this { return this; }
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
		addToggle(callback: (component: { toggleEl: HTMLInputElement; setValue(value: boolean): unknown; setDisabled(value: boolean): unknown; onChange(handler: (value: boolean) => unknown): unknown }) => unknown): this {
			const toggleEl = document.createElement('input');
			toggleEl.type = 'checkbox';
			this.settingEl.append(toggleEl);
			const component = {
				toggleEl,
				setValue: (value: boolean) => { toggleEl.checked = value; return component; },
				setDisabled: (value: boolean) => { toggleEl.disabled = value; return component; },
				onChange: (handler: (value: boolean) => unknown) => { toggleEl.addEventListener('change', () => void handler(toggleEl.checked)); return component; },
			};
			callback(component);
			return this;
		}
	}

	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { PreviewModal } = await import('../src/ui/preview-modal');

function operation(id: string, canonicalGameId: string, kind: Operation['kind'] = 'create-note', risk: Operation['risk'] = 'safe'): Operation {
	return {
		id,
		canonicalGameId,
		kind,
		risk,
		path: `Games/${id}.md`,
		summary: `${kind} ${id}`,
		planRevision: 'revision:test',
		expectedNoteFingerprint: kind === 'create-note' ? null : 'fingerprint',
	} as Operation;
}

function prepared(overrides: Partial<PreparedSync> = {}): PreparedSync {
	const operations = [
		operation('new-safe', 'new', 'create-note', 'safe'),
		operation('adopt-safe', 'adopt', 'adopt-note', 'safe'),
		operation('update-safe', 'update', 'update-properties', 'safe'),
		operation('review-op', 'review', 'update-properties', 'review'),
	];
	const statuses = [
		{ canonicalGameId: 'new', status: 'create' as const, path: 'Games/new-safe.md' },
		{ canonicalGameId: 'adopt', status: 'adopt' as const, path: 'Games/adopt-safe.md' },
		{ canonicalGameId: 'update', status: 'update' as const, path: 'Games/update-safe.md' },
		{ canonicalGameId: 'review', status: 'review' as const, path: 'Games/review.md', reason: 'Candidate requires review.' },
		{ canonicalGameId: 'unchanged', status: 'unchanged' as const, path: 'Games/unchanged.md' },
		{ canonicalGameId: 'conflict', status: 'conflict' as const, path: 'Games/conflict.md', reason: 'Path collision.' },
		{ canonicalGameId: 'ignored', status: 'ignored' as const, path: 'Games/ignored.md' },
	];
	return {
		plan: { id: 'plan:test', planRevision: 'revision:test', operations, expectedNoteFingerprints: {}, statuses, games: [] },
		games: [],
		providerStatuses: {
			steam: { provider: 'steam', state: 'success', gamesFetched: 7 },
			playstation: { provider: 'playstation', state: 'success', gamesFetched: 3 },
		},
		providerResults: {},
		gamesFetched: 10,
		operationsCreated: operations.length,
		warnings: ['A provider used cached data.'],
		reviewRequiredCount: 2,
		ignored: 1,
		previewRequired: true,
		...overrides,
	};
}

describe('PreviewModal', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('renders exactly the seven categories and groups statuses, games, and operations by canonical id', () => {
		const modal = new PreviewModal({} as never, { prepared: prepared(), onApply: vi.fn(), onReviewDecision: vi.fn() });
		modal.onOpen();

		expect(Array.from(modal.contentEl.querySelectorAll<HTMLElement>('[data-preview-category]')).map((element) => element.textContent)).toEqual([
			'All', 'New', 'Adopt', 'Update', 'Matches', 'Conflicts', 'Skipped',
		]);
		expect(modal.contentEl.querySelectorAll('[data-preview-group]')).toHaveLength(7);
		expect(modal.contentEl.querySelector('[data-preview-group="review"]')).not.toBeNull();
		expect(modal.contentEl.querySelector('[data-preview-group="unchanged"]')).not.toBeNull();
	});

	it('searches and filters without changing operation selection, and select visible all/none only', () => {
		const modal = new PreviewModal({} as never, { prepared: prepared(), onApply: vi.fn(), onReviewDecision: vi.fn() });
		modal.onOpen();
		const search = modal.contentEl.querySelector<HTMLInputElement>('[data-preview-search]')!;
		const safeCheckbox = modal.contentEl.querySelector<HTMLInputElement>('[data-preview-operation="new-safe"]')!;
		expect(safeCheckbox.checked).toBe(true);

		search.value = 'review';
		search.dispatchEvent(new Event('input'));
		expect(modal.contentEl.querySelector('[data-preview-group="new"]') as HTMLElement).toHaveProperty('hidden', true);
		expect(safeCheckbox.checked).toBe(true);
		modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-select-visible="none"]')!.click();
		expect(modal.contentEl.querySelector<HTMLInputElement>('[data-preview-operation="review-op"]')!.checked).toBe(false);
		expect(safeCheckbox.checked).toBe(true);

		search.value = '';
		search.dispatchEvent(new Event('input'));
		modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-select-visible="none"]')!.click();
		expect(Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('[data-preview-operation]')).every((input) => !input.checked)).toBe(true);
		modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-select-visible="all"]')!.click();
		expect(modal.contentEl.querySelector<HTMLInputElement>('[data-preview-operation="new-safe"]')!.checked).toBe(true);
		expect(modal.contentEl.querySelector<HTMLInputElement>('[data-preview-operation="review-op"]')!.checked).toBe(true);
	});

	it('uses safe-only defaults and exposes a partial group checkbox', () => {
		const modal = new PreviewModal({} as never, { prepared: prepared(), onApply: vi.fn(), onReviewDecision: vi.fn() });
		modal.onOpen();
		const reviewGroupCheckbox = modal.contentEl.querySelector<HTMLInputElement>('[data-preview-group-checkbox="review"]')!;
		expect(reviewGroupCheckbox.checked).toBe(false);
		expect(reviewGroupCheckbox.indeterminate).toBe(false);
		const reviewOperation = modal.contentEl.querySelector<HTMLInputElement>('[data-preview-operation="review-op"]')!;
		reviewOperation.checked = true;
		reviewOperation.dispatchEvent(new Event('change'));
		expect(reviewGroupCheckbox.checked).toBe(true);

		const mixedGroup = new PreviewModal({} as never, {
			prepared: prepared({ plan: { ...prepared().plan, statuses: [{ canonicalGameId: 'mixed', status: 'update' as const }], operations: [operation('mixed-safe', 'mixed'), operation('mixed-review', 'mixed', 'update-properties', 'review')] } }),
			onApply: vi.fn(),
			onReviewDecision: vi.fn(),
		});
		mixedGroup.onOpen();
		const checkbox = mixedGroup.contentEl.querySelector<HTMLInputElement>('[data-preview-group-checkbox="mixed"]')!;
		expect(checkbox.checked).toBe(false);
		expect(checkbox.indeterminate).toBe(true);
	});

	it('blocks apply globally for hidden review/conflict, never auto-applies, and sends review actions only to the host', async () => {
		const onApply = vi.fn();
		const onReviewDecision = vi.fn().mockResolvedValue(undefined);
		const modal = new PreviewModal({} as never, { prepared: prepared(), onApply, onReviewDecision });
		modal.onOpen();
		expect(onApply).not.toHaveBeenCalled();
		expect(modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-apply]')!.disabled).toBe(true);
		modal.contentEl.querySelector<HTMLInputElement>('[data-preview-search]')!.value = 'new';
		modal.contentEl.querySelector<HTMLInputElement>('[data-preview-search]')!.dispatchEvent(new Event('input'));
		const reviewAction = modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-review-action="merge:review"]')!;
		reviewAction.click();
		await Promise.resolve();
		expect(onReviewDecision).toHaveBeenCalledWith({ planId: 'plan:test', canonicalGameId: 'review', action: 'merge', candidatePath: 'Games/review.md' });
		expect(onApply).not.toHaveBeenCalled();
	});

	it('ignores late callbacks after close and calls onClose once', async () => {
		let resolveApply!: () => void;
		const onApply = vi.fn(() => new Promise<void>((resolve) => { resolveApply = resolve; }));
		const onClose = vi.fn();
		const modal = new PreviewModal({} as never, { prepared: prepared({ plan: { ...prepared().plan, statuses: [{ canonicalGameId: 'new', status: 'create' as const }], operations: [operation('new-safe', 'new')] }, reviewRequiredCount: 0 }), onApply, onReviewDecision: vi.fn(), onClose });
		modal.onOpen();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-apply]')!.click();
		modal.onClose();
		resolveApply();
		await Promise.resolve();
		expect(onApply).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-apply]')?.click();
		expect(onApply).toHaveBeenCalledTimes(1);
	});

	it('renders Polish category labels', () => {
		obsidianMock.getLanguage.mockReturnValue('pl');
		const modal = new PreviewModal({} as never, { prepared: prepared(), onApply: vi.fn(), onReviewDecision: vi.fn() });
		modal.onOpen();
		expect(Array.from(modal.contentEl.querySelectorAll<HTMLElement>('[data-preview-category]')).map((element) => element.textContent)).toEqual([
			'Wszystkie', 'Nowe', 'Przejmowane', 'Aktualizowane', 'Dopasowania', 'Konflikty', 'Pominięte',
		]);
	});
});
