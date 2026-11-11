/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Operation } from '../src/model/operations';
import type { PreparedSync } from '../src/sync/service';
import { expectNoBodyHeadingMatchingModalTitle } from './ui-helpers';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement { Object.defineProperty(element, 'createEl', { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } }); Object.defineProperty(element, 'createDiv', { value: () => element.createEl('div') }); return element; }
	class Modal { contentEl: HTMLElement; titleEl: HTMLElement; modalEl: HTMLElement; constructor(public readonly app: unknown) { this.contentEl = decorate(document.createElement('div')); this.titleEl = document.createElement('h2'); this.modalEl = document.createElement('div'); } setTitle(title: string): this { this.titleEl.textContent = title; return this; } close(): void { this.onClose(); } onOpen(): void {} onClose(): void {} }
	class Setting { settingEl: HTMLElement; constructor(containerEl: HTMLElement) { this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item'; containerEl.append(this.settingEl); } setName(value: string): this { this.settingEl.dataset.settingName = value; return this; } setDesc(_value: string): this { return this; } addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this { const buttonEl = document.createElement('button'); this.settingEl.append(buttonEl); const component = { buttonEl, setButtonText: (value: string) => { buttonEl.textContent = value; return component; }, setCta: () => component, setDisabled: (value: boolean) => { buttonEl.disabled = value; return component; }, onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; } }; callback(component); return this; } addToggle(callback: (component: { toggleEl: HTMLInputElement; onChange(handler: (value: boolean) => unknown): unknown }) => unknown): this { const toggleEl = document.createElement('input'); toggleEl.type = 'checkbox'; this.settingEl.append(toggleEl); const component = { toggleEl, onChange: (handler: (value: boolean) => unknown) => { toggleEl.addEventListener('change', () => void handler(toggleEl.checked)); return component; } }; callback(component); return this; } }
	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});
vi.mock('obsidian', () => obsidianMock);

const { PreviewModal } = await import('../src/ui/preview-modal');
type PreviewModalOptions = import('../src/ui/preview-modal').PreviewModalOptions;

function operation(id: string, canonicalGameId: string, kind: Operation['kind'] = 'create-note', risk: Operation['risk'] = 'safe'): Operation { return { id, canonicalGameId, kind, risk, path: `Games/${id}.md`, summary: `${kind} ${id}`, planRevision: 'revision:test', expectedNoteFingerprint: kind === 'create-note' ? null : 'fingerprint' } as Operation; }
function prepared(overrides: Partial<PreparedSync> = {}): PreparedSync {
	const operations = [operation('new-safe', 'new', 'create-note'), operation('adopt-safe', 'adopt', 'adopt-note'), operation('update-safe', 'update', 'update-properties'), operation('review-op', 'review', 'update-properties', 'review')];
	const statuses = [{ canonicalGameId: 'new', status: 'create' as const, path: 'Games/new-safe.md' }, { canonicalGameId: 'adopt', status: 'adopt' as const, path: 'Games/adopt-safe.md' }, { canonicalGameId: 'update', status: 'update' as const, path: 'Games/update-safe.md' }, { canonicalGameId: 'review', status: 'review' as const, path: 'Games/review.md', reason: 'Candidate requires review.', match: { status: 'review' as const, confidence: 'likely' as const, candidates: [], note: { path: 'Games/review.md', title: 'review', normalizedFilename: 'review', properties: {} } } }, { canonicalGameId: 'unchanged', status: 'unchanged' as const, path: 'Games/unchanged.md' }, { canonicalGameId: 'conflict', status: 'conflict' as const, path: 'Games/conflict.md', reason: 'Path collision.' }, { canonicalGameId: 'ignored', status: 'ignored' as const, path: 'Games/ignored.md' }];
	return { plan: { id: 'plan:test', planRevision: 'revision:test', operations, expectedNoteFingerprints: {}, statuses, games: [] }, games: [], providerStatuses: { steam: { provider: 'steam', state: 'success', gamesFetched: 7 }, playstation: { provider: 'playstation', state: 'success', gamesFetched: 3 } }, providerResults: {}, gamesFetched: 10, operationsCreated: operations.length, warnings: ['A provider used cached data.'], reviewRequiredCount: 2, ignored: 1, previewRequired: true, ...overrides };
}

