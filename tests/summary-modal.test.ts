/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Operation } from '../src/model/operations';
import type { SyncApplyResult } from '../src/sync/service';
import { expectNoBodyHeadingMatchingModalTitle } from './ui-helpers';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement { Object.defineProperty(element, 'createEl', { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } }); return element; }
	class Modal { contentEl: HTMLElement; titleEl: HTMLElement; constructor(public readonly app: unknown) { this.contentEl = decorate(document.createElement('div')); this.titleEl = document.createElement('h2'); } setTitle(title: string): this { this.titleEl.textContent = title; return this; } close(): void { this.onClose(); } onOpen(): void {} onClose(): void {} }
	class Setting { settingEl: HTMLElement; constructor(containerEl: HTMLElement) { this.settingEl = document.createElement('div'); containerEl.append(this.settingEl); } setName(value: string): this { this.settingEl.dataset.settingName = value; return this; } setDesc(value: string): this { this.settingEl.dataset.settingDescription = value; return this; } addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; onClick(handler: () => unknown): unknown }) => unknown): this { const buttonEl = document.createElement('button'); this.settingEl.append(buttonEl); const component = { buttonEl, setButtonText: (value: string) => { buttonEl.textContent = value; return component; }, setCta: () => component, onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; } }; callback(component); return this; } }
	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});
vi.mock('obsidian', () => obsidianMock);

const { SummaryModal } = await import('../src/ui/summary-modal');

function operation(id: string, kind: Operation['kind']): Operation { return { id, canonicalGameId: id, kind, risk: 'safe', path: `Games/${id}.md`, summary: kind, planRevision: 'revision:test', expectedNoteFingerprint: kind === 'create-note' ? null : 'fingerprint' } as Operation; }
function result(): SyncApplyResult { const operations = [operation('created', 'create-note'), operation('updated', 'update-properties'), operation('achievement', 'add-achievement-block'), operation('planned-only', 'create-note')]; return { plan: { id: 'plan:test', planRevision: 'revision:test', operations, expectedNoteFingerprints: {}, statuses: [], games: [] }, providerStatuses: { steam: { provider: 'steam', state: 'success', gamesFetched: 327 }, playstation: { provider: 'playstation', state: 'success', gamesFetched: 146 } }, gamesFetched: 473, operationsCreated: 4, operationsApplied: 3, operationsAppliedIds: ['created', 'updated', 'achievement'], pendingOperationIds: ['planned-only'], deselectedOperationIds: [], deselected: 0, ignored: 0, warnings: ['Partial provider data remains pending.'], reviewRequiredCount: 0 }; }

describe('SummaryModal', () => {
	beforeEach(() => { document.body.replaceChildren(); obsidianMock.getLanguage.mockReturnValue('en'); });

	it('shows a clear completion result, counts, destination and actions', () => {
		const openGames = vi.fn(); const modal = new SummaryModal({} as never, { result: result(), notesFolder: 'Games', onOpenGames: openGames }); modal.onOpen();
		expect(modal.titleEl.textContent).toBe('Sync summary'); expectNoBodyHeadingMatchingModalTitle(modal.contentEl, 'Sync summary'); expect(modal.contentEl.textContent).toContain('Your game library is ready'); expect(modal.contentEl.textContent).toContain('1 game notes created'); expect(modal.contentEl.textContent).toContain('1 notes updated'); expect(modal.contentEl.textContent).toContain('1 achievements added'); expect(modal.contentEl.textContent).toContain('Games were saved in: Games/'); expect(modal.contentEl.querySelector('[data-summary-open-games]')).not.toBeNull();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-summary-open-games]')!.click(); expect(openGames).toHaveBeenCalledOnce(); expect(modal.contentEl.querySelector('[data-summary-done]')).not.toBeNull();
	});

	it('keeps warnings readable and never shows provider internals', () => {
		const modal = new SummaryModal({} as never, { result: result() }); modal.onOpen(); expect(modal.contentEl.querySelector('[data-summary-warning]')?.textContent).toBe('Partial provider data remains pending.'); expect(modal.contentEl.textContent).not.toContain('providerStatuses'); expect(modal.contentEl.textContent).not.toContain('plan:test');
	});

	it('renders the same completion result in Polish', () => {
		obsidianMock.getLanguage.mockReturnValue('pl'); const modal = new SummaryModal({} as never, { result: result(), notesFolder: 'Games' }); modal.onOpen(); expect(modal.contentEl.textContent).toContain('Biblioteka gier jest gotowa'); expect(modal.contentEl.textContent).toContain('Gry zapisano w: Games/'); expect(modal.contentEl.textContent).not.toContain('sync.summary.');
	});
});
