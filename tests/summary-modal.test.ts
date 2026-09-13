/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Operation } from '../src/model/operations';
import type { SyncApplyResult } from '../src/sync/service';

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
			containerEl.append(this.settingEl);
		}
		setName(value: string): this { this.settingEl.dataset.settingName = value; return this; }
		setDesc(value: string): this { this.settingEl.dataset.settingDescription = value; return this; }
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

const { SummaryModal } = await import('../src/ui/summary-modal');

function operation(id: string, kind: Operation['kind']): Operation {
	return { id, canonicalGameId: id, kind, risk: 'safe', path: `Games/${id}.md`, summary: kind, planRevision: 'revision:test', expectedNoteFingerprint: kind === 'create-note' ? null : 'fingerprint' } as Operation;
}

function result(): SyncApplyResult {
	const operations = [operation('created', 'create-note'), operation('updated', 'update-properties'), operation('planned-only', 'create-note')];
	return {
		plan: { id: 'plan:test', planRevision: 'revision:test', operations, expectedNoteFingerprints: {}, statuses: [], games: [] },
		providerStatuses: {
			steam: { provider: 'steam', state: 'success', gamesFetched: 8 },
			playstation: { provider: 'playstation', state: 'partial', gamesFetched: 4, error: { code: 'partial', message: 'Some games were unavailable.' } },
		},
		gamesFetched: 12,
		operationsCreated: 3,
		operationsApplied: 2,
		operationsAppliedIds: ['created', 'updated'],
		pendingOperationIds: ['planned-only'],
		deselectedOperationIds: ['planned-only'],
		deselected: 1,
		ignored: 2,
		warnings: ['Partial provider data remains pending.'],
		reviewRequiredCount: 0,
	};
}

describe('SummaryModal', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('keeps Steam and PlayStation statuses separate and counts only applied operation kinds', () => {
		const modal = new SummaryModal({} as never, { result: result() });
		modal.onOpen();
		expect(modal.contentEl.querySelector('[data-summary-provider="steam"]')?.textContent).toContain('Completed');
		expect(modal.contentEl.querySelector('[data-summary-provider="playstation"]')?.textContent).toContain('Partially completed');
		expect(modal.contentEl.querySelector('[data-summary-notes-created]')?.textContent).toContain('1');
		expect(modal.contentEl.querySelector('[data-summary-notes-updated]')?.textContent).toContain('1');
		expect(modal.contentEl.querySelector('[data-summary-notes-created]')?.textContent).not.toContain('2');
	});

	it('shows ignored, deselected, pending and warnings distinctly', () => {
		const modal = new SummaryModal({} as never, { result: result() });
		modal.onOpen();
		expect(modal.contentEl.querySelector('[data-summary-ignored]')?.textContent).toContain('2');
		expect(modal.contentEl.querySelector('[data-summary-deselected]')?.textContent).toContain('1');
		expect(modal.contentEl.querySelector('[data-summary-pending]')?.textContent).toContain('1');
		expect(modal.contentEl.querySelector('[data-summary-warning]')?.textContent).toContain('Partial provider data remains pending.');
	});

	it('renders an unlocked count only when the explicit view model supplies it', () => {
		const withoutCount = new SummaryModal({} as never, { result: result() });
		withoutCount.onOpen();
		expect(withoutCount.contentEl.querySelector('[data-summary-unlocked]')).toBeNull();

		const withCount = new SummaryModal({} as never, {
			viewModel: {
				providerStatuses: result().providerStatuses,
				gamesFetched: 1,
				operations: result().plan.operations,
				appliedOperationIds: ['created'],
				pendingOperationIds: [],
				deselectedOperationIds: [],
				ignored: 0,
				warnings: [],
				unlockedCount: 3,
			},
		});
		withCount.onOpen();
		expect(withCount.contentEl.querySelector('[data-summary-unlocked]')?.textContent).toContain('3');
	});

	it('renders Polish labels and does not expose raw errors', () => {
		obsidianMock.getLanguage.mockReturnValue('pl');
		const modal = new SummaryModal({} as never, { result: result() });
		modal.onOpen();
		expect(modal.contentEl.querySelector('[data-summary-notes-created]')?.textContent).toContain('Utworzone notatki');
		expect(modal.contentEl.textContent).not.toContain('Some games were unavailable.');
	});
});
