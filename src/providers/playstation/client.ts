import https from 'node:https';
import { clearTimeout as clearNativeTimeout, setTimeout as setNativeTimeout } from 'node:timers';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { isNpssoValue } from '../../auth/secrets';

/*!
 * Sony endpoints, persisted-query hashes and OAuth parameters adapted from psn-api 2.18.1.
 * MIT License - Copyright (c) 2021 Wes Copeland.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
// This scoped transport replaces the browser fetch path; it does not intercept global fetch.
const OAUTH = 'https://ca.account.sony.com/api/authz/v3/oauth';
const REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect';
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const BASIC_AUTH = 'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const TROPHY = 'https://m.np.playstation.com/api/trophy/v1';
const GAMELIST = 'https://m.np.playstation.com/api/gamelist/v2/users';
const GRAPHQL = 'https://web.np.playstation.com/api/graphql/v1/op';
const PURCHASED_HASH = '827a423f6a8ddca4107ac01395af2ec0eafd8396fc7fa204aaf9b7ed2eefa168';
const RECENT_HASH = 'e780a6d8b921ef0c59ec01ea5c5255671272ca0d819edb61320914cf7a78b3ae';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

type NativeRequest = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
const nativeRequest: NativeRequest = (url, options, callback) => https.request(url, options, callback);

function assertEndpoint(url: URL, method: string): void {
	if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('Invalid PlayStation endpoint');
	if (url.hostname === 'ca.account.sony.com' && ((method === 'GET' && url.pathname === '/api/authz/v3/oauth/authorize') || (method === 'POST' && url.pathname === '/api/authz/v3/oauth/token'))) return;
	if (method === 'GET' && url.hostname === 'web.np.playstation.com' && url.pathname === '/api/graphql/v1/op') return;
	if (method === 'GET' && url.hostname === 'm.np.playstation.com' && (
		/^\/api\/gamelist\/v2\/users\/[^/]+\/titles$/.test(url.pathname) ||
		/^\/api\/trophy\/v1\/(users\/[^/]+\/trophyTitles|npCommunicationIds\/[^/]+\/trophyGroups\/all\/trophies|users\/[^/]+\/npCommunicationIds\/[^/]+\/trophyGroups\/all\/trophies)$/.test(url.pathname)
	)) return;
	throw new Error('Invalid PlayStation endpoint');
}

/** Sanitized transport failure. The code carries only the failure class or HTTP status, never a response body. */
export class PlayStationRequestError extends Error {
	constructor(readonly code: string) {
		super('PlayStation request failed');
		this.name = 'PlayStationRequestError';
	}
}

function request(requester: NativeRequest, url: URL, method: 'GET' | 'POST', headers: Record<string, string>, body?: string): Promise<{ status: number; location?: string; body: string }> {
	assertEndpoint(url, method);
	return new Promise((resolve, reject) => {
		let outgoing: ClientRequest | undefined;
		let settled = false;
		const timer = setNativeTimeout(() => { fail('playstation-timeout'); outgoing?.destroy(); }, REQUEST_TIMEOUT_MS);
		const fail = (code = 'playstation-network-error') => {
			if (settled) return;
			settled = true;
			clearNativeTimeout(timer);
			reject(new PlayStationRequestError(code));
		};
		const finish = (result: { status: number; location?: string; body: string }) => {
			if (settled) return;
			settled = true;
			clearNativeTimeout(timer);
			resolve(result);
		};
		try {
			outgoing = requester(url, { method, headers, timeout: REQUEST_TIMEOUT_MS }, (response) => {
				const status = response.statusCode ?? 0;
				response.on('error', () => fail());
				// Never follow any redirect, including to another approved Sony host.
				if (status >= 300 && status < 400) {
					finish({ status, location: response.headers.location, body: '' });
					response.destroy();
					return;
				}
				if (status < 200 || status >= 300) { fail(`playstation-http-${status}`); response.destroy(); return; }
				let size = 0;
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => {
					size += chunk.length;
					if (size > MAX_RESPONSE_BYTES) { fail('playstation-response-too-large'); outgoing?.destroy(); return; }
					chunks.push(chunk);
				});
				response.on('end', () => finish({ status, body: Buffer.concat(chunks).toString('utf8') }));
			});
			outgoing.on('error', () => fail());
			outgoing.setTimeout(REQUEST_TIMEOUT_MS, () => { fail('playstation-timeout'); outgoing?.destroy(); });
			if (body !== undefined) outgoing.write(body);
			outgoing.end();
		} catch { fail(); outgoing?.destroy(); }
	});
}

function parseJson(body: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(body);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	} catch { /* Never include server body in errors. */ }
	throw new Error('Invalid PlayStation response');
}

function parseTokens(body: string) {
	const value = parseJson(body);
	if (typeof value.access_token !== 'string' || !value.access_token || typeof value.refresh_token !== 'string' || !value.refresh_token || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new Error('Invalid PlayStation token response');
	return {
		accessToken: value.access_token,
		refreshToken: value.refresh_token,
		expiresIn: value.expires_in,
		idToken: typeof value.id_token === 'string' ? value.id_token : undefined,
		refreshTokenExpiresIn: typeof value.refresh_token_expires_in === 'number' ? value.refresh_token_expires_in : undefined,
	};
}

function callbackCode(location: string | undefined): string {
	if (!location) throw new Error('Invalid PlayStation authorization redirect');
	let callback: URL;
	try { callback = new URL(location); } catch { throw new Error('Invalid PlayStation authorization redirect'); }
	if (callback.protocol !== 'com.scee.psxandroid.scecompcall:' || callback.host !== 'redirect' || !['', '/'].includes(callback.pathname) || callback.hash || callback.username || callback.password || callback.port || callback.searchParams.has('error')) throw new Error('Invalid PlayStation authorization redirect');
	const codes = callback.searchParams.getAll('code');
	if (codes.length !== 1 || !codes[0]) throw new Error('Invalid PlayStation authorization redirect');
	return codes[0];
}

function queryUrl(base: string, params: Record<string, string | number | boolean>): URL {
	const url = new URL(base);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
	return url;
}

function graphqlUrl(operationName: string, variables: object, hash: string): URL {
	return queryUrl(GRAPHQL, { operationName, variables: JSON.stringify(variables), extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }) });
}

