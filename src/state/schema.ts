import type { GameIdentity, IdentityMapping } from '../model/identity';
import type { GameProvider, ProviderGame, ProviderSnapshotStatus } from '../model/provider';
import type { Operation } from '../model/operations';
import type { GameSyncSettings } from '../model/settings';
import type { NormalizedGame } from '../model/game';
import type { PropertyMapping } from '../model/property-mapping';

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
	status: 'complete';
	paginationComplete: true;
}

export interface ActivityEntry {
	id: string;
	createdAt: string;
	kind: string;
	message: string;
	data?: Record<string, unknown>;
}

export interface OperationJournalEntry {
	operation: Operation;
	game?: NormalizedGame;
	noteApplied: boolean;
	noteFingerprintAfter?: string;
	providerStateApplied: boolean;
	historyApplied: boolean;
	cacheApplied: boolean;
}

export interface GameSyncData {
	schemaVersion: 1;
	settings: GameSyncSettings;
	propertyMapping: PropertyMapping;
	identityMappings: IdentityMapping[];
	negativeMappings: NegativeIdentityMapping[];
	ignoredCanonicalIds: string[];
	ignoredProviderRefs: string[];
	presence: ProviderPresenceState[];
	providerCursors: Partial<Record<GameProvider, ProviderCursorState>>;
	lastSuccessfulProviderStates: Partial<Record<GameProvider, LastSuccessfulProviderState>>;
	lastSuccessfulProviderSnapshots: Partial<Record<GameProvider, ProviderGame[]>>;
	lastAppliedProviderSnapshots: Partial<Record<GameProvider, ProviderGame[]>>;
	operationJournal: OperationJournalEntry[];
	recentActivity: ActivityEntry[];
	identityIndex: GameIdentity[];
}
