/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayStationBrowserSession, canEmbedPlayStationBrowser } from '../src/ui/playstation-browser-session';

describe('isolated PlayStation browser', () => {
	beforeEach(() => vi.stubGlobal('createEl', (tag: string) => document.createElement(tag)));
	it('never creates an embedded browser outside the main Obsidian window', () => {
		// Obsidian 1.14 renders Settings in a separate window; a <webview> there crashes Electron's main process.
		const settingsWindowDocument = document.implementation.createHTMLDocument('Settings');
		const container = settingsWindowDocument.createElement('div');
		settingsWindowDocument.body.append(container);
		const onError = vi.fn();
		const created = vi.fn((tag: string) => document.createElement(tag));
		vi.stubGlobal('createEl', created);
		const session = new PlayStationBrowserSession(container, { onToken: vi.fn(), onError });
		expect(canEmbedPlayStationBrowser(container)).toBe(false);
		session.start();
		expect(created).not.toHaveBeenCalledWith('webview');
		expect(container.querySelector('webview')).toBeNull();
		expect(onError).toHaveBeenCalledOnce();
	});

	it('rejects an old read even after navigation returns to the same Sony URL', async () => {
		const container = document.createElement('div');
		const onToken = vi.fn();
		const session = new PlayStationBrowserSession(container, { onToken, onError: vi.fn() });
		session.start();
		const view = container.querySelector('webview')!;
		let finishRead!: (value: string) => void;
		Object.assign(view, { getURL: () => 'https://ca.account.sony.com/api/v1/ssocookie', executeJavaScript: () => new Promise<string>((resolve) => { finishRead = resolve; }) });
		session.finish();
		view.dispatchEvent(new Event('dom-ready'));
		view.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://www.playstation.com/' }));
		view.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://ca.account.sony.com/api/v1/ssocookie' }));
		finishRead(JSON.stringify({ npsso: 'N'.repeat(64) }));
		await Promise.resolve();
		await Promise.resolve();
		expect(onToken).not.toHaveBeenCalled();
		session.dispose();
	});
	it('times out unsupported or stalled embedded browsers instead of leaving a pending connection', () => {
		vi.useFakeTimers();
		try {
			const container = document.createElement('div');
			const onError = vi.fn();
			const session = new PlayStationBrowserSession(container, { onToken: vi.fn(), onError });
			session.start();
			vi.advanceTimersByTime(30_000);
			expect(onError).toHaveBeenCalledOnce();
			expect(container.querySelector('webview')).toBeNull();
		} finally { vi.useRealTimers(); }
	});
	it.each(['https://ca.account.sony.com.evil.invalid/api/v1/ssocookie', 'http://ca.account.sony.com/api/v1/ssocookie', 'https://example.invalid/login'])('rejects navigation outside HTTPS Sony pages: %s', (url) => {
		const container = document.createElement('div');
		const onError = vi.fn();
		const onToken = vi.fn();
		const session = new PlayStationBrowserSession(container, { onToken, onError });
		session.start();
		const view = container.querySelector('webview')!;
		const executeJavaScript = vi.fn();
		Object.assign(view, { getURL: () => url, executeJavaScript });
		view.dispatchEvent(Object.assign(new Event('did-navigate'), { url }));
		expect(onError).toHaveBeenCalledOnce();
		expect(executeJavaScript).not.toHaveBeenCalled();
		expect(onToken).not.toHaveBeenCalled();
		expect(container.querySelector('webview')).toBeNull();
	});
	it('reads a session token only from the exact Sony endpoint after explicit completion', async () => {
		const container = document.createElement('div');
		const onToken = vi.fn();
		const session = new PlayStationBrowserSession(container, { onToken, onError: vi.fn() });
		session.start();
		const view = container.querySelector('webview')!;
		const executeJavaScript = vi.fn(async () => JSON.stringify({ npsso: 'N'.repeat(64) }));
		Object.assign(view, { getURL: () => view.getAttribute('src'), executeJavaScript });
		view.dispatchEvent(new Event('dom-ready'));
		expect(executeJavaScript).not.toHaveBeenCalled();
		expect(session).toHaveProperty('finish');
		session.finish();
		view.dispatchEvent(new Event('dom-ready'));
		await vi.waitFor(() => expect(onToken).toHaveBeenCalledWith('N'.repeat(64)));
		session.dispose();
	});
	it('starts an isolated Sony page without Node or popup access', () => {
		const container = document.createElement('div');
		const session = new PlayStationBrowserSession(container, { onToken: vi.fn(), onError: vi.fn() });
		session.start();
		const view = container.querySelector('webview')!;
		expect(view.getAttribute('src')).toBe('https://www.playstation.com/');
		expect(view.getAttribute('partition')).not.toMatch(/^persist:/);
		expect(view.getAttribute('webpreferences')).toContain('nodeIntegration=no');
		expect(view.hasAttribute('allowpopups')).toBe(false);
		expect(view.hasAttribute('preload')).toBe(false);
		session.dispose();
		expect(container.querySelector('webview')).toBeNull();
	});
});
