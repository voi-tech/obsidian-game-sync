import { playStationClient } from './client';
import type { ProviderAccount } from '../../model/provider';
import type { SecretStore } from '../../auth/secrets';
import { GAME_SYNC_SECRET_NAMES, isNpssoValue } from '../../auth/secrets';
import type { ProviderConnectionStatus } from '../provider';
import type { PlayStationAuthOptions, PlayStationAuthService, PlayStationAuthTokens } from './types';

export class PlayStationNeedsAuthenticationError extends Error {
	readonly code = 'playstation-needs-auth';

	constructor() {
		super('PlayStation authentication is required. Connect the account again with an NPSSO value.');
		this.name = 'PlayStationNeedsAuthenticationError';
	}
}

export class PlayStationAuthError extends Error {
	readonly code = 'playstation-auth-failed';

	constructor() {
		super('PlayStation authentication failed. Check the account connection and try again.');
		this.name = 'PlayStationAuthError';
	}
}

interface TokenPayload {
	account_id?: string;
	accountId?: string;
	online_id?: string;
	onlineId?: string;
}

function decodePayload(token: string): TokenPayload {
	try {
		const encoded = token.split('.')[1];
		if (encoded === undefined || typeof atob !== 'function') return {};
		const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
		return JSON.parse(decoded) as TokenPayload;
	} catch {
		return {};
	}
}

function accountFromTokens(tokens: PlayStationAuthTokens): ProviderAccount {
	const payload = decodePayload(tokens.idToken ?? tokens.accessToken);
	const accountId = tokens.accountId ?? payload.account_id ?? payload.accountId ?? 'playstation-account';
	return { provider: 'playstation', accountId, displayName: tokens.displayName ?? payload.online_id ?? payload.onlineId ?? accountId };
}

interface SessionController {
	auth: PlayStationAuthService;
	beginConnection: () => (refreshToken: string) => void;
}

const sessions = new WeakMap<SecretStore, SessionController>();

/** Stage a modal connection without persisting anything until it is still current. */
export function preparePlayStationConnection(secretStore: SecretStore): (refreshToken: string) => void {
	createPlayStationAuth({ secretStore });
	return sessions.get(secretStore)!.beginConnection();
}

export function createPlayStationAuth(options: PlayStationAuthOptions): PlayStationAuthService {
	const existing = sessions.get(options.secretStore);
	if (existing !== undefined) return existing.auth;
	let accessToken: string | undefined;
	let accessTokenExpiresAt = 0;
	let account: ProviderAccount | undefined;
	let needsAuthentication = false;
	let generation = 0;
	let refreshInFlight: Promise<void> | undefined;
	const skew = options.accessTokenLifetimeSkewMs ?? 30_000;
	const client = options.client ?? playStationClient;

	const storeTokens = (tokens: PlayStationAuthTokens): void => {
		accessToken = tokens.accessToken;
		accessTokenExpiresAt = Date.now() + Math.max(0, tokens.expiresIn * 1000 - skew);
		options.secretStore.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, tokens.refreshToken);
		account = accountFromTokens(tokens);
		needsAuthentication = false;
	};

	const auth: PlayStationAuthService = {
		async connectWithNpsso(npsso: string): Promise<ProviderAccount> {
			if (!isNpssoValue(npsso)) throw new PlayStationAuthError();
			const startedAt = ++generation;
			refreshInFlight = undefined;
			try {
				const accessCode = await client.exchangeNpssoForAccessCode(npsso);
				if (startedAt !== generation) throw new PlayStationAuthError();
				const tokens = await client.exchangeAccessCodeForAuthTokens(accessCode) as PlayStationAuthTokens;
				if (startedAt !== generation) throw new PlayStationAuthError();
				storeTokens(tokens);
				return account as ProviderAccount;
			} catch (error) {
				if (error instanceof PlayStationAuthError) throw error;
				throw new PlayStationAuthError();
			}
		},
		async getAccessToken(): Promise<string> {
			if (accessToken !== undefined && Date.now() < accessTokenExpiresAt) return accessToken;
			const refreshToken = options.secretStore.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken);
			if (refreshToken === null) throw new PlayStationNeedsAuthenticationError();
			await this.refresh();
			if (accessToken === undefined) throw new PlayStationNeedsAuthenticationError();
			return accessToken;
		},
		async refresh(): Promise<void> {
			if (refreshInFlight !== undefined) return refreshInFlight;
			const refreshToken = options.secretStore.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken);
			if (refreshToken === null) throw new PlayStationNeedsAuthenticationError();
			const startedAt = generation;
			const pending = (async () => {
				try {
					const tokens = await client.exchangeRefreshTokenForAuthTokens(refreshToken) as PlayStationAuthTokens;
					if (startedAt !== generation) throw new PlayStationNeedsAuthenticationError();
					storeTokens(tokens);
				} catch {
					if (startedAt === generation) {
						accessToken = undefined;
						needsAuthentication = true;
					}
					throw new PlayStationNeedsAuthenticationError();
				}
			})();
			refreshInFlight = pending;
			try {
				await pending;
			} finally {
				if (refreshInFlight === pending) refreshInFlight = undefined;
			}
		},
		async disconnect(): Promise<void> {
			generation++;
			refreshInFlight = undefined;
			accessToken = undefined;
			accessTokenExpiresAt = 0;
			account = undefined;
			needsAuthentication = false;
			options.secretStore.delete(GAME_SYNC_SECRET_NAMES.psnRefreshToken);
			options.secretStore.delete(GAME_SYNC_SECRET_NAMES.psnAccessToken);
		},
		async getConnectionStatus(): Promise<ProviderConnectionStatus> {
			if (accessToken !== undefined && Date.now() < accessTokenExpiresAt && account !== undefined) return { provider: 'playstation', state: 'connected', connected: true, account };
			if (needsAuthentication || options.secretStore.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken) === null) return { provider: 'playstation', state: 'needs-auth', connected: false, error: { code: 'playstation-needs-auth', message: 'PlayStation authentication is required.' } };
			return { provider: 'playstation', state: 'disconnected', connected: false };
		},
		getAccount(): ProviderAccount | undefined {
			return account;
		},
	};
	sessions.set(options.secretStore, {
		auth,
		beginConnection: () => {
			const startedAt = ++generation;
			refreshInFlight = undefined;
			return (refreshToken) => {
				if (startedAt !== generation) throw new PlayStationAuthError();
				options.secretStore.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, refreshToken);
				generation++;
				refreshInFlight = undefined;
				accessToken = undefined;
				accessTokenExpiresAt = 0;
				account = undefined;
				needsAuthentication = false;
			};
		},
	});
	return auth;
}
