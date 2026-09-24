import { GAME_TRACK_ZIP_MAX_INPUT_SIZE, GameTrackZipError, parseGameTrackZip } from './gametrack-zip';
import type { GameTrackCsvSource } from './gametrack-csv-provider';

interface FileHandle {
	read(buffer: Uint8Array, offset: number, length: number, position: number | null): Promise<{ bytesRead: number }>;
	close(): Promise<void>;
}

interface FileSystemModule {
	open(path: string, flags: string): Promise<FileHandle>;
	stat(path: string): Promise<{ size: number; mtimeMs: number }>;
}

/** Desktop-only persisted-path source. It is loaded lazily after the platform guard. */
export function createGameTrackCsvPathSource(path: string): GameTrackCsvSource {
	return {
		readBundle: async () => {
			const fs = requireNodeModule('node:fs/promises') as FileSystemModule;
			const fileStat = await fs.stat(path);
			if (fileStat.size > GAME_TRACK_ZIP_MAX_INPUT_SIZE) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
			const handle = await fs.open(path, 'r');
			const buffer = new Uint8Array(GAME_TRACK_ZIP_MAX_INPUT_SIZE + 1);
			try {
				let bytesRead = 0;
				while (bytesRead < buffer.byteLength) {
					const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
					if (result.bytesRead === 0) break;
					bytesRead += result.bytesRead;
				}
				if (bytesRead > GAME_TRACK_ZIP_MAX_INPUT_SIZE) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
				return parseGameTrackZip(buffer.subarray(0, bytesRead));
			} finally {
				await handle.close();
			}
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
