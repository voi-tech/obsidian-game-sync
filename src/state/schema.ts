import type { GameIdentity, IdentityMapping } from '../model/identity';
import type { GameProvider, ProviderSnapshotStatus } from '../model/provider';
import type { GameSyncSettings } from '../model/settings';

export interface NegativeIdentityMapping {
	leftCanonicalId: string;
	rightCanonicalId: string;
}

export interface ProviderPresenceState {
	provider: GameProvider;
	providerGameId: string;
	canonicalGameId: string;
	owned: boolean;
	consecutiveMissing: number;
	lastSnapshotStatus: ProviderSnapshotStatus;
	paginationComplete: boolean;
	lastSeenAt?: string;
}

export interface ProviderCursorState {
	cursor?: string;
	page: number;
}

export interface LastSuccessfulProviderState {
	provider: GameProvider;
	fetchedAt: string;
	gameIds: string[];
	paginationComplete: true;
}

export interface ActivityEntry {
	id: string;
	createdAt: string;
	kind: string;
	message: string;
	data?: Record<string, unknown>;
}

export interface GameSyncData {
	schemaVersion: 1;
	settings: GameSyncSettings;
	identityMappings: IdentityMapping[];
	negativeMappings: NegativeIdentityMapping[];
	ignoredCanonicalIds: string[];
	ignoredProviderRefs: string[];
	presence: ProviderPresenceState[];
	providerCursors: Partial<Record<GameProvider, ProviderCursorState>>;
	lastSuccessfulProviderStates: Partial<Record<GameProvider, LastSuccessfulProviderState>>;
	recentActivity: ActivityEntry[];
	identityIndex: GameIdentity[];
}
