/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderGame } from '../src/model/provider';
import type { GameSyncData } from '../src/state/schema';

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
				Object.defineProperty(element, 'createSpan', { value: (): HTMLElement => element.createEl('span') });
			};
			decorate(this.contentEl);
		}
		setTitle(_title: string): this { return this; }
		onOpen(): void {}
		onClose(): void {}
	}
	return { Modal };
});

vi.mock('obsidian', () => obsidianMock);

const { buildLibrarySummary } = await import('../src/model/library-summary');
const { LibrarySummaryModal } = await import('../src/ui/library-summary-modal');

const freshness = { metadata: true, ownership: true, playtime: true, achievements: true } as const;

function game(provider: ProviderGame['provider'], providerGameId: string, overrides: Partial<ProviderGame> = {}): ProviderGame {
	const identity: ProviderGame['identity'] = provider === 'steam'
		? { provider: 'steam', appId: Number(providerGameId) || 1 }
		: { provider: 'playstation', conceptId: `concept-${providerGameId}`, titleIds: [providerGameId], npCommunicationIds: [] };
	return {
		provider,
		providerGameId,
		title: `${provider}-${providerGameId}`,
		developers: [],
		publishers: [],
		genres: [],
		platforms: [],
		freshness,
		identity,
		...overrides,
	};
}

function state(overrides: Partial<GameSyncData> = {}): Pick<GameSyncData, 'lastSuccessfulProviderSnapshots' | 'lastSuccessfulProviderStates' | 'identityMappings'> {
	return {
		identityMappings: [],
		lastSuccessfulProviderSnapshots: {},
		lastSuccessfulProviderStates: {},
		...overrides,
	};
}

describe('buildLibrarySummary', () => {
	it('projects mixed provider snapshots into deduplicated mapped library metrics', () => {
		const input = state({
			identityMappings: [
				{ canonicalId: 'game:cross', provider: 'steam', providerGameId: '100' },
				{ canonicalId: 'game:cross', provider: 'playstation', providerGameId: 'ps-100' },
			],
			lastSuccessfulProviderSnapshots: {
				steam: [
					game('steam', '100', { owned: true, playtimeMinutes: 0 }),
					game('steam', '200', { owned: false, playtimeMinutes: 20 }),
					game('steam', '300', { owned: undefined, playtimeMinutes: 0 }),
					game('steam', '400', { owned: undefined }),
					game('steam', '500', { owned: true, achievements: { earned: 3, total: 3, progress: 100, achievements: [] } }),
					game('steam', '500', { owned: true, achievements: { earned: 3, total: 3, progress: 100, achievements: [] } }),
				],
				playstation: [
					game('playstation', 'ps-100', { owned: false, playtimeMinutes: 5 }),
					game('playstation', 'ps-200', { owned: true, playtimeMinutes: 0 }),
					game('playstation', 'ps-300', { owned: true, achievements: { earned: 2, total: 2, progress: 100, achievements: [{ id: 'platinum', unlocked: true, hidden: false, trophyType: 'platinum' }] } }),
				],
			},
			lastSuccessfulProviderStates: {
				steam: { provider: 'steam', fetchedAt: '2026-09-12T12:00:00.000Z', gameIds: ['100'], status: 'complete', paginationComplete: true },
				playstation: { provider: 'playstation', fetchedAt: '2026-09-13T12:00:00.000Z', gameIds: ['ps-100'], status: 'complete', paginationComplete: true },
			},
		});

		expect(buildLibrarySummary(input)).toEqual({
			totalGames: 7,
			owned: 4,
			previouslyPlayedNoLongerOwned: 1,
			steamGames: 5,
			playstationGames: 3,
			crossPlatform: 1,
			neverPlayed: 2,
			steam100Percent: 1,
			playstationPlatinum: 1,
			lastSyncAt: '2026-09-13T12:00:00.000Z',
		});
	});

	it('counts previously played no-longer-owned games only with explicit ownership loss and play evidence', () => {
		expect(buildLibrarySummary(state({
			lastSuccessfulProviderSnapshots: {
				steam: [
					game('steam', 'played', { owned: false, playtimeMinutes: 10 }),
					game('steam', 'last-played', { owned: false, lastPlayed: '2026-09-01T00:00:00.000Z' }),
					game('steam', 'unknown-playtime', { owned: false }),
					game('steam', 'unknown-ownership', { playtimeMinutes: 20 }),
				],
			},
		}))).toMatchObject({ totalGames: 4, owned: 0, previouslyPlayedNoLongerOwned: 2, neverPlayed: 0 });
	});

	it('does not use partial/applied snapshots, invalid sync times, or mutate input', () => {
		const input = {
			...state({
				lastSuccessfulProviderSnapshots: { steam: [game('steam', 'successful', { owned: true, playtimeMinutes: 0 })] },
				lastSuccessfulProviderStates: {
					steam: { provider: 'steam', fetchedAt: 'not-an-iso-time', gameIds: ['successful'], status: 'complete', paginationComplete: true },
				},
			}),
			lastAppliedProviderSnapshots: { steam: [game('steam', 'applied-only', { owned: true, playtimeMinutes: 30 })] },
		} as Pick<GameSyncData, 'lastSuccessfulProviderSnapshots' | 'lastSuccessfulProviderStates' | 'identityMappings'> & { lastAppliedProviderSnapshots: GameSyncData['lastAppliedProviderSnapshots'] };
		const before = structuredClone(input);

		expect(buildLibrarySummary(input)).toMatchObject({ totalGames: 1, owned: 1, lastSyncAt: undefined });
		expect(input).toEqual(before);
	});
});

