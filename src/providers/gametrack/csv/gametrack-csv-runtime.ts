import type { LibraryProvider, HostPlatform } from '../../../model/canonical-provider';
import type { GameTrackRuntimeStatus } from '../../../model/library-provider';
import { GameTrackCsvProvider, type GameTrackCsvSource } from './gametrack-csv-provider';

export interface GameTrackCsvRuntimeOptions {
	readonly host: HostPlatform;
	readonly source: () => Promise<GameTrackCsvSource | undefined>;
	readonly configured: () => boolean | Promise<boolean>;
}

export class GameTrackCsvRuntime {
	constructor(private readonly options: GameTrackCsvRuntimeOptions) {}

	async getProvider(): Promise<LibraryProvider | undefined> {
		let source: GameTrackCsvSource | undefined;
		try { source = await this.options.source(); } catch { return undefined; }
		return source === undefined ? undefined : new GameTrackCsvProvider({ source, host: this.options.host, requireManifest: true, requireStableIdentity: true });
	}

	async getStatus(): Promise<GameTrackRuntimeStatus> {
		let source: GameTrackCsvSource | undefined;
		try { source = await this.options.source(); } catch { return unavailable('EXPORT_NOT_FOUND'); }
		if (source === undefined) return await this.options.configured() ? unavailable('EXPORT_NOT_FOUND') : unavailable('EXPORT_NOT_SELECTED');
		const provider = new GameTrackCsvProvider({ source, host: this.options.host, requireManifest: true, requireStableIdentity: true });
		let snapshot;
		try { snapshot = await provider.getSnapshot(); } catch { return failed('EXPORT_PARSE_FAILED'); }
		const diagnostics = snapshot.diagnostics;
		const firstCode = diagnostics.diagnostics[0]?.code;
		const code = snapshot.status === 'complete' ? 'READY' : statusCode(firstCode);
		return {
			code, supported: true, database: snapshot.status === 'failed' ? 'unavailable' : 'found', schema: snapshot.status === 'failed' ? 'unknown' : 'supported',
			games: snapshot.games.length, platforms: [...new Set(snapshot.games.flatMap((game) => game.platforms.map((platform) => platform.id)))].sort(),
			warningCount: diagnostics.diagnostics.length, errorCodes: diagnostics.diagnostics.map((diagnostic) => diagnostic.code),
			transport: 'csv-export', sourceName: diagnostics.sourceName, gameTrackVersion: diagnostics.gameTrackVersion, exportCreated: diagnostics.exportCreated,
		};
	}
}

function statusCode(code: string | undefined): GameTrackRuntimeStatus['code'] {
	const normalized = code?.startsWith('CSV_') === true ? code.slice(4) : code;
	if (normalized === 'EXPORT_INVALID_ZIP' || normalized === 'EXPORT_MANIFEST_MISSING' || normalized === 'EXPORT_GAMES_MISSING' || normalized === 'EXPORT_CHANGED_DURING_READ' || normalized === 'EXPORT_PARSE_FAILED' || normalized === 'EXPORT_SCHEMA_UNSUPPORTED') return normalized;
	return 'EXPORT_PARSE_FAILED';
}

function unavailable(code: 'EXPORT_NOT_SELECTED' | 'EXPORT_NOT_FOUND'): GameTrackRuntimeStatus {
	return { code, supported: true, database: 'unavailable', schema: 'unknown', games: 0, platforms: [], transport: 'csv-export' };
}

function failed(code: GameTrackRuntimeStatus['code']): GameTrackRuntimeStatus {
	return { code, supported: true, database: 'found', schema: 'unknown', games: 0, platforms: [], transport: 'csv-export' };
}
