import { ProviderAuthError } from '../../network/errors';
import type { ProviderAccount } from '../../model/provider';
import type { ProviderConnectionStatus } from '../provider';
import { createSteamApi } from './api';
import type { SteamApi, SteamAuthOptions, SteamAuthService } from './types';

export class SteamInvalidApiKeyError extends Error {
	readonly code = 'steam-invalid-api-key';

	constructor() {
		super('Steam Web API key is invalid or rejected. Check the key in Game Sync settings.');
		this.name = 'SteamInvalidApiKeyError';
	}
}

export class SteamPrivateGameDetailsError extends Error {
	readonly code = 'steam-private-game-details';

	constructor() {
		super('Steam Game Details are private. Set the Steam profile and Game Details visibility to Public.');
		this.name = 'SteamPrivateGameDetailsError';
	}
}

export class SteamAccountInputError extends Error {
	readonly code = 'steam-invalid-account';

	constructor() {
		super('Enter a SteamID64 or a resolvable public Steam profile URL.');
		this.name = 'SteamAccountInputError';
	}
}

function parseSteamAccountInput(value: string): { steamId64?: string; vanity?: string } {
	const trimmed = value.trim();
	if (/^\d{17}$/.test(trimmed)) return { steamId64: trimmed };
	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'steamcommunity.com') throw new Error('unsupported');
		const parts = url.pathname.split('/').filter(Boolean);
		if (parts[0] === 'profiles' && /^\d{17}$/.test(parts[1] ?? '')) return { steamId64: parts[1] };
		if (parts[0] === 'id' && parts[1] !== undefined && /^[A-Za-z0-9_-]+$/.test(parts[1])) return { vanity: parts[1] };
	} catch {
		// Convert all malformed inputs to one human-readable configuration error.
	}
	throw new SteamAccountInputError();
}

export function createSteamAuth(options: SteamAuthOptions, providedApi?: SteamApi): SteamAuthService {
	const secretName = options.apiKeySecretName ?? 'steam-api-key';
	let resolvedSteamId64: string | undefined;
	let account: ProviderAccount | undefined;

	const apiFor = (): SteamApi => {
		const apiKey = options.secretStore.get(secretName);
		if (apiKey === null) throw new SteamInvalidApiKeyError();
		return providedApi ?? createSteamApi({ http: options.http, apiKey, baseUrl: options.baseUrl });
	};

	const resolve = async (): Promise<string> => {
		if (resolvedSteamId64 !== undefined) return resolvedSteamId64;
		const input = parseSteamAccountInput(options.account);
		if (input.steamId64 !== undefined) {
			resolvedSteamId64 = input.steamId64;
			return resolvedSteamId64;
		}
		try {
			const result = await apiFor().resolveVanityUrl(input.vanity as string);
			if (result.success !== 1 || result.steamid === undefined) {
				if (result.success === 42) throw new SteamInvalidApiKeyError();
				throw new SteamAccountInputError();
			}
			resolvedSteamId64 = result.steamid;
			return resolvedSteamId64;
		} catch (error) {
			if (error instanceof SteamInvalidApiKeyError || error instanceof SteamAccountInputError) throw error;
			if (error instanceof ProviderAuthError) throw new SteamInvalidApiKeyError();
			throw error;
		}
	};

	return {
		async resolveSteamId64(): Promise<string> {
			return resolve();
		},
		async testConnection(): Promise<ProviderAccount> {
			const api = apiFor();
			const steamId64 = await resolve();
			let players;
			try {
				players = await api.getPlayerSummaries(steamId64);
			} catch (error) {
				if (error instanceof ProviderAuthError) throw new SteamInvalidApiKeyError();
				throw error;
			}
			const player = players.find((entry) => entry.steamid === steamId64);
			if (player === undefined) throw new SteamAccountInputError();
			let gameCount: number | undefined;
			try {
				const games = await api.getOwnedGames(steamId64);
				gameCount = games.game_count;
				if (games.games === undefined && games.game_count === undefined) throw new SteamPrivateGameDetailsError();
			} catch (error) {
				if (error instanceof SteamPrivateGameDetailsError) throw error;
				if (error instanceof ProviderAuthError) throw new SteamInvalidApiKeyError();
				throw error;
			}
			account = { provider: 'steam', displayName: player.personaname, accountId: steamId64, gameCount };
			return account;
		},
		async getConnectionStatus(): Promise<ProviderConnectionStatus> {
			try {
				const connectedAccount = account ?? await this.testConnection();
				return { provider: 'steam', state: 'connected', connected: true, account: connectedAccount };
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Steam connection failed.';
				return { provider: 'steam', state: error instanceof SteamInvalidApiKeyError ? 'needs-auth' : 'error', connected: false, error: { code: error instanceof Error && 'code' in error ? String(error.code) : 'steam-connection-failed', message } };
			}
		},
		async disconnect(): Promise<void> {
			options.secretStore.delete(secretName);
			resolvedSteamId64 = undefined;
			account = undefined;
		},
	};
}
