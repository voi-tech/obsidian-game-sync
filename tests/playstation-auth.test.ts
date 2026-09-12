import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../src/auth/secrets';
import { GAME_SYNC_SECRET_NAMES } from '../src/auth/secrets';

const { exchangeNpssoForAccessCode, exchangeAccessCodeForAuthTokens, exchangeRefreshTokenForAuthTokens } = vi.hoisted(() => ({
	exchangeNpssoForAccessCode: vi.fn(),
	exchangeAccessCodeForAuthTokens: vi.fn(),
	exchangeRefreshTokenForAuthTokens: vi.fn(),
}));

vi.mock('psn-api', () => ({ exchangeNpssoForAccessCode, exchangeAccessCodeForAuthTokens, exchangeRefreshTokenForAuthTokens }));

import { createPlayStationAuth } from '../src/providers/playstation/auth';
import { PlayStationNeedsAuthenticationError } from '../src/providers/playstation/auth';

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
