export type LibraryProviderId = 'gametrack' | 'steam' | 'playstation';

export const LIBRARY_PROVIDER_IDS: readonly LibraryProviderId[] = ['gametrack', 'steam', 'playstation'];

export const GAME_TRACK_UNAVAILABLE_CODES = {
	UNSUPPORTED_OS: 'UNSUPPORTED_OS',
	READY: 'READY',
	EXPORT_NOT_SELECTED: 'EXPORT_NOT_SELECTED',
	EXPORT_NOT_FOUND: 'EXPORT_NOT_FOUND',
	EXPORT_INVALID_ZIP: 'EXPORT_INVALID_ZIP',
	EXPORT_MANIFEST_MISSING: 'EXPORT_MANIFEST_MISSING',
	EXPORT_GAMES_MISSING: 'EXPORT_GAMES_MISSING',
	EXPORT_SCHEMA_UNSUPPORTED: 'EXPORT_SCHEMA_UNSUPPORTED',
	EXPORT_CHANGED_DURING_READ: 'EXPORT_CHANGED_DURING_READ',
	EXPORT_PARSE_FAILED: 'EXPORT_PARSE_FAILED',
} as const;

export type GameTrackReadinessCode = typeof GAME_TRACK_UNAVAILABLE_CODES[keyof typeof GAME_TRACK_UNAVAILABLE_CODES];

export interface GameTrackRuntimeStatus {
	readonly code: GameTrackReadinessCode;
	readonly supported: boolean;
	readonly database: 'found' | 'unavailable' | 'unsupported';
	readonly schema: 'supported' | 'unsupported' | 'unknown';
	readonly games: number;
	readonly platforms: readonly string[];
	readonly warningCount?: number;
	readonly errorCodes?: readonly string[];
	readonly transport?: 'csv-export';
	readonly sourceName?: string;
	readonly gameTrackVersion?: string;
	readonly exportCreated?: string;
}

export function isLibraryProviderId(value: unknown): value is LibraryProviderId {
	return typeof value === 'string' && LIBRARY_PROVIDER_IDS.includes(value as LibraryProviderId);
}

export function getRecommendedLibraryProvider(status: GameTrackRuntimeStatus): LibraryProviderId | undefined {
	return status.code === 'READY' && status.supported ? 'gametrack' : undefined;
}

export function isGameTrackReady(status: GameTrackRuntimeStatus | undefined): boolean {
	return status?.code === 'READY' && status.supported;
}
