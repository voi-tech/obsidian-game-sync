import { parseGameTrackZip } from './gametrack-zip';
import type { GameTrackCsvSource } from './gametrack-csv-provider';

interface FileSystemModule {
	readFile(path: string): Promise<Uint8Array>;
	stat(path: string): Promise<{ size: number; mtimeMs: number }>;
}

/** Desktop-only persisted-path source. It is loaded lazily after the platform guard. */
export function createGameTrackCsvPathSource(path: string): GameTrackCsvSource {
	return {
		readBundle: async () => {
			const fs = requireNodeModule('node:fs/promises') as FileSystemModule;
			const bytes = await fs.readFile(path);
			return parseGameTrackZip(bytes);
		},
		getFingerprint: async () => {
			const fs = requireNodeModule('node:fs/promises') as FileSystemModule;
			const stat = await fs.stat(path);
			return { name: basename(path), size: stat.size, modifiedAt: stat.mtimeMs };
		},
		getSelection: () => ({ name: basename(path), path, size: 0, modifiedAt: 0 }),
	};
}

function basename(path: string): string {
	return path.split(/[\\/]/u).at(-1) || 'GameTrack export.zip';
}

function requireNodeModule(name: string): unknown {
	return require(name);
}

declare const require: (moduleName: string) => unknown;
