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

	it('keeps the library when one owned game is malformed, and reports it as shorter than game_count', async () => {
		const transport: HttpTransport = async () => ({ status: 200, headers: {}, json: { response: { game_count: 3, games: [
			{ appid: 10, name: 'Game', playtime_forever: 12, rtime_last_played: null },
			{ appid: 20, name: null },
			{ appid: 'broken' },
		] } } });
		const result = await createSteamApi({ http: createHttpClient(transport), apiKey: 'steam-test-key' }).getOwnedGames('76561198000000001');

		// null means "absent", so appid 20 survives; the broken entry is dropped and the library counts as incomplete.
		expect(result.games?.map((game) => game.appid)).toEqual([10, 20]);
		expect(result.game_count).toBe(3);
	});

	it('fails with field paths, never values, when every owned game is malformed', async () => {
		const transport: HttpTransport = async () => ({ status: 200, headers: {}, json: { response: { game_count: 1, games: [{ appid: 'secret-value' }] } } });
		const error = await createSteamApi({ http: createHttpClient(transport), apiKey: 'steam-test-key' }).getOwnedGames('76561198000000001').then(() => new Error('expected failure'), (caught: unknown) => caught as Error);

		expect(error.message).toContain('appid');
		expect(error.message).not.toContain('secret-value');
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

	it('rejects an unsuccessful player-stats body instead of returning an empty achievement list', async () => {
		const transport: HttpTransport = async () => ({ status: 200, headers: {}, json: { playerstats: { success: false, error: 'Profile is not public' } } });

		await expect(createSteamApi({ http: createHttpClient(transport), apiKey: 'steam-test-key' }).getPlayerAchievements('76561198000000001', 10)).rejects.toThrow(/success = false/);
	});
});