describe('LibrarySummaryModal', () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	const summary = {
		totalGames: 10,
		owned: 7,
		previouslyPlayedNoLongerOwned: 1,
		steamGames: 6,
		playstationGames: 5,
		crossPlatform: 1,
		neverPlayed: 2,
		steam100Percent: 3,
		playstationPlatinum: 4,
		lastSyncAt: undefined,
	} as const;

	it('renders all metrics, safe unknown time, and both actions', () => {
		const onOpenBase = vi.fn();
		const onSyncNow = vi.fn();
		const modal = new LibrarySummaryModal({} as never, { summary, onOpenBase, onSyncNow });

		modal.onOpen();

		expect(modal.contentEl.querySelectorAll('[data-library-summary]').length).toBe(10);
		expect(modal.contentEl.querySelector('[data-library-summary="totalGames"]')?.textContent).toContain('10');
		expect(modal.contentEl.querySelector('[data-library-summary="lastSyncAt"]')?.textContent).toContain('—');
		expect(modal.contentEl.querySelector('[data-library-summary-action="openBase"]')?.textContent).toBe('Open Games.base');
		expect(modal.contentEl.querySelector('[data-library-summary-action="syncNow"]')?.textContent).toBe('Sync now');

		modal.onClose();
		expect(onOpenBase).not.toHaveBeenCalled();
		expect(onSyncNow).not.toHaveBeenCalled();
		(modal.contentEl.querySelector('[data-library-summary-action="openBase"]') as HTMLButtonElement).click();
		(modal.contentEl.querySelector('[data-library-summary-action="syncNow"]') as HTMLButtonElement).click();
		expect(onOpenBase).toHaveBeenCalledTimes(1);
		expect(onSyncNow).toHaveBeenCalledTimes(1);
	});

	it('replaces previous content on every open and accepts injected labels', () => {
		const modal = new LibrarySummaryModal({} as never, {
			summary: { ...summary, lastSyncAt: '2026-09-13T12:00:00.000Z' },
			onOpenBase: vi.fn(),
			onSyncNow: vi.fn(),
			injected: { t: (key) => key === 'librarySummary.totalGames' ? 'Wszystkie gry' : key },
		});

		modal.onOpen();
		modal.contentEl.append(document.createElement('aside'));
		modal.onOpen();

		expect(modal.contentEl.querySelector('aside')).toBeNull();
		expect(modal.contentEl.querySelector('[data-library-summary="totalGames"]')?.textContent).toContain('Wszystkie gry');
		expect(modal.contentEl.querySelector('[data-library-summary="lastSyncAt"]')?.textContent).toContain('2026-09-13T12:00:00.000Z');
	});
});
