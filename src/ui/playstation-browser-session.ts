import { isNpssoValue } from '../auth/secrets';

export const PLAYSTATION_LOGIN_URL = 'https://www.playstation.com/';
export const PLAYSTATION_SESSION_URL = 'https://ca.account.sony.com/api/v1/ssocookie';

interface BrowserSessionOptions {
	onToken: (token: string) => void | Promise<void>;
	onError: () => void;
}

interface SonyWebview extends HTMLElement {
	getURL(): string;
	executeJavaScript(script: string): Promise<unknown>;
	stop?(): void;
}

declare global {
	interface HTMLElementTagNameMap {
		webview: SonyWebview;
	}
}

function isSonyPage(raw: string): boolean {
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' && url.username === '' && url.password === '' && (url.port === '' || url.port === '443') && ['sony.com', 'sonyentertainmentnetwork.com', 'playstation.com'].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
	} catch { return false; }
}

/**
 * Embedded browsers are only safe in Obsidian's main window. Obsidian 1.14 renders Settings in a
 * separate window, and attaching a <webview> there crashes Electron's main process (whole app).
 * Plugin code shares the main window's realm, so the global `document` is the main window document.
 */
export function canEmbedPlayStationBrowser(element: HTMLElement): boolean {
	return element.ownerDocument === document;
}

/** A separate in-memory Electron webview, never the user's browser cookie store. */
export class PlayStationBrowserSession {
	private view?: SonyWebview;
	private completing = false;
	private navigationGeneration = 0;
	private timer?: number;
	private readonly hostWindow: Window;

	constructor(private readonly container: HTMLElement, private readonly options: BrowserSessionOptions) {
		this.hostWindow = container.ownerDocument.defaultView ?? window;
	}

	start(): void {
		this.dispose();
		if (!canEmbedPlayStationBrowser(this.container)) {
			this.options.onError();
			return;
		}
		const view = createEl('webview');
		view.className = 'game-sync-playstation-browser';
		view.setAttribute('partition', `game-sync-psn-${crypto.randomUUID()}`);
		view.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,webSecurity=yes,nodeIntegration=no');
		view.setAttribute('src', PLAYSTATION_LOGIN_URL);
		view.addEventListener('dom-ready', () => {
			if (view !== this.view) return;
			this.navigationGeneration++;
			if (typeof view.getURL !== 'function' || typeof view.executeJavaScript !== 'function') { this.fail(); return; }
			if (!this.completing) this.hostWindow.clearTimeout(this.timer);
			void this.readSession(view);
		});
		for (const eventName of ['will-navigate', 'did-navigate', 'did-navigate-in-page']) {
			view.addEventListener(eventName, (event) => {
				if (view !== this.view) return;
				this.navigationGeneration++;
				const url = (event as Event & { url: string }).url;
				if (!isSonyPage(url)) this.fail();
			});
		}
		this.view = view;
		this.container.append(view);
		this.timer = this.hostWindow.setTimeout(() => { if (view === this.view) this.fail(); }, 30_000);
	}

	finish(): void {
		if (this.view === undefined || this.completing) return;
		this.completing = true;
		this.hostWindow.clearTimeout(this.timer);
		this.timer = this.hostWindow.setTimeout(() => this.fail(), 30_000);
		this.view.setAttribute('src', PLAYSTATION_SESSION_URL);
	}

	private async readSession(view: SonyWebview): Promise<void> {
		if (view !== this.view || !this.completing || view.getURL() !== PLAYSTATION_SESSION_URL) return;
		const generation = this.navigationGeneration;
		try {
			const text = await view.executeJavaScript('document.body.innerText');
			if (view !== this.view || generation !== this.navigationGeneration || view.getURL() !== PLAYSTATION_SESSION_URL) return;
			if (typeof text !== 'string' || text.length > 2048) throw new Error('Invalid session response');
			const parsed: unknown = JSON.parse(text);
			if (typeof parsed !== 'object' || parsed === null || !('npsso' in parsed) || typeof parsed.npsso !== 'string' || !isNpssoValue(parsed.npsso)) throw new Error('Invalid session response');
			this.dispose();
			await this.options.onToken(parsed.npsso);
		} catch {
			if (view !== this.view || generation !== this.navigationGeneration) return;
			this.fail();
		}
	}

	private fail(): void {
		this.dispose();
		this.options.onError();
	}

	dispose(): void {
		this.navigationGeneration++;
		this.hostWindow.clearTimeout(this.timer);
		this.timer = undefined;
		const view = this.view;
		this.view = undefined;
		this.completing = false;
		try { view?.stop?.(); } catch { /* The guest may not have attached yet. */ }
		view?.remove();
	}
}
