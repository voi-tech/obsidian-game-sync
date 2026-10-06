import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayStationClient } from '../src/providers/playstation/client';
import { createPlayStationAuth, PlayStationAuthError, PlayStationNeedsAuthenticationError } from '../src/providers/playstation/auth';
import { createPlayStationApi } from '../src/providers/playstation/api';
import { GAME_SYNC_SECRET_NAMES } from '../src/auth/secrets';

const npsso = 'N'.repeat(64);
let server: http.Server;
let port: number;
let responder: (request: http.IncomingMessage, body: string, response: http.ServerResponse) => void;
const seen: Array<{ url: string; method: string; host: string; headers: http.IncomingHttpHeaders; body: string }> = [];

beforeEach(async () => {
	seen.length = 0;
	server = http.createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			const body = Buffer.concat(chunks).toString('utf8');
			seen.push({ url: request.url ?? '', method: request.method ?? '', host: String(request.headers.host), headers: request.headers, body });
			responder(request, body, response);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
	vi.restoreAllMocks();
	await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

// Preserve the original Sony URL and headers; only the test adapter changes the socket destination.
function client() {
	return createPlayStationClient((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest => {
		return http.request({ ...options, hostname: '127.0.0.1', port, protocol: 'http:', path: url.pathname + url.search, headers: { ...options.headers, Host: url.host } }, callback);
	});
}

function secrets() {
	const values = new Map<string, string>();
	return {
		values,
		store: {
			get: (key: string) => values.get(key) ?? null,
			set: (key: string, value: string) => { values.set(key, value); },
			delete: (key: string) => { values.delete(key); },
		},
	};
}

describe('scoped native PSN transport', () => {
	it('accepts URL-safe NPSSO consistently with the browser session parser', async () => {
		responder = (request, _body, response) => request.url?.includes('/authorize')
			? response.writeHead(302, { Location: 'com.scee.psxandroid.scecompcall://redirect/?code=ok' }).end()
			: response.writeHead(200).end(JSON.stringify({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 }));
		await expect(createPlayStationAuth({ secretStore: secrets().store, client: client() }).connectWithNpsso(`${'N'.repeat(62)}_-`)).resolves.toMatchObject({ provider: 'playstation' });
		expect(seen[0].headers.cookie).toBe(`npsso=${'N'.repeat(62)}_-`);
	});

	it.each([302, 401])('closes a streaming HTTP %s response instead of draining it indefinitely', async (status) => {
		let responseClosed = false;
		responder = (_request, _body, response) => {
			response.on('close', () => { responseClosed = true; });
			response.writeHead(status, { Location: 'https://example.invalid/' });
			response.write('unfinished fixture response');
		};
		await expect(client().getUserPlayedGames({ accessToken: 'fixture-access' }, 'me', { limit: 1, offset: 0, categories: 'ps4_game' })).rejects.toThrow('PlayStation request failed');
		try { await vi.waitFor(() => expect(responseClosed).toBe(true)); }
		finally { server.closeAllConnections(); }
	});
	it('connects with manual Sony callback and exchanges code without touching browser fetch', async () => {
		const originalFetch = globalThis.fetch;
		const browserFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('browser fetch forbidden'); });
		responder = (request, _body, response) => {
			if (request.url?.startsWith('/api/authz/v3/oauth/authorize?')) {
				response.writeHead(302, { Location: 'com.scee.psxandroid.scecompcall://redirect/?code=short-lived-code' }).end();
			} else {
				response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 }));
			}
		};
		const { store, values } = secrets();
		const auth = createPlayStationAuth({ secretStore: store, client: client() });
		await expect(auth.connectWithNpsso(npsso)).resolves.toMatchObject({ provider: 'playstation' });
		expect(seen).toHaveLength(2);
		expect(seen[0]).toMatchObject({ method: 'GET', host: 'ca.account.sony.com' });
		expect(seen[0].headers.cookie).toBe(`npsso=${npsso}`);
		expect(seen[0].headers.authorization).toBeUndefined();
		expect(new URL(`https://ca.account.sony.com${seen[0].url}`).searchParams.get('redirect_uri')).toBe('com.scee.psxandroid.scecompcall://redirect');
		expect(seen[1]).toMatchObject({ method: 'POST', host: 'ca.account.sony.com' });
		expect(seen[1].headers.cookie).toBeUndefined();
		expect(seen[1].headers.authorization).toMatch(/^Basic /);
		expect(new URLSearchParams(seen[1].body).get('code')).toBe('short-lived-code');
		expect(values.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe('refresh-token');
		expect(browserFetch).not.toHaveBeenCalled();
		browserFetch.mockRestore();
		expect(globalThis.fetch).toBe(originalFetch);
	});

	it.each([
		'https://attacker.invalid/?code=stolen',
		'//attacker.invalid/?code=stolen',
		'com.scee.psxandroid.scecompcall://attacker/?code=stolen',
		'com.scee.psxandroid.scecompcall://redirect/elsewhere?code=stolen',
		'com.scee.psxandroid.scecompcall://redirect/?code=one&code=two',
		'com.scee.psxandroid.scecompcall://redirect/?error=denied&code=one',
		'com.scee.psxandroid.scecompcall://redirect/',
	])('rejects untrusted redirect %s without sending any follow-up request', async (location) => {
		responder = (_request, _body, response) => response.writeHead(302, { Location: location }).end('secret error body');
		const { store, values } = secrets();
		await expect(createPlayStationAuth({ secretStore: store, client: client() }).connectWithNpsso(npsso)).rejects.toThrow(PlayStationAuthError);
		expect(seen).toHaveLength(1);
		expect(values.size).toBe(0);
	});

	it('rejects malformed NPSSO before network use and malformed token fields without leaking bodies', async () => {
		responder = (request, _body, response) => request.url?.includes('/authorize')
			? response.writeHead(302, { Location: 'com.scee.psxandroid.scecompcall://redirect?code=ok' }).end()
			: response.writeHead(200).end(JSON.stringify({ access_token: 'secret-value', expires_in: 3600 }));
		const { store, values } = secrets();
		const auth = createPlayStationAuth({ secretStore: store, client: client() });
		for (const invalid of ['x', 'N'.repeat(63), `${'N'.repeat(63)};`, ` ${npsso}`, `${npsso}\n`]) {
			await expect(auth.connectWithNpsso(invalid)).rejects.toThrow(PlayStationAuthError);
		}
		expect(seen).toHaveLength(0);
		await expect(auth.connectWithNpsso(npsso)).rejects.toThrow(PlayStationAuthError);
		expect(values.size).toBe(0);
	});

	it('refreshes saved token through the same native transport without Cookie', async () => {
		responder = (_request, _body, response) => response.writeHead(200).end(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }));
		const { store, values } = secrets();
		values.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'old-refresh');
		const auth = createPlayStationAuth({ secretStore: store, client: client() });
		await expect(auth.getAccessToken()).resolves.toBe('new-access');
		expect(seen).toHaveLength(1);
		expect(seen[0].headers.cookie).toBeUndefined();
		expect(seen[0].headers.authorization).toMatch(/^Basic /);
		expect(new URLSearchParams(seen[0].body).get('refresh_token')).toBe('old-refresh');
		expect(values.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe('new-refresh');
	});

	it('rejects token redirects and sanitizes HTTP failures', async () => {
		responder = (_request, _body, response) => response.writeHead(302, { Location: 'https://attacker.invalid/secret' }).end();
		const { store, values } = secrets();
		values.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'old-refresh');
		await expect(createPlayStationAuth({ secretStore: store, client: client() }).refresh()).rejects.toThrow(PlayStationNeedsAuthenticationError);
		expect(seen).toHaveLength(1);
	});

	it('sanitizes API HTTP and JSON errors, and rejects oversized responses', async () => {
		const transport = client();
		const token = { accessToken: 'access-token' };
		responder = (_request, _body, response) => response.writeHead(401).end('secret HTTP response body');
		await expect(transport.getUserPlayedGames(token, 'me', { limit: 1, offset: 0, categories: 'ps4_game' })).rejects.toThrow('PlayStation request failed');
		responder = (_request, _body, response) => response.writeHead(200).end('secret invalid JSON body');
		await expect(transport.getUserPlayedGames(token, 'me', { limit: 1, offset: 0, categories: 'ps4_game' })).rejects.toThrow('Invalid PlayStation response');
		responder = (_request, _body, response) => response.writeHead(200).end('x'.repeat(4 * 1024 * 1024 + 1));
		await expect(transport.getUserPlayedGames(token, 'me', { limit: 1, offset: 0, categories: 'ps4_game' })).rejects.toThrow('PlayStation request failed');
		expect(seen).toHaveLength(3);
	});

	it('encodes account and trophy path components and follows only pagination offsets', async () => {
		responder = (request, _body, response) => {
			const offset = new URL(request.url ?? '/', 'https://example.invalid').searchParams.get('offset');
			response.writeHead(200).end(JSON.stringify({ titles: [{ titleId: `CUSA${offset}`, name: 'Game' }], totalItemCount: 2, nextOffset: offset === '0' ? 1 : undefined }));
		};
		const auth = { getAccessToken: async () => 'access-token' } as Parameters<typeof createPlayStationApi>[0];
		await expect(createPlayStationApi(auth, 'me/other', client()).getUserPlayedGames({ limit: 1 })).resolves.toMatchObject({ complete: true, pagesFetched: 2 });
		expect(seen.map((call) => new URL(call.url, 'https://example.invalid').searchParams.get('offset'))).toEqual(['0', '1']);
		expect(seen[0].url).toContain('/users/me%2Fother/titles');
	});

	it('uses authenticated fixed Sony endpoints, correct GraphQL hashes and paginates library/trophies', async () => {
		const browserFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('browser fetch called'); });
		responder = (request, _body, response) => {
			const url = new URL(request.url ?? '/', 'https://example.invalid');
			let payload: object;
			if (url.pathname.includes('/gamelist/')) payload = { titles: [{ titleId: 'CUSA1', name: 'Game' }], totalItemCount: 1 };
			else if (url.pathname.includes('/trophyTitles')) payload = { trophyTitles: [{ npServiceName: 'trophy', npCommunicationId: 'NPWR1', trophyTitleName: 'Game' }], totalItemCount: 1 };
			else if (url.pathname.includes('/trophies')) payload = { trophies: [{ trophyId: 1, trophyType: 'bronze', earned: true }], totalItemCount: 1 };
			else if (url.searchParams.get('operationName') === 'getPurchasedGameList') payload = { data: { purchasedTitlesRetrieve: { games: [{ name: 'Bought' }] } } };
			else payload = { data: { gameLibraryTitlesRetrieve: { games: [{ name: 'Recent' }] } } };
			response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
		};
		const transport = client();
		const auth = { getAccessToken: async () => 'access-token' } as Parameters<typeof createPlayStationApi>[0];
		const api = createPlayStationApi(auth, 'me', transport);
		await expect(api.getUserPlayedGames()).resolves.toMatchObject({ complete: true, pagesFetched: 1 });
		await expect(api.getPurchasedGames()).resolves.toMatchObject({ complete: true, games: [{ name: 'Bought' }] });
		await expect(api.getRecentlyPlayedGames()).resolves.toMatchObject({ complete: true, games: [{ name: 'Recent' }] });
		await expect(api.getUserTitles()).resolves.toMatchObject({ complete: true, titles: [{ npCommunicationId: 'NPWR1' }] });
		await expect(api.getTitleTrophies('NPWR1', { npServiceName: 'trophy' })).resolves.toMatchObject({ complete: true });
		await expect(api.getUserTrophiesEarnedForTitle('NPWR1', { npServiceName: 'trophy' })).resolves.toMatchObject({ complete: true });
		expect(seen).toHaveLength(6);
		for (const call of seen) {
			expect(call.headers.authorization).toBe('Bearer access-token');
			expect(call.headers.cookie).toBeUndefined();
			expect(['m.np.playstation.com', 'web.np.playstation.com']).toContain(call.host);
		}
		const purchased = new URL(`https://web.np.playstation.com${seen[1].url}`);
		expect((JSON.parse(purchased.searchParams.get('extensions') ?? '{}') as { persistedQuery: { sha256Hash: string } }).persistedQuery.sha256Hash).toBe('827a423f6a8ddca4107ac01395af2ec0eafd8396fc7fa204aaf9b7ed2eefa168');
		const recent = new URL(`https://web.np.playstation.com${seen[2].url}`);
		expect((JSON.parse(recent.searchParams.get('extensions') ?? '{}') as { persistedQuery: { sha256Hash: string } }).persistedQuery.sha256Hash).toBe('e780a6d8b921ef0c59ec01ea5c5255671272ca0d819edb61320914cf7a78b3ae');
		expect(browserFetch).not.toHaveBeenCalled();
	});
});
