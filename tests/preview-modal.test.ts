/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Operation } from '../src/model/operations';
import type { PreparedSync } from '../src/sync/service';
import { expectNoBodyHeadingMatchingModalTitle } from './ui-helpers';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement { Object.defineProperty(element, 'createEl', { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } }); Object.defineProperty(element, 'createDiv', { value: () => element.createEl('div') }); return element; }
	class Modal { contentEl: HTMLElement; titleEl: HTMLElement; constructor(public readonly app: unknown) { this.contentEl = decorate(document.createElement('div')); this.titleEl = document.createElement('h2'); } setTitle(title: string): this { this.titleEl.textContent = title; return this; } close(): void { this.onClose(); } onOpen(): void {} onClose(): void {} }
	class Setting { settingEl: HTMLElement; constructor(containerEl: HTMLElement) { this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item'; containerEl.append(this.settingEl); } setName(value: string): this { this.settingEl.dataset.settingName = value; return this; } setDesc(_value: string): this { return this; } addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this { const buttonEl = document.createElement('button'); this.settingEl.append(buttonEl); const component = { buttonEl, setButtonText: (value: string) => { buttonEl.textContent = value; return component; }, setCta: () => component, setDisabled: (value: boolean) => { buttonEl.disabled = value; return component; }, onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; } }; callback(component); return this; } addToggle(callback: (component: { toggleEl: HTMLInputElement; onChange(handler: (value: boolean) => unknown): unknown }) => unknown): this { const toggleEl = document.createElement('input'); toggleEl.type = 'checkbox'; this.settingEl.append(toggleEl); const component = { toggleEl, onChange: (handler: (value: boolean) => unknown) => { toggleEl.addEventListener('change', () => void handler(toggleEl.checked)); return component; } }; callback(component); return this; } }
	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});
vi.mock('obsidian', () => obsidianMock);

const { PreviewModal } = await import('../src/ui/preview-modal');

function operation(id: string, canonicalGameId: string, kind: Operation['kind'] = 'create-note', risk: Operation['risk'] = 'safe'): Operation { return { id, canonicalGameId, kind, risk, path: `Games/${id}.md`, summary: `${kind} ${id}`, planRevision: 'revision:test', expectedNoteFingerprint: kind === 'create-note' ? null : 'fingerprint' } as Operation; }
function prepared(overrides: Partial<PreparedSync> = {}): PreparedSync {
	const operations = [operation('new-safe', 'new', 'create-note'), operation('adopt-safe', 'adopt', 'adopt-note'), operation('update-safe', 'update', 'update-properties'), operation('review-op', 'review', 'update-properties', 'review')];
	const statuses = [{ canonicalGameId: 'new', status: 'create' as const, path: 'Games/new-safe.md' }, { canonicalGameId: 'adopt', status: 'adopt' as const, path: 'Games/adopt-safe.md' }, { canonicalGameId: 'update', status: 'update' as const, path: 'Games/update-safe.md' }, { canonicalGameId: 'review', status: 'review' as const, path: 'Games/review.md', reason: 'Candidate requires review.' }, { canonicalGameId: 'unchanged', status: 'unchanged' as const, path: 'Games/unchanged.md' }, { canonicalGameId: 'conflict', status: 'conflict' as const, path: 'Games/conflict.md', reason: 'Path collision.' }, { canonicalGameId: 'ignored', status: 'ignored' as const, path: 'Games/ignored.md' }];
	return { plan: { id: 'plan:test', planRevision: 'revision:test', operations, expectedNoteFingerprints: {}, statuses, games: [] }, games: [], providerStatuses: { steam: { provider: 'steam', state: 'success', gamesFetched: 7 }, playstation: { provider: 'playstation', state: 'success', gamesFetched: 3 } }, providerResults: {}, gamesFetched: 10, operationsCreated: operations.length, warnings: ['A provider used cached data.'], reviewRequiredCount: 2, ignored: 1, previewRequired: true, ...overrides };
}

