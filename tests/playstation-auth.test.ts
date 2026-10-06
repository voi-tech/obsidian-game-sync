import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../src/auth/secrets';
import { GAME_SYNC_SECRET_NAMES } from '../src/auth/secrets';

const { exchangeNpssoForAccessCode, exchangeAccessCodeForAuthTokens, exchangeRefreshTokenForAuthTokens } = vi.hoisted(() => ({
	exchangeNpssoForAccessCode: vi.fn(),
	exchangeAccessCodeForAuthTokens: vi.fn(),
	exchangeRefreshTokenForAuthTokens: vi.fn(),
}));

vi.mock('psn-api', () => ({ exchangeNpssoForAccessCode, exchangeAccessCodeForAuthTokens, exchangeRefreshTokenForAuthTokens }));

import { createPlayStationAuth, preparePlayStationConnection } from '../src/providers/playstation/auth';
import { PlayStationAuthError, PlayStationNeedsAuthenticationError } from '../src/providers/playstation/auth';

function secrets(): { store: SecretStore; values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		store: {
			get: (name) => values.get(name) ?? null,
			set: (name, value) => void values.set(name, value),
			delete: (name) => void values.delete(name),
		},
	};
}

describe('PlayStation authentication', () => {
	it('invalidates refreshes started while a modal connection is staged', async () => {
		const { store, values } = secrets();
		store.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'old-refresh');
		const commit = preparePlayStationConnection(store);
		let finishRefresh!: (tokens: object) => void;
		exchangeRefreshTokenForAuthTokens.mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));
		const auth = createPlayStationAuth({ secretStore: store });
		const pending = auth.refresh();
		commit('modal-refresh');
		finishRefresh({ accessToken: 'late-access', refreshToken: 'late-refresh', expiresIn: 3600 });
		await expect(pending).rejects.toBeInstanceOf(PlayStationNeedsAuthenticationError);
		expect(values.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe('modal-refresh');
	});

	it('refuses a staged modal connection after another adapter disconnects', async () => {
		const { store, values } = secrets();
		const commit = preparePlayStationConnection(store);
		await createPlayStationAuth({ secretStore: store }).disconnect();
		expect(() => commit('late-modal-refresh')).toThrow(PlayStationAuthError);
		expect(values.has(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe(false);
	});

	it('shares auth state across adapters using the same secret store', async () => {
		const { store, values } = secrets();
		store.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'old-refresh');
		let finishRefresh!: (tokens: object) => void;
		exchangeRefreshTokenForAuthTokens.mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));
		const first = createPlayStationAuth({ secretStore: store });
		const second = createPlayStationAuth({ secretStore: store });
		const pending = first.getAccessToken();
		await second.disconnect();
		finishRefresh({ accessToken: 'late-access', refreshToken: 'late-refresh', expiresIn: 3600 });
		await expect(pending).rejects.toBeInstanceOf(PlayStationNeedsAuthenticationError);
		expect(values.has(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe(false);
		expect(first.getAccount()).toBeUndefined();
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('exchanges NPSSO in order and never persists the NPSSO value', async () => {
		const { store, values } = secrets();
		exchangeNpssoForAccessCode.mockResolvedValue('access-code');
		exchangeAccessCodeForAuthTokens.mockResolvedValue({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 3600, refreshTokenExpiresIn: 86400 });
		const auth = createPlayStationAuth({ secretStore: store });

		await expect(auth.connectWithNpsso('N'.repeat(64))).resolves.toMatchObject({ provider: 'playstation' });
		expect(exchangeNpssoForAccessCode).toHaveBeenCalledWith('N'.repeat(64));
		expect(exchangeAccessCodeForAuthTokens).toHaveBeenCalledWith('access-code');
		expect([...values.keys()]).toEqual([GAME_SYNC_SECRET_NAMES.psnRefreshToken]);
		expect(JSON.stringify(auth)).not.toContain('N'.repeat(64));
	});

	it('refreshes an absent access token from the namespaced refresh secret', async () => {
		const { store } = secrets();
		store.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'refresh-token');
		exchangeRefreshTokenForAuthTokens.mockResolvedValue({ accessToken: 'new-access-token', refreshToken: 'new-refresh-token', expiresIn: 3600, refreshTokenExpiresIn: 86400 });
		const auth = createPlayStationAuth({ secretStore: store });

		await expect(auth.getAccessToken()).resolves.toBe('new-access-token');
		expect(exchangeRefreshTokenForAuthTokens).toHaveBeenCalledWith('refresh-token');
	});

	it('does not restore tokens when disconnect happens during connect', async () => {
		const { store, values } = secrets();
		let finishExchange!: (tokens: object) => void;
		exchangeNpssoForAccessCode.mockResolvedValue('access-code');
		exchangeAccessCodeForAuthTokens.mockImplementation(() => new Promise((resolve) => { finishExchange = resolve; }));
		const auth = createPlayStationAuth({ secretStore: store });
		const pending = auth.connectWithNpsso('temporary-npsso');
		await Promise.resolve();
		await auth.disconnect();
		finishExchange({ accessToken: 'late-access', refreshToken: 'late-refresh', expiresIn: 3600 });
		await expect(pending).rejects.toBeInstanceOf(PlayStationAuthError);
		expect(values.has(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe(false);
		expect(auth.getAccount()).toBeUndefined();
	});

	it('does not restore tokens when disconnect happens during refresh', async () => {
		const { store, values } = secrets();
		store.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'old-refresh');
		let finishRefresh!: (tokens: object) => void;
		exchangeRefreshTokenForAuthTokens.mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));
		const auth = createPlayStationAuth({ secretStore: store });
		const pending = auth.getAccessToken();
		await auth.disconnect();
		finishRefresh({ accessToken: 'late-access', refreshToken: 'late-refresh', expiresIn: 3600 });
		await expect(pending).rejects.toBeInstanceOf(PlayStationNeedsAuthenticationError);
		expect(values.has(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe(false);
		expect(auth.getAccount()).toBeUndefined();
		await expect(auth.getConnectionStatus()).resolves.toMatchObject({ state: 'needs-auth', connected: false });
	});

	it('does not let an old refresh failure clear a newer connected session', async () => {
		const { store, values } = secrets();
		store.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'old-refresh');
		let failRefresh!: (reason: Error) => void;
		exchangeRefreshTokenForAuthTokens.mockImplementation(() => new Promise((_resolve, reject) => { failRefresh = reject; }));
		exchangeNpssoForAccessCode.mockResolvedValue('access-code');
		exchangeAccessCodeForAuthTokens.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 });
		const auth = createPlayStationAuth({ secretStore: store });
		const oldRequest = auth.getAccessToken();
		await auth.connectWithNpsso('new-npsso');
		failRefresh(new Error('old session expired'));
		await expect(oldRequest).rejects.toBeInstanceOf(PlayStationNeedsAuthenticationError);
		await expect(auth.getAccessToken()).resolves.toBe('new-access');
		await expect(auth.getConnectionStatus()).resolves.toMatchObject({ state: 'connected', connected: true });
		expect(values.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe('new-refresh');
	});

	it('shares a pending refresh between concurrent token requests', async () => {
		const { store, values } = secrets();
		store.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'old-refresh');
		let finishRefresh!: (tokens: object) => void;
		exchangeRefreshTokenForAuthTokens.mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));
		const auth = createPlayStationAuth({ secretStore: store });
		const first = auth.getAccessToken();
		const second = auth.getAccessToken();
		const explicit = auth.refresh();
		expect(exchangeRefreshTokenForAuthTokens).toHaveBeenCalledTimes(1);
		finishRefresh({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 });
		await expect(first).resolves.toBe('new-access');
		await expect(second).resolves.toBe('new-access');
		await expect(explicit).resolves.toBeUndefined();
		expect(values.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe('new-refresh');
	});

	it('reports needs-auth after refresh failure and retains the refresh secret', async () => {
		const { store, values } = secrets();
		store.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'refresh-token');
		exchangeRefreshTokenForAuthTokens.mockRejectedValue(new Error('expired refresh token'));
		const auth = createPlayStationAuth({ secretStore: store });

		await expect(auth.getAccessToken()).rejects.toBeInstanceOf(PlayStationNeedsAuthenticationError);
		expect(values.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe('refresh-token');
		await expect(auth.getConnectionStatus()).resolves.toMatchObject({ state: 'needs-auth', connected: false });
	});
});
