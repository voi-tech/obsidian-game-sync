import type { ProviderAchievementSet } from './achievement';
import type { ProviderIdentity } from './identity';

export type GameProvider = 'steam' | 'playstation';
export type GamePlatform = string;
export type AcquisitionType = 'purchased' | 'subscription' | 'free' | 'key' | 'gift' | 'unknown';

export interface ProviderGameFreshness {
	metadata: boolean;
	ownership: boolean;
	playtime: boolean;
	achievements: boolean;
}

export interface ProviderGame {
	provider: GameProvider;
	providerGameId: string;
	title: string;
	originalTitle?: string;
	releaseDate?: string;
	description?: string;
	cover?: string;
	developers: string[];
	publishers: string[];
	genres: string[];
	platforms: GamePlatform[];
	owned?: boolean;
	acquisitionType?: AcquisitionType;
	playtimeMinutes?: number;
	lastPlayed?: string;
	achievements?: ProviderAchievementSet;
	sourceUrl?: string;
	freshness: ProviderGameFreshness;
	identity: ProviderIdentity;
}

export type ProviderSnapshotStatus = 'complete' | 'partial' | 'failed';

export interface ProviderPaginationState {
	complete: boolean;
	pagesFetched: number;
	nextCursor?: string;
}

export interface ProviderSnapshotError {
	code: string;
	message: string;
}

export interface ProviderSnapshot {
	provider: GameProvider;
	status: ProviderSnapshotStatus;
	games: ProviderGame[];
	fetchedAt: string;
	pagination: ProviderPaginationState;
	paginationComplete: boolean;
	error?: ProviderSnapshotError;
}

export function isCompleteProviderSnapshot(snapshot: ProviderSnapshot): boolean {
	return snapshot.status === 'complete' && snapshot.paginationComplete === true && snapshot.pagination.complete;
}

export function canDecreaseOwnership(snapshot: ProviderSnapshot): boolean {
	return isCompleteProviderSnapshot(snapshot);
}
