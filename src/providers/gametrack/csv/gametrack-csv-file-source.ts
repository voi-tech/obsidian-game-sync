import type { GameTrackCsvBundle } from './gametrack-csv-normalizer';
import { GAME_TRACK_ZIP_MAX_INPUT_SIZE, GameTrackZipError, parseGameTrackZip } from './gametrack-zip';
import type { GameTrackCsvSelection, GameTrackCsvSource } from './gametrack-csv-provider';

const CSV_FILES = [
	'manifest.json', 'games.csv', 'steam_games.csv', 'playstation_games.csv', 'xbox_games.csv',
	'steam_achievements.csv', 'game_trophies.csv', 'xbox_achievements.csv',
] as const;

/** Reads an already extracted GameTrack export directory. ZIP acquisition and platform file APIs stay outside this boundary. */
export function createGameTrackCsvDirectorySource(directory: string, readText: (path: string) => Promise<string>): GameTrackCsvSource {
	return {
		readBundle: async (): Promise<GameTrackCsvBundle> => {
			const entries = await Promise.all(CSV_FILES.map(async (filename) => {
				try { return [filename, await readText(`${directory.replace(/[\\/]$/u, '')}/${filename}`)] as const; }
				catch { return [filename, undefined] as const; }
			}));
			const bundle: Record<string, string> = {};
			for (const [filename, value] of entries) if (value !== undefined) bundle[filename] = value;
			return bundle;
		},
	};
}

export interface GameTrackFileLike {
	readonly name: string;
	readonly size: number;
	readonly lastModified: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export function createGameTrackCsvFileSource(file: GameTrackFileLike, path?: string): GameTrackCsvSource {
	const selection: GameTrackCsvSelection = { name: file.name, size: file.size, modifiedAt: file.lastModified, ...(path === undefined ? {} : { path }) };
	return {
		readBundle: async () => {
			if (file.size > GAME_TRACK_ZIP_MAX_INPUT_SIZE) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
			return parseGameTrackZip(new Uint8Array(await file.arrayBuffer()));
		},
		getFingerprint: async () => ({ name: file.name, size: file.size, modifiedAt: file.lastModified }),
		getSelection: () => selection,
	};
}
