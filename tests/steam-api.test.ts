import { describe, expect, it } from 'vitest';
import { createHttpClient, type HttpTransport } from '../src/network/http';
import { createSteamApi } from '../src/providers/steam/api';

describe('Steam Web API boundary', () => {
	it('requests owned games with app info and played free games enabled', async () => {
		let requestedUrl = '';
		const transport: HttpTransport = async (request) => {
			requestedUrl = request.url;
			return { status: 200, headers: {}, json: { response: { game_count: 1, games: [{ appid: 10, name: 'Game', playtime_forever: 12 }] } } };
		};
		const api = createSteamApi({ http: createHttpClient(transport), apiKey: 'steam-test-key' });

		await expect(api.getOwnedGames('76561198000000001')).resolves.toMatchObject({ game_count: 1 });
		expect(requestedUrl).toContain('include_appinfo=1');
		expect(requestedUrl).toContain('include_played_free_games=1');
	});

	it('requests official Store app details through the shared HTTP boundary', async () => {
		let requestedUrl = '';
		const transport: HttpTransport = async (request) => {
			requestedUrl = request.url;
			return { status: 200, headers: {}, json: { '10': { success: true, data: { type: 'game', is_free: true, genres: [{ description: 'Action' }] } } } };
		};
		const details = await createSteamApi({ http: createHttpClient(transport), apiKey: 'steam-test-key' }).getAppDetails?.(10);

		expect(details).toMatchObject({ type: 'game', is_free: true });
		expect(requestedUrl).toContain('appdetails');
		expect(requestedUrl).toContain('appids=10');
	});

	it('maps an unsuccessful Store app-details response to missing details', async () => {
		const transport: HttpTransport = async () => ({ status: 200, headers: {}, json: { '10': { success: false } } });

		await expect(createSteamApi({ http: createHttpClient(transport), apiKey: 'steam-test-key' }).getAppDetails?.(10)).resolves.toBeUndefined();
	});
});
