import type { ProviderAccount } from '../model/provider';
import type { ProviderAchievementSet } from '../model/achievement';
import type { GameProvider, ProviderGame, ProviderSnapshot } from '../model/provider';

export type ProviderConnectionState = 'connected' | 'disconnected' | 'needs-auth' | 'error';

export interface ProviderConnectionStatus {
	provider: GameProvider;
	state: ProviderConnectionState;
	connected: boolean;
	account?: ProviderAccount;
	error?: { code: string; message: string };
}

export interface ProviderFetchOptions {
	now?: string;
	force?: boolean;
	previousGames?: readonly ProviderGame[];
	achievementCache?: Readonly<Record<string, {
		fetchedAt: string;
		playtimeMinutes?: number;
		lastPlayed?: string;
		achievements?: ProviderAchievementSet;
	}>>;
	achievementCacheTtlMs?: number;
}

export interface GameProviderAdapter {
	readonly id: GameProvider;
	getConnectionStatus(): Promise<ProviderConnectionStatus>;
	testConnection(): Promise<ProviderAccount>;
	fetchLibrary(options: ProviderFetchOptions): Promise<ProviderSnapshot>;
	disconnect(): Promise<void>;
}
