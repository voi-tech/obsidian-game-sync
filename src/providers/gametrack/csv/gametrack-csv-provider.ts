import type { CanonicalGame } from '../../../model/canonical-game';
import type { CanonicalLibrarySnapshot, LibraryProvider, GameProviderCapabilities, GameProviderDiagnostics, HostPlatform, ProviderDiagnostic } from '../../../model/canonical-provider';
import { createGameTrackCsvNormalizer, parseGameTrackCsvExport, type GameTrackCsvBundle, type GameTrackCsvParseOptions } from './gametrack-csv-normalizer';

export type { GameTrackCsvBundle } from './gametrack-csv-normalizer';

export interface GameTrackCsvSource {
	readBundle(): Promise<GameTrackCsvBundle>;
	getFingerprint?: () => Promise<GameTrackExportFingerprint>;
	getSelection?: () => GameTrackCsvSelection | undefined;
}

export interface GameTrackExportFingerprint {
	readonly name: string;
	readonly size: number;
	readonly modifiedAt: number;
	readonly hash?: string;
}

export interface GameTrackCsvSelection {
	readonly name: string;
	readonly path?: string;
	readonly size: number;
	readonly modifiedAt: number;
	readonly fingerprint?: string;
}

export interface GameTrackCsvProviderOptions {
	readonly source: GameTrackCsvSource;
	readonly host: HostPlatform;
	readonly requireManifest?: boolean;
	readonly requireStableIdentity?: boolean;
	readonly beforeRead?: () => void | Promise<void>;
}

export class GameTrackCsvProvider implements LibraryProvider {
	readonly id = 'gametrack';
	private readonly capabilities: GameProviderCapabilities;
	private diagnostics: GameProviderDiagnostics = {
		provider: 'gametrack', database: 'unavailable', schema: 'unknown', gamesRead: 0, gamesNormalized: 0, diagnostics: [],
	};

	constructor(private readonly options: GameTrackCsvProviderOptions) {
		this.capabilities = getCsvCapabilities(options.host);
	}

	getCapabilities(): GameProviderCapabilities { return this.capabilities; }
	getDiagnostics(): GameProviderDiagnostics { return this.diagnostics; }

	async isAvailable(): Promise<boolean> {
		if (!this.capabilities.supported) return false;
		try {
			const parsed = parseGameTrackCsvExport(await this.options.source.readBundle(), parseOptions(this.options));
			return parsed.ok;
		} catch {
			return false;
		}
	}

	async getSnapshot(): Promise<CanonicalLibrarySnapshot> {
		if (!this.capabilities.supported) {
			this.diagnostics = { ...this.diagnostics, database: 'unsupported' };
			return { status: 'failed', games: [], diagnostics: this.diagnostics };
		}
		let bundle: GameTrackCsvBundle;
		let before: GameTrackExportFingerprint | undefined;
		try {
			before = await this.options.source.getFingerprint?.();
			await this.options.beforeRead?.();
			bundle = await this.options.source.readBundle();
			const after = await this.options.source.getFingerprint?.();
			if (!sameFingerprint(before, after)) return this.failed('EXPORT_CHANGED_DURING_READ', 'The GameTrack export changed while it was being read.');
		} catch (error) {
			if (error instanceof GameTrackCsvProviderError) return this.failed(error.code, error.message);
			return this.failed('EXPORT_SOURCE_READ_FAILED', 'The selected GameTrack export could not be read.');
		}
		const parsed = parseGameTrackCsvExport(bundle, parseOptions(this.options));
		if (!parsed.ok) return this.failed(`CSV_${toDiagnosticCode(parsed.error.code)}`, parsed.error.message);
		const result = createGameTrackCsvNormalizer().normalize(parsed.value);
		const diagnostics: ProviderDiagnostic[] = [...parsed.value.parseDiagnostics, ...result.diagnostics];
		this.diagnostics = {
			provider: this.id, database: 'found', schema: 'supported', gamesRead: parsed.value.games.length,
			gamesNormalized: result.games.length, diagnostics, transport: 'csv-export',
			...(this.options.source.getSelection?.() === undefined ? {} : { sourceName: this.options.source.getSelection()?.name }),
			...(parsed.value.manifest?.appVersion === undefined ? {} : { gameTrackVersion: parsed.value.manifest.appVersion }),
			...(parsed.value.manifest?.exportDate === undefined ? {} : { exportCreated: parsed.value.manifest.exportDate }),
			schemaSignature: parsed.value.schemaSignature,
		};
		return {
			status: result.games.length === parsed.value.games.length && parsed.value.parseDiagnostics.length === 0 ? 'complete' : 'partial',
			games: result.games,
			revision: `${parsed.value.schemaSignature}:${revision(result.games, before)}`,
			diagnostics: this.diagnostics,
		};
	}

	async getLibrary(): Promise<readonly CanonicalGame[]> { return (await this.getSnapshot()).games; }

	private failed(code: string, message: string): CanonicalLibrarySnapshot {
		this.diagnostics = { provider: this.id, database: 'unavailable', schema: code.includes('SCHEMA') || code.includes('MANIFEST') ? 'unsupported' : 'unknown', gamesRead: 0, gamesNormalized: 0, diagnostics: [{ code, message }], transport: 'csv-export' };
		return { status: 'failed', games: [], diagnostics: this.diagnostics };
	}
}

class GameTrackCsvProviderError extends Error {
	constructor(readonly code: string, message: string) { super(message); this.name = 'GameTrackCsvProviderError'; }
}

function parseOptions(options: GameTrackCsvProviderOptions): GameTrackCsvParseOptions {
	return { requireManifest: options.requireManifest, requireStableIdentity: options.requireStableIdentity };
}

function sameFingerprint(before: GameTrackExportFingerprint | undefined, after: GameTrackExportFingerprint | undefined): boolean {
	if (before === undefined || after === undefined) return true;
	return before.name === after.name && before.size === after.size && before.modifiedAt === after.modifiedAt && before.hash === after.hash;
}

function getCsvCapabilities(host: HostPlatform): GameProviderCapabilities {
	const mobile = host === 'ios' || host === 'ipados' || host === 'android';
	const desktop = host === 'macos' || host === 'windows' || host === 'linux';
	return {
		supported: desktop || mobile,
		desktop,
		mobile,
		automaticSync: false,
		library: true,
		metadata: true,
		platforms: true,
		playtime: true,
		achievementSummary: true,
	};
}

function toDiagnosticCode(code: string): string {
	return ({
		'missing-required-file': 'EXPORT_GAMES_MISSING',
		'missing-required-column': 'EXPORT_SCHEMA_UNSUPPORTED',
		'duplicate-game-track-id': 'DUPLICATE_GAME_TRACK_ID',
		'invalid-csv': 'INVALID_CSV',
		'missing-manifest': 'EXPORT_MANIFEST_MISSING',
		'invalid-manifest': 'EXPORT_PARSE_FAILED',
		'missing-stable-identity': 'EXPORT_SCHEMA_UNSUPPORTED',
	} as Readonly<Record<string, string>>)[code] ?? 'CSV_PARSE_FAILED';
}

function revision(games: readonly CanonicalGame[], source?: GameTrackExportFingerprint): string {
	let hash = 2166136261;
	for (const game of [...games].sort((a, b) => a.identity.canonicalKey.localeCompare(b.identity.canonicalKey))) {
		for (const character of JSON.stringify(game)) {
			 hash ^= character.charCodeAt(0);
			hash = Math.imul(hash, 16777619);
		}
	}
	for (const character of source === undefined ? '' : `${source.name}|${source.size}|${source.modifiedAt}|${source.hash ?? ''}`) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}
