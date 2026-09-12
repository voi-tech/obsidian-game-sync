import { describe, expect, it } from 'vitest';
import { ProviderAuthError } from '../src/network/errors';
import { createSteamAuth, SteamInvalidApiKeyError, SteamPrivateGameDetailsError } from '../src/providers/steam/auth';
import type { HttpClient, HttpRequest } from '../src/network/http';
import type { SecretStore } from '../src/auth/secrets';

function secretStore(initialApiKey = 'steam-test-key'): SecretStore {
	let value: string | null = initialApiKey;
	return {
		get: () => value,
		set: (_name, next) => {
			value = next;
		},
		delete: () => {
			value = null;
		},
	};
}

describe('Steam authentication', () => {
	it('accepts SteamID64 and returns only public account metadata', async () => {
		const http: HttpClient = {
			request: async <T>(request: HttpRequest) => request.url.includes('GetOwnedGames')
				? ({ response: { game_count: 1, games: [] } } as T)
				: ({ response: { players: [{ steamid: '76561198000000001', personaname: 'Test Player', profileurl: 'https://steamcommunity.com/id/test' }] } } as T),
		};
		const auth = createSteamAuth({ http, secretStore: secretStore(), account: '76561198000000001' });

		await expect(auth.testConnection()).resolves.toMatchObject({
			provider: 'steam',
			displayName: 'Test Player',
			accountId: '76561198000000001',
		});
	});

	it('resolves a public vanity profile URL before validating the account', async () => {
		const requests: string[] = [];
		const http: HttpClient = {
			request: async <T>(request: HttpRequest) => {
				requests.push(request.url);
				if (request.url.includes('ResolveVanityURL')) {
					return { response: { success: 1, steamid: '76561198000000002' } } as T;
				}
				return (request.url.includes('GetOwnedGames') ? { response: { game_count: 1, games: [] } } : { response: { players: [{ steamid: '76561198000000002', personaname: 'Vanity Player' }] } }) as T;
			},
		};
		const auth = createSteamAuth({ http, secretStore: secretStore(), account: 'https://steamcommunity.com/id/vanity-player/' });

		await expect(auth.testConnection()).resolves.toMatchObject({ accountId: '76561198000000002' });
		expect(requests[0]).toContain('ResolveVanityURL');
		expect(requests[0]).toContain('vanityurl=vanity-player');
	});

	it('keeps invalid API-key errors distinct from private Game Details', async () => {
		const invalidKeyHttp: HttpClient = {
			request: async () => {
				throw new ProviderAuthError('provider rejected credentials');
			},
		};
		const invalidKeyAuth = createSteamAuth({ http: invalidKeyHttp, secretStore: secretStore(), account: '76561198000000001' });
		await expect(invalidKeyAuth.testConnection()).rejects.toBeInstanceOf(SteamInvalidApiKeyError);

		const privateHttp: HttpClient = {
			request: async <T>(request: HttpRequest) => {
				if (request.url.includes('GetPlayerSummaries')) {
					return { response: { players: [{ steamid: '76561198000000001', personaname: 'Private Player' }] } } as T;
				}
				return { response: {} } as T;
			},
		};
		const privateAuth = createSteamAuth({ http: privateHttp, secretStore: secretStore(), account: '76561198000000001' });
		await expect(privateAuth.testConnection()).rejects.toBeInstanceOf(SteamPrivateGameDetailsError);
	});
});