describe('PreviewModal', () => {
	beforeEach(() => { document.body.replaceChildren(); obsidianMock.getLanguage.mockReturnValue('en'); });

	it('starts with a sync summary, one primary CTA and no duplicate title', () => {
		const modal = new PreviewModal({} as never, { prepared: prepared(), onApply: vi.fn(), onReviewDecision: vi.fn() }); modal.onOpen();
		expect(modal.titleEl.textContent).toBe('Preview first sync'); expectNoBodyHeadingMatchingModalTitle(modal.contentEl, 'Preview first sync'); expect(modal.contentEl.textContent).toContain('Ready to sync'); expect(modal.contentEl.textContent).toContain('1 new game will be added'); expect(modal.contentEl.textContent).toContain('2 existing notes will be updated'); expect(modal.contentEl.textContent).toContain('2 possible matches need your decision'); expect(modal.contentEl.querySelectorAll('[data-preview-apply]')).toHaveLength(1); expect(modal.contentEl.querySelectorAll('[data-preview-details]')).toHaveLength(4);
	});

	it('explains a match decision with user-facing comparison details', () => {
		const matchGame = {
			canonicalId: 'review', title: 'Cyberpunk 2077', releaseDate: '2020-12-10', developers: ['CD Projekt Red'],
			providers: { steam: { title: 'Cyberpunk 2077' }, playstation: { title: 'Cyberpunk 2077' } },
		} as never;
		const matchStatus = {
			canonicalGameId: 'review', status: 'review' as const, path: 'Games/Cyberpunk 2077.md',
			match: { status: 'review' as const, confidence: 'likely' as const, candidates: [], note: { path: 'Games/Cyberpunk 2077.md', title: 'Cyberpunk 2077', normalizedFilename: 'cyberpunk 2077', properties: { released: '2020', developers: ['CD Projekt Red'] } } },
		};
		const base = prepared();
		const modal = new PreviewModal({} as never, { prepared: { ...base, games: [matchGame], plan: { ...base.plan, statuses: [matchStatus], operations: [] } }, onApply: vi.fn(), onReviewDecision: vi.fn() }); modal.onOpen();
		expect(modal.contentEl.querySelector<HTMLElement>('[data-preview-group-header]')?.dataset.settingName).toBe('Are these the same game?'); expect(modal.contentEl.textContent).toContain('Steam: Cyberpunk 2077'); expect(modal.contentEl.textContent).toContain('PlayStation: Cyberpunk 2077'); expect(modal.contentEl.textContent).toContain('Same title'); expect(modal.contentEl.textContent).not.toContain('Candidate requires review.');
	});

	it('groups operations by game and omits empty groups', () => {
		const modal = new PreviewModal({} as never, { prepared: prepared(), onApply: vi.fn(), onReviewDecision: vi.fn() }); modal.onOpen();
		expect(modal.contentEl.querySelectorAll('[data-preview-group]')).toHaveLength(6); expect(modal.contentEl.querySelector('[data-preview-group="review"]')).not.toBeNull(); expect(modal.contentEl.querySelector('[data-preview-group="unchanged"]')).toBeNull(); expect(modal.contentEl.querySelector('[data-preview-details="ignored"]')).not.toBeNull();
	});

	it('selects safe operations by default and reports partial group selection', () => {
		const modal = new PreviewModal({} as never, { prepared: prepared(), onApply: vi.fn(), onReviewDecision: vi.fn() }); modal.onOpen(); const reviewGroup = modal.contentEl.querySelector<HTMLInputElement>('[data-preview-group-checkbox="review"]')!; expect(reviewGroup.checked).toBe(false); const reviewOperation = modal.contentEl.querySelector<HTMLInputElement>('[data-preview-operation="review-op"]')!; reviewOperation.checked = true; reviewOperation.dispatchEvent(new Event('change')); expect(reviewGroup.checked).toBe(true);
		const mixed = new PreviewModal({} as never, { prepared: prepared({ plan: { ...prepared().plan, statuses: [{ canonicalGameId: 'mixed', status: 'update' as const }], operations: [operation('mixed-safe', 'mixed'), operation('mixed-review', 'mixed', 'update-properties', 'review')] } }), onApply: vi.fn(), onReviewDecision: vi.fn() }); mixed.onOpen(); const checkbox = mixed.contentEl.querySelector<HTMLInputElement>('[data-preview-group-checkbox="mixed"]')!; expect(checkbox.checked).toBe(false); expect(checkbox.indeterminate).toBe(true);
	});

	it('blocks apply while review is required and sends review actions to the host', async () => {
		const onApply = vi.fn(); const onReviewDecision = vi.fn().mockResolvedValue(undefined); const modal = new PreviewModal({} as never, { prepared: prepared(), onApply, onReviewDecision }); modal.onOpen(); expect(modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-apply]')!.disabled).toBe(true); modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-review-action="merge:review"]')!.click(); await vi.waitFor(() => expect(onReviewDecision).toHaveBeenCalledWith({ planId: 'plan:test', canonicalGameId: 'review', action: 'merge', candidatePath: 'Games/review.md' })); expect(onApply).not.toHaveBeenCalled();
	});

	it('applies selected operations once when no review is required', async () => {
		const onApply = vi.fn().mockResolvedValue(undefined); const modal = new PreviewModal({} as never, { prepared: prepared({ plan: { ...prepared().plan, statuses: [{ canonicalGameId: 'new', status: 'create' as const }], operations: [operation('new-safe', 'new')] }, reviewRequiredCount: 0 }), onApply, onReviewDecision: vi.fn() }); modal.onOpen(); const apply = modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-apply]')!; expect(apply.disabled).toBe(false); apply.click(); apply.click(); await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce()); expect(onApply).toHaveBeenCalledWith(expect.anything(), ['new-safe']);
	});

	it('ignores late callbacks after close and calls onClose once', async () => {
		let resolveApply!: () => void; const onApply = vi.fn(() => new Promise<void>((resolve) => { resolveApply = resolve; })); const onClose = vi.fn(); const modal = new PreviewModal({} as never, { prepared: prepared({ plan: { ...prepared().plan, statuses: [{ canonicalGameId: 'new', status: 'create' as const }], operations: [operation('new-safe', 'new')] }, reviewRequiredCount: 0 }), onApply, onReviewDecision: vi.fn(), onClose }); modal.onOpen(); modal.contentEl.querySelector<HTMLButtonElement>('[data-preview-apply]')!.click(); modal.onClose(); resolveApply(); await Promise.resolve(); expect(onApply).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
	});

	it('renders Polish summary and detail labels', () => { obsidianMock.getLanguage.mockReturnValue('pl'); const modal = new PreviewModal({} as never, { prepared: prepared(), onApply: vi.fn(), onReviewDecision: vi.fn() }); modal.onOpen(); expect(modal.contentEl.textContent).toContain('Gotowe do synchronizacji'); expect(modal.contentEl.textContent).toContain('Nowe gry'); expect(modal.contentEl.textContent).toContain('Wymaga przeglądu'); });
});
