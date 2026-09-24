/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement {
		Object.defineProperties(element, {
			createEl: { value: (tag: string, options?: { text?: string }) => { const child = decorate(document.createElement(tag)); if (options?.text !== undefined) child.textContent = options.text; element.append(child); return child; } },
			createDiv: { value: () => { const child = decorate(document.createElement('div')); element.append(child); return child; } },
			createSpan: { value: (options?: { text?: string }) => { const child = decorate(document.createElement('span')); if (options?.text !== undefined) child.textContent = options.text; element.append(child); return child; } },
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

	return { Modal, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { CanonicalPreviewModal } = await import('../src/ui/canonical-preview-modal');

function game(canonicalKey: string, title: string, releaseDate?: string): Record<string, unknown> {
	return {
		identity: { canonicalKey, externalIds: { igdb: canonicalKey === 'dead-space-2008' ? 1905 : 9999 } },
		title,
		metadata: releaseDate === undefined ? {} : { releaseDate },
		platforms: [{ id: 'steam', source: 'gametrack' }],
		playtime: { observations: [] },
		provenance: {},
	};
}

function operation(id: string, kind: 'create' | 'update', canonicalKey: string, title: string, releaseDate?: string, requiredIdentityFieldIds = [`${id}-igdb`]): Record<string, unknown> {
	return {
		id, kind, canonicalKey, path: `Games/${title}.md`, expectedNoteFingerprint: kind === 'update' ? 'fingerprint' : null, risk: 'safe', summary: `${kind} ${title}`,
		game: game(canonicalKey, title, releaseDate),
		preview: kind === 'create'
			? { properties: { 'igdb-id': 1905, platforms: ['steam'] }, body: `# ${title}\n`, changes: requiredIdentityFieldIds.map((fieldId, index) => ({ fieldId, sourceField: index === 0 ? 'igdbId' : 'steamId', property: index === 0 ? 'igdb-id' : 'steam-id', next: index === 0 ? 1905 : 'steam-123' })), requiredIdentityFieldIds }
			: { properties: { playtime: 180, 'last-played': '2026-09-14' }, changes: [{ fieldId: `${id}-playtime`, sourceField: 'playtime', property: 'playtime', previous: 120, next: 180 }, { fieldId: `${id}-last-played`, sourceField: 'lastPlayed', property: 'last-played', previous: '2026-09-10', next: '2026-09-14' }], requiredIdentityFieldIds: [] },
	};
}

function status(canonicalKey: string, statusValue: string, gameValue: Record<string, unknown>, reason?: string): Record<string, unknown> {
	return { canonicalKey, status: statusValue, game: gameValue, ...(reason === undefined ? {} : { reason }) };
}

function preview(operations: readonly Record<string, unknown>[], statuses: readonly Record<string, unknown>[]) {
	return {
		snapshot: { status: 'complete', games: statuses.map((value) => value.game) },
		plan: { id: 'plan-1', planRevision: 'revision-1', operations, statuses, games: statuses.map((value) => value.game) },
		enrichments: [],
	} as never;
}

describe('Canonical sync preview', () => {
	beforeEach(() => document.body.replaceChildren());

	it('groups games and renders selectable field changes with previous and next values', () => {
		const create = operation('create-1', 'create', 'dead-space-2008', 'Dead Space (2008)');
		const update = operation('update-1', 'update', 'diablo-4', 'Diablo IV');
		const unchanged = game('hades', 'Hades');
		const conflict = game('dead-space-conflict', 'Dead Space');
		const modal = new CanonicalPreviewModal({} as never, { preview: preview([create, update], [
			status('dead-space-2008', 'create', create.game as Record<string, unknown>),
			status('diablo-4', 'update', update.game as Record<string, unknown>),
			status('hades', 'unchanged', unchanged),
			status('dead-space-conflict', 'conflict', conflict, 'Nie można jednoznacznie dopasować istniejącej notatki.'),
		]), onApply: vi.fn() });

		modal.onOpen();
		expect(modal.contentEl.querySelector('[data-canonical-preview-section="create"] h3')?.textContent).toBe('To create — 1');
		expect(modal.contentEl.querySelector('[data-canonical-preview-section="update"] h3')?.textContent).toBe('To update — 1');
		expect(modal.contentEl.querySelector('[data-canonical-preview-section="unchanged"] h3')?.textContent).toBe('Unchanged — 1');
		expect(modal.contentEl.querySelector('[data-canonical-preview-section="conflict"] h3')?.textContent).toBe('Needs attention — 1');
		expect(modal.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).toHaveLength(5);
		expect(modal.contentEl.querySelectorAll('[data-canonical-preview-field-toggle]')).toHaveLength(3);
		expect(modal.contentEl.querySelectorAll('[data-canonical-preview-body]')).toHaveLength(1);
		expect(modal.contentEl.textContent).toContain('Property: playtime');
		expect(modal.contentEl.textContent).toContain('Previous: 120');
		expect(modal.contentEl.textContent).toContain('Next: 180');
		expect(modal.contentEl.textContent).toContain('Full note body preview');
		expect(modal.contentEl.textContent).toContain('Dead Space');
		expect(modal.contentEl.textContent).toContain('Nie można jednoznacznie dopasować istniejącej notatki.');
	});

	it('selects all creates and updates by default and applies only selected operation IDs', async () => {
		const onApply = vi.fn(async () => undefined);
		const create = operation('create-1', 'create', 'dead-space-2008', 'Dead Space (2008)');
		const update = operation('update-1', 'update', 'diablo-4', 'Diablo IV');
		const modal = new CanonicalPreviewModal({} as never, { preview: preview([create, update], [
			status('dead-space-2008', 'create', create.game as Record<string, unknown>),
			status('diablo-4', 'update', update.game as Record<string, unknown>),
		]), onApply });

		modal.onOpen();
		const toggles = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('[data-canonical-preview-operation-toggle]'));
		expect(toggles.every((toggle) => toggle.checked)).toBe(true);
		toggles[0].click();
		toggles[0].dispatchEvent(new Event('change'));
		expect(modal.contentEl.querySelector('[data-canonical-preview-selection]')?.textContent).toContain('1 of 2 games selected');
		const apply = modal.contentEl.querySelector<HTMLButtonElement>('[data-canonical-preview-apply]')!;
		expect(apply.textContent).toBe('Sync 1 games');
		apply.click();
		await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith({
			operationIds: ['update-1'],
			fieldIdsByOperation: { 'update-1': ['update-1-playtime', 'update-1-last-played'] },
		}));
	});

	it('keeps duplicate-title games independently selectable and scopes section actions', () => {
		const first = operation('dead-space-1', 'create', 'dead-space-2008', 'Dead Space', '2008-10-13');
		const second = operation('dead-space-2', 'create', 'dead-space-2023', 'Dead Space', '2023-01-27');
		const update = operation('update-1', 'update', 'update-1', 'Other');
		const modal = new CanonicalPreviewModal({} as never, { preview: preview([first, second, update], [
			status('dead-space-2008', 'create', first.game as Record<string, unknown>),
			status('dead-space-2023', 'create', second.game as Record<string, unknown>),
			status('update-1', 'update', update.game as Record<string, unknown>),
		]), onApply: vi.fn() });

		modal.onOpen();
		const createSection = modal.contentEl.querySelector<HTMLElement>('[data-canonical-preview-section="create"]')!;
		const updateSection = modal.contentEl.querySelector<HTMLElement>('[data-canonical-preview-section="update"]')!;
		createSection.querySelector<HTMLButtonElement>('[data-canonical-preview-deselect-all="create"]')!.click();
		const toggles = Array.from(createSection.querySelectorAll<HTMLInputElement>('[data-canonical-preview-operation-toggle]'));
		expect(toggles.every((toggle) => !toggle.checked)).toBe(true);
		expect(updateSection.querySelector<HTMLInputElement>('[data-canonical-preview-operation-toggle]')!.checked).toBe(true);
		updateSection.querySelector<HTMLButtonElement>('[data-canonical-preview-deselect-all="update"]')!.click();
		expect(updateSection.querySelector<HTMLInputElement>('[data-canonical-preview-operation-toggle]')!.checked).toBe(false);
		updateSection.querySelector<HTMLButtonElement>('[data-canonical-preview-select-all="update"]')!.click();
		expect(updateSection.querySelector<HTMLInputElement>('[data-canonical-preview-operation-toggle]')!.checked).toBe(true);
		createSection.querySelector<HTMLButtonElement>('[data-canonical-preview-select-all="create"]')!.click();
		toggles[0].click();
		toggles[0].dispatchEvent(new Event('change'));
		expect(toggles[0].checked).toBe(false);
		expect(toggles[1].checked).toBe(true);
		expect(toggles[0].parentElement?.textContent).toContain('Dead Space (2008)');
		expect(toggles[1].parentElement?.textContent).toContain('Dead Space (2023)');
	});

	it('does not render technical identifiers or raw platform IDs in operation rows', () => {
		const create = operation('create-technical', 'create', 'technical-game', 'Example Game');
		const modal = new CanonicalPreviewModal({} as never, { preview: preview([create], [status('technical-game', 'create', create.game as Record<string, unknown>)]), onApply: vi.fn() });

		modal.onOpen();
		const row = modal.contentEl.querySelector<HTMLElement>('[data-canonical-preview-operation="create-technical"]');
		expect(row?.textContent).toContain('Example Game');
		expect(row?.textContent).not.toMatch(/GameTrack|UUID|lastPlayed|playtime|Games\//i);
		expect(row?.querySelector('[data-canonical-preview-platforms]')).toBeNull();
	});

	it('does not allow sync while a conflict is present', () => {
		const create = operation('create-1', 'create', 'dead-space-2008', 'Dead Space (2008)');
		const onApply = vi.fn();
		const modal = new CanonicalPreviewModal({} as never, { preview: preview([create], [
			status('dead-space-2008', 'create', create.game as Record<string, unknown>),
			status('conflict', 'conflict', game('conflict', 'Dead Space'), 'Review required'),
		]), onApply });

		modal.onOpen();
		const apply = modal.contentEl.querySelector<HTMLButtonElement>('[data-canonical-preview-apply]')!;
		expect(apply.disabled).toBe(true);
		apply.click();
		expect(onApply).not.toHaveBeenCalled();
	});

	it('keeps required create identity fields checked while allowing the whole operation to be deselected', async () => {
		const onApply = vi.fn(async () => undefined);
		const create = operation('create-identity', 'create', 'identity-game', 'Identity Game');
		const modal = new CanonicalPreviewModal({} as never, { preview: preview([create], [status('identity-game', 'create', create.game as Record<string, unknown>)]), onApply });

		modal.onOpen();
		const operationToggle = modal.contentEl.querySelector<HTMLInputElement>('[data-canonical-preview-operation-toggle="create-identity"]')!;
		const fieldToggle = modal.contentEl.querySelector<HTMLInputElement>('[data-canonical-preview-field-toggle="create-identity-igdb"]')!;
		expect(fieldToggle.checked).toBe(true);
		expect(fieldToggle.disabled).toBe(true);
		operationToggle.click();
		operationToggle.dispatchEvent(new Event('change'));
		expect(operationToggle.checked).toBe(false);
		expect(fieldToggle.checked).toBe(true);
		expect(modal.contentEl.querySelector<HTMLButtonElement>('[data-canonical-preview-apply]')!.disabled).toBe(true);
		operationToggle.click();
		operationToggle.dispatchEvent(new Event('change'));
		modal.contentEl.querySelector<HTMLButtonElement>('[data-canonical-preview-apply]')!.click();
		await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith({
			operationIds: ['create-identity'],
			fieldIdsByOperation: { 'create-identity': ['create-identity-igdb'] },
		}));
	});

	it('allows deselecting extra create identity fields while keeping one selected', async () => {
		const onApply = vi.fn(async () => undefined);
		const create = operation('create-identities', 'create', 'identity-game', 'Identity Game', undefined, ['create-identities-igdb', 'create-identities-steam']);
		const modal = new CanonicalPreviewModal({} as never, { preview: preview([create], [status('identity-game', 'create', create.game as Record<string, unknown>)]), onApply });

		modal.onOpen();
		const fields = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('[data-canonical-preview-field-toggle]'));
		expect(fields).toHaveLength(2);
		expect(fields.every((field) => field.checked && !field.disabled)).toBe(true);
		fields[0].click();
		fields[0].dispatchEvent(new Event('change'));
		expect(fields[0].checked).toBe(false);
		expect(fields[1].checked).toBe(true);
		expect(fields[1].disabled).toBe(true);
		expect(fields[0].disabled).toBe(false);

		fields[1].checked = false;
		fields[1].dispatchEvent(new Event('change'));
		expect(fields[1].checked).toBe(true);
		expect(fields[1].disabled).toBe(true);

		modal.contentEl.querySelector<HTMLButtonElement>('[data-canonical-preview-apply]')!.click();
		await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith({
			operationIds: ['create-identities'],
			fieldIdsByOperation: { 'create-identities': ['create-identities-steam'] },
		}));
	});

	it('renders literal property values as text and retains the modal after a safe apply error', async () => {
		const onApply = vi.fn(async () => { throw new Error('secret /private/path'); });
		const update = operation('update-literal', 'update', 'literal-game', 'Literal Game');
		const changes = Reflect.get(update, 'preview') as { changes: Array<Record<string, unknown>> };
		changes.changes[0].previous = '<img src=x onerror=alert(1)>';
		changes.changes[0].next = '<script>secret</script>';
		const modal = new CanonicalPreviewModal({} as never, { preview: preview([update], [status('literal-game', 'update', update.game as Record<string, unknown>)]), onApply });

		modal.onOpen();
		const previous = modal.contentEl.querySelector<HTMLElement>('[data-canonical-preview-previous="update-literal-playtime"]')!;
		const next = modal.contentEl.querySelector<HTMLElement>('[data-canonical-preview-next="update-literal-playtime"]')!;
		expect(previous.textContent).toContain('<img src=x onerror=alert(1)>');
		expect(next.textContent).toContain('<script>secret</script>');
		expect(previous.querySelector('img')).toBeNull();
		expect(next.querySelector('script')).toBeNull();
		modal.contentEl.querySelector<HTMLButtonElement>('[data-canonical-preview-apply]')!.click();
		await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce());
		expect(modal.contentEl.querySelector('[data-canonical-preview-error]')?.textContent).toBe('The selected changes could not be applied. Review the preview and try again.');
		expect(modal.contentEl.querySelector('[data-canonical-preview-error]')?.textContent).not.toContain('secret');
		expect(modal.contentEl.dataset.canonicalPreviewModal).toBe('true');
	});

	it('refuses to apply an incomplete snapshot', () => {
		const onApply = vi.fn();
		const modal = new CanonicalPreviewModal({} as never, {
			preview: { snapshot: { status: 'partial', games: [] }, plan: undefined, enrichments: [] } as never,
			onApply,
		});

		modal.onOpen();
		expect(modal.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).toHaveLength(0);
		expect(modal.contentEl.textContent).toContain('No notes were changed.');
		expect(onApply).not.toHaveBeenCalled();
	});
});
