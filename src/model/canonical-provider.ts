import type { CanonicalGame } from './canonical-game';

export type HostPlatform = 'macos' | 'windows' | 'linux' | 'ios' | 'ipados' | 'android' | 'unknown';

export interface GameProviderCapabilities {
	readonly supported: boolean;
	readonly desktop: boolean;
	readonly mobile: boolean;
	readonly automaticSync: boolean;
	readonly library: boolean;
	readonly metadata: boolean;
	readonly platforms: boolean;
	readonly playtime: boolean;
	readonly achievementSummary: boolean;
}

export interface ProviderDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly gameId?: string;
	readonly field?: string;
}

export interface GameProviderDiagnostics {
	readonly provider: string;
	readonly database: 'found' | 'unavailable' | 'unsupported';
	readonly schema: 'supported' | 'unsupported' | 'unknown';
	readonly gamesRead: number;
	readonly gamesNormalized: number;
	readonly diagnostics: readonly ProviderDiagnostic[];
	readonly transport?: 'csv-export';
	readonly sourceName?: string;
	readonly schemaSignature?: string;
	readonly gameTrackVersion?: string;
	readonly exportCreated?: string;
}

export type CanonicalSnapshotStatus = 'complete' | 'partial' | 'failed';

export interface CanonicalLibrarySnapshot {
	readonly status: CanonicalSnapshotStatus;
	readonly games: readonly CanonicalGame[];
	readonly revision?: string;
	readonly diagnostics: GameProviderDiagnostics;
}

export interface LibraryProvider {
	readonly id: string;
	getCapabilities(): GameProviderCapabilities;
	isAvailable(): Promise<boolean>;
	getSnapshot(): Promise<CanonicalLibrarySnapshot>;
	getLibrary(): Promise<readonly CanonicalGame[]>;
	getDiagnostics(): GameProviderDiagnostics;
}