export function createPlayStationClient(requester: NativeRequest = nativeRequest) {
	async function apiGet<T>(authorization: { accessToken: string }, url: URL): Promise<T> {
		if (!authorization.accessToken || /[\r\n]/.test(authorization.accessToken)) throw new Error('Invalid PlayStation authorization');
		const response = await request(requester, url, 'GET', { Authorization: `Bearer ${authorization.accessToken}`, 'Content-Type': 'application/json' });
		if (response.status !== 200) throw new PlayStationRequestError(`playstation-http-${response.status}`);
		return parseJson(response.body) as T;
	}
	const path = (value: string): string => encodeURIComponent(value);
	return {
		async exchangeNpssoForAccessCode(npsso: string): Promise<string> {
			if (!isNpssoValue(npsso)) throw new Error('Invalid PlayStation NPSSO');
			const url = new URL(`${OAUTH}/authorize`);
			url.search = new URLSearchParams({ access_type: 'offline', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'psn:mobile.v2.core psn:clientapp' }).toString();
			const response = await request(requester, url, 'GET', { Cookie: `npsso=${npsso}` });
			if (response.status !== 302) throw new Error('Invalid PlayStation authorization redirect');
			return callbackCode(response.location);
		},
		async exchangeAccessCodeForAuthTokens(code: string) {
			return parseTokens((await request(requester, new URL(`${OAUTH}/token`), 'POST', { Authorization: BASIC_AUTH, 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ code, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', token_format: 'jwt' }).toString())).body);
		},
		async exchangeRefreshTokenForAuthTokens(refreshToken: string) {
			return parseTokens((await request(requester, new URL(`${OAUTH}/token`), 'POST', { Authorization: BASIC_AUTH, 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ refresh_token: refreshToken, grant_type: 'refresh_token', token_format: 'jwt', scope: 'psn:mobile.v2.core psn:clientapp' }).toString())).body);
		},
		async getUserPlayedGames(auth: { accessToken: string }, accountId: string, options: { limit: number; offset: number; categories: string }) {
			return apiGet<{ titles: unknown[]; totalItemCount?: number; nextOffset?: number }>(auth, queryUrl(`${GAMELIST}/${path(accountId)}/titles`, options));
		},
		async getPurchasedGames(auth: { accessToken: string }, options: { size: number; start: number; platform: string[]; isActive: boolean }) {
			const url = graphqlUrl('getPurchasedGameList', { isActive: options.isActive, platform: options.platform, size: options.size, start: options.start, sortBy: 'ACTIVE_DATE', sortDirection: 'desc' }, PURCHASED_HASH);
			const result = await apiGet<{ data?: { purchasedTitlesRetrieve?: { games: unknown[] } } }>(auth, url);
			if (!result.data?.purchasedTitlesRetrieve) throw new Error('Invalid PlayStation response');
			return { data: { purchasedTitlesRetrieve: result.data.purchasedTitlesRetrieve } };
		},
		async getRecentlyPlayedGames(auth: { accessToken: string }, options: { categories: string[]; limit: number }) {
			const url = graphqlUrl('getUserGameList', { limit: options.limit, categories: options.categories.join(',') }, RECENT_HASH);
			const result = await apiGet<{ data?: { gameLibraryTitlesRetrieve?: { games: unknown[] } } }>(auth, url);
			if (!result.data?.gameLibraryTitlesRetrieve) throw new Error('Invalid PlayStation response');
			return { data: { gameLibraryTitlesRetrieve: result.data.gameLibraryTitlesRetrieve } };
		},
		async getUserTitles(auth: { accessToken: string }, accountId: string, options: { limit: number; offset: number }) {
			return apiGet<{ trophyTitles: unknown[]; totalItemCount?: number; nextOffset?: number }>(auth, queryUrl(`${TROPHY}/users/${path(accountId)}/trophyTitles`, options));
		},
		async getTitleTrophies(auth: { accessToken: string }, npCommunicationId: string, groupId: string, options: { npServiceName: string; limit: number; offset: number }) {
			return apiGet<{ trophies: unknown[]; totalItemCount?: number; nextOffset?: number }>(auth, queryUrl(`${TROPHY}/npCommunicationIds/${path(npCommunicationId)}/trophyGroups/${path(groupId)}/trophies`, options));
		},
		async getUserTrophiesEarnedForTitle(auth: { accessToken: string }, accountId: string, npCommunicationId: string, groupId: string, options: { npServiceName: string; limit: number; offset: number }) {
			const url = queryUrl(`${TROPHY}/users/${path(accountId)}/npCommunicationIds/${path(npCommunicationId)}/trophyGroups/${path(groupId)}/trophies`, options);
			const result = await apiGet<{ error?: unknown; trophies: unknown[]; totalItemCount?: number; nextOffset?: number }>(auth, url);
			if (result.error) throw new Error('PlayStation request failed');
			return result;
		},
	};
}

export const playStationClient = createPlayStationClient();
export type PlayStationClient = ReturnType<typeof createPlayStationClient>;