function open(overrides: Partial<PreparedSync> = {}, handlers: { onApply?: PreviewModalOptions['onApply']; onReviewDecision?: PreviewModalOptions['onReviewDecision']; onClose?: () => void } = {}) {
	const modal = new PreviewModal({} as never, { prepared: prepared(overrides), onApply: handlers.onApply ?? vi.fn(), onReviewDecision: handlers.onReviewDecision ?? vi.fn(), ...(handlers.onClose === undefined ? {} : { onClose: handlers.onClose }) });
	modal.onOpen();
	return modal;
}
const query = <T extends Element = HTMLElement>(modal: { contentEl: HTMLElement }, selector: string): T => modal.contentEl.querySelector<T>(selector)!;
const onlyNew = { plan: { ...prepared().plan, statuses: [{ canonicalGameId: 'new', status: 'create' as const }], operations: [operation('new-safe', 'new')] }, reviewRequiredCount: 0 };

describe('PreviewModal', () => {
	beforeEach(() => { document.body.replaceChildren(); obsidianMock.getLanguage.mockReturnValue('en'); });

	it('starts with a sync summary, one primary CTA and no duplicate title', () => {
		const modal = open();
		expect(modal.titleEl.textContent).toBe('Preview sync');
		expectNoBodyHeadingMatchingModalTitle(modal.contentEl, 'Preview sync');
		expect(modal.contentEl.querySelector('[data-preview-summary]')).toBeNull();
		expect(query(modal, '[data-preview-details="new"] .game-sync-preview-section-count').textContent).toBe('1');
		expect(query(modal, '[data-preview-details="updates"] .game-sync-preview-section-count').textContent).toBe('2');
		expect(query(modal, '[data-preview-details="review"] .game-sync-preview-section-count').textContent).toBe('2');
		expect(modal.contentEl.querySelectorAll('[data-preview-apply]')).toHaveLength(1);
		expect(modal.contentEl.querySelectorAll('[data-preview-details]')).toHaveLength(4);
	});

	it('orders sections from least to most effort, with decisions last', () => {
		const modal = open();
		expect(Array.from(modal.contentEl.querySelectorAll<HTMLElement>('[data-preview-details]'), (section: HTMLElement) => section.dataset.previewDetails)).toEqual(['new', 'updates', 'ignored', 'review']);
		expect(modal.contentEl.querySelectorAll('[data-preview-group]')).toHaveLength(6);
		expect(modal.contentEl.querySelector('[data-preview-group="unchanged"]')).toBeNull();
	});

	it('explains a match decision with user-facing comparison details', () => {
		const matchGame = { canonicalId: 'review', title: 'Cyberpunk 2077', releaseDate: '2020-12-10', developers: ['CD Projekt Red'], providers: { steam: { title: 'Cyberpunk 2077' }, playstation: { title: 'Cyberpunk 2077' } } } as never;
		const matchStatus = { canonicalGameId: 'review', status: 'review' as const, path: 'Games/Cyberpunk 2077.md', match: { status: 'review' as const, confidence: 'likely' as const, candidates: [], note: { path: 'Games/Cyberpunk 2077.md', title: 'Cyberpunk 2077', normalizedFilename: 'cyberpunk 2077', properties: { released: '2020', developers: ['CD Projekt Red'] } } } };
		const modal = open({ games: [matchGame], plan: { ...prepared().plan, statuses: [matchStatus], operations: [] } });
		expect(query(modal, '[data-preview-group-header]').textContent).toBe('Cyberpunk 2077SteamPlayStation');
		expect(modal.contentEl.textContent).toContain('Existing note: Games/Cyberpunk 2077.md');
		expect(modal.contentEl.textContent).toContain('Same title');
		expect(modal.contentEl.querySelector('[data-preview-review-action="merge:review"]')).not.toBeNull();
		expect(modal.contentEl.textContent).not.toContain('Candidate requires review.');
	});

	it('selects safe operations by default, leaves matches unselected and reports partial selection', () => {
		const modal = open();
		expect(query<HTMLInputElement>(modal, '[data-preview-group-checkbox="new"]').checked).toBe(true);
		expect(modal.contentEl.querySelector('[data-preview-group-checkbox="review"]')).toBeNull();
		const mixed = open({ plan: { ...prepared().plan, statuses: [{ canonicalGameId: 'mixed', status: 'update' as const }], operations: [operation('mixed-safe', 'mixed'), operation('mixed-review', 'mixed', 'update-properties', 'review')] } });
		const checkbox = query<HTMLInputElement>(mixed, '[data-preview-group-checkbox="mixed"]');
		expect(checkbox.checked).toBe(false);
		expect(checkbox.indeterminate).toBe(true);
		const review = query<HTMLInputElement>(mixed, '[data-preview-operation="mixed-review"]');
		review.checked = true; review.dispatchEvent(new Event('change'));
		expect(checkbox.checked).toBe(true);
	});

	it('selects and deselects every visible game, respecting search', () => {
		const modal = open();
		query<HTMLButtonElement>(modal, '[data-preview-deselect-all]').click();
		expect(query<HTMLButtonElement>(modal, '[data-preview-apply]').disabled).toBe(true);
		const search = query<HTMLInputElement>(modal, '[data-preview-search]');
		search.value = 'adopt'; search.dispatchEvent(new Event('input'));
		expect(query(modal, '[data-preview-group="new"]').hidden).toBe(true);
		query<HTMLButtonElement>(modal, '[data-preview-select-all]').click();
		expect(query<HTMLInputElement>(modal, '[data-preview-group-checkbox="adopt"]').checked).toBe(true);
		expect(query<HTMLInputElement>(modal, '[data-preview-group-checkbox="new"]').checked).toBe(false);
		search.value = ''; search.dispatchEvent(new Event('input'));
		query<HTMLButtonElement>(modal, '[data-preview-select-all]').click();
		expect(Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('[data-preview-group-checkbox]')).every((box: HTMLInputElement) => box.checked)).toBe(true);
		expect(query(modal, '[data-preview-apply]').textContent).toBe('Sync selected (3)');
	});

	it('toggles a whole section from its header checkbox', () => {
		const modal = open();
		const section = query<HTMLInputElement>(modal, '[data-preview-section-checkbox="updates"]');
		expect(section.checked).toBe(true);
		section.checked = false; section.dispatchEvent(new Event('change'));
		expect(query<HTMLInputElement>(modal, '[data-preview-group-checkbox="adopt"]').checked).toBe(false);
		expect(query<HTMLInputElement>(modal, '[data-preview-group-checkbox="update"]').checked).toBe(false);
		expect(query<HTMLInputElement>(modal, '[data-preview-group-checkbox="new"]').checked).toBe(true);
	});

	it('lets safe games sync while matches wait, and sends review actions to the host', async () => {
		const onApply = vi.fn().mockResolvedValue(undefined); const onReviewDecision = vi.fn().mockResolvedValue(undefined);
		const modal = open({}, { onApply, onReviewDecision });
		expect(query<HTMLButtonElement>(modal, '[data-preview-apply]').disabled).toBe(false);
		expect(query(modal, '[data-preview-status]').textContent).toBe('');
		query<HTMLButtonElement>(modal, '[data-preview-review-action="merge:review"]').click();
		await vi.waitFor(() => expect(onReviewDecision).toHaveBeenCalledWith({ planId: 'plan:test', canonicalGameId: 'review', action: 'merge', candidatePath: 'Games/review.md' }));
		query<HTMLButtonElement>(modal, '[data-preview-apply]').click();
		await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce());
		expect(onApply.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['new-safe', 'adopt-safe', 'update-safe']));
		expect(onApply.mock.calls[0]?.[1]).not.toContain('review-op');
	});

	it('applies selected operations once', async () => {
		const onApply = vi.fn().mockResolvedValue(undefined); const modal = open(onlyNew, { onApply });
		const apply = query<HTMLButtonElement>(modal, '[data-preview-apply]'); apply.click(); apply.click();
		expect(apply.textContent).toBe('Syncing…');
		expect(apply.classList.contains('is-loading')).toBe(true);
		await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce());
		expect(onApply).toHaveBeenCalledWith(expect.anything(), ['new-safe']);
	});

	it('ignores late callbacks after close and calls onClose once', async () => {
		let resolveApply!: () => void; const onApply = vi.fn(() => new Promise<void>((resolve) => { resolveApply = resolve; })); const onClose = vi.fn();
		const modal = open(onlyNew, { onApply, onClose });
		query<HTMLButtonElement>(modal, '[data-preview-apply]').click(); modal.onClose(); resolveApply(); await Promise.resolve();
		expect(onApply).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
	});

	it('says each thing once: no repeated decision prompts, implied actions or title-only paths', () => {
		const modal = open();
		const text = modal.contentEl.textContent ?? '';
		const occurrences = (needle: string) => text.split(needle).length - 1;
		expect(occurrences('Needs your decision')).toBe(1);
		expect(text).not.toContain('Game Sync needs your decision');
		expect(occurrences('Are these the same game?')).toBe(1);
		const metas = Array.from(modal.contentEl.querySelectorAll<HTMLElement>('.game-sync-preview-row-meta'), (meta: HTMLElement) => meta.textContent ?? '');
		expect(metas.some((meta) => meta.includes('New note') || meta.includes('Update properties'))).toBe(false);
	});

	it('never presents a non-existent note as a merge target; colliding library entries share one card', async () => {
		const onReviewDecision = vi.fn().mockResolvedValue(undefined);
		const games = [
			{ canonicalId: 'steam-hades', title: 'Hades', providers: { steam: { title: 'Hades' } } },
			{ canonicalId: 'psn-hades', title: 'Hades', providers: { playstation: { title: 'Hades' } } },
		] as never;
		const statuses = [
			{ canonicalGameId: 'steam-hades', status: 'conflict' as const, path: 'Games/Hades.md', reason: 'Multiple games resolve to the same note path.', match: { status: 'none' as const, confidence: 'none' as const, candidates: [] } },
			{ canonicalGameId: 'psn-hades', status: 'conflict' as const, path: 'Games/Hades.md', reason: 'Multiple games resolve to the same note path.', match: { status: 'none' as const, confidence: 'none' as const, candidates: [] } },
		];
		const modal = open({ games, plan: { ...prepared().plan, statuses, operations: [] } }, { onReviewDecision });
		expect(modal.contentEl.querySelectorAll('.game-sync-preview-review')).toHaveLength(1);
		expect(modal.contentEl.textContent).not.toContain('Existing note');
		expect(modal.contentEl.textContent).toContain('Same name as: Hades (PlayStation)');
		query<HTMLButtonElement>(modal, '[data-preview-review-action="merge:psn-hades"], [data-preview-review-action="merge:steam-hades"]').click();
		await vi.waitFor(() => expect(onReviewDecision).toHaveBeenCalledOnce());
		const sent = onReviewDecision.mock.calls[0]?.[0] as { action: string; candidateCanonicalId?: string } | undefined;
		expect(sent?.action).toBe('merge');
		expect(['steam-hades', 'psn-hades']).toContain(sent?.candidateCanonicalId);
		expect(onReviewDecision.mock.calls[0]?.[0]).not.toHaveProperty('candidatePath');
	});

	it('"Decide later" only leaves the game out of this sync, without telling the host to ignore it', () => {
		const onReviewDecision = vi.fn();
		const modal = open({}, { onReviewDecision });
		query<HTMLButtonElement>(modal, '[data-preview-review-action="skip:review"]').click();
		expect(onReviewDecision).not.toHaveBeenCalled();
		expect(query(modal, '[data-preview-group="review"]').dataset.previewDecided).toBe('skip');
	});

	it('renders Polish labels', () => {
		obsidianMock.getLanguage.mockReturnValue('pl');
		const modal = open();
		expect(modal.contentEl.textContent).toContain('Wybierz gry do synchronizacji');
		expect(modal.contentEl.textContent).toContain('Nowe gry');
		expect(modal.contentEl.textContent).toContain('Wymaga decyzji');
		expect(modal.contentEl.textContent).toContain('Zaznacz wszystkie');
	});
});
