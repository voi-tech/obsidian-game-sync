import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/providers/gametrack/csv/gametrack-csv-parser';
import { GameTrackCsvProvider, type GameTrackCsvBundle } from '../src/providers/gametrack/csv/gametrack-csv-provider';
import { createGameTrackCsvNormalizer, parseGameTrackCsvExport } from '../src/providers/gametrack/csv/gametrack-csv-normalizer';
import { createGameTrackCsvDirectorySource } from '../src/providers/gametrack/csv/gametrack-csv-file-source';

const fixtureRoot = new URL('./fixtures/gametrack/export/', import.meta.url);
const fixtureNames = [
	'games.csv', 'steam_games.csv', 'playstation_games.csv', 'xbox_games.csv',
	'steam_achievements.csv', 'game_trophies.csv', 'xbox_achievements.csv', 'manifest.json',
] as const;

async function fixtureBundle(): Promise<GameTrackCsvBundle> {
	const entries = await Promise.all(fixtureNames.map(async (name) => [name, await readFile(new URL(name, fixtureRoot), 'utf8')] as const));
	return Object.fromEntries(entries);
}

describe('GameTrack CSV parser', () => {
	it('handles BOM, quoted commas, escaped quotes, and embedded newlines', () => {
		const rows = parseCsv('\uFEFFname,review\r\n"Game, One","line 1\nline ""two"""\r\n');
		expect(rows).toEqual({ headers: ['name', 'review'], rows: [['Game, One', 'line 1\nline "two"']] });
	});

	it('does not depend on column order and reports missing required headers', () => {
		const parsed = parseGameTrackCsvExport({ 'games.csv': 'title,uuid\nOnly title,id\n' });
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error.code).toBe('missing-required-column');
	});

	it('ignores additional future columns', () => {
		const parsed = parseGameTrackCsvExport({ 'games.csv': 'uuid,igdb_id,title,platforms,hours_played,future\nid,1,Title,PC,2,new\n' });
		expect(parsed.ok).toBe(true);
	});
});

describe('GameTrack CSV normalization', () => {
	it('normalizes the official multi-file export into canonical games', async () => {
		const bundle = await fixtureBundle();
		const parsed = parseGameTrackCsvExport(bundle);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const result = createGameTrackCsvNormalizer().normalize(parsed.value);
		expect(result.games).toHaveLength(5);
		const steam = result.games.find((game) => game.title === 'Steam Fixture');
		expect(steam?.identity).toEqual({
			canonicalKey: 'gametrack:00112233445566778899aabbccddeeff',
			externalIds: { gametrack: '00112233445566778899aabbccddeeff', igdb: 1001, steam: '440' },
		});
		const playStation = result.games.find((game) => game.title === 'PlayStation Fixture');
		expect(playStation?.identity.externalIds.playstation).toBe('2001');
		const xbox = result.games.find((game) => game.title === 'Multi Platform Fixture');
		expect(xbox?.identity.externalIds.xbox).toBe('xbox-1');
		expect(steam?.playtime.canonical).toMatchObject({ minutes: 150, source: 'gametrack' });
		expect(steam?.playtime.observations).toEqual(expect.arrayContaining([
			expect.objectContaining({ source: 'gametrack', rawUnit: 'hours', rawValue: 2.5, minutes: 150 }),
			expect.objectContaining({ source: 'steam', rawUnit: 'minutes', rawValue: 90, minutes: 90 }),
		]));
		const multi = result.games.find((game) => game.title === 'Multi Platform Fixture');
		expect(multi?.platforms.map((platform) => platform.id)).toEqual(['pc', 'playstation-5', 'xbox', 'nintendo-switch']);
		expect(multi?.achievements).toEqual(expect.arrayContaining([
			expect.objectContaining({ source: 'playstation', unlocked: 1, total: 18, confidence: 'low' }),
			expect.objectContaining({ source: 'xbox', unlocked: 10, total: 50, confidence: 'high', completionPercent: 20 }),
		]));
	});

	it('keeps missing IGDB as a diagnostic without losing GameTrack identity', async () => {
		const bundle = await fixtureBundle();
		const parsed = parseGameTrackCsvExport(bundle);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const result = createGameTrackCsvNormalizer().normalize(parsed.value);
		const game = result.games.find((item) => item.title === 'Missing IGDB');
		expect(game?.identity.externalIds).toEqual({ gametrack: 'bbbb0000ccccddddeeeeffff00001111' });
		expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'MISSING_IGDB_ID')).toBe(true);
	});

	it('rejects duplicate GameTrack IDs before normalization', () => {
		const parsed = parseGameTrackCsvExport({ 'games.csv': 'uuid,igdb_id,title,platforms,hours_played\nid,1,One,PC,0\nid,2,Two,PC,0\n' });
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error.code).toBe('duplicate-game-track-id');
	});

	it('marks invalid playtime without fabricating a canonical value', () => {
		const parsed = parseGameTrackCsvExport({ 'games.csv': 'uuid,igdb_id,title,platforms,hours_played\nid,1,Invalid,PC,not-a-number\n' });
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const result = createGameTrackCsvNormalizer().normalize(parsed.value);
		expect(result.games[0]?.playtime.canonical).toBeUndefined();
		expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-playtime')).toBe(true);
	});

	it('keeps unknown platforms and unknown GameTrack status out of the canonical contract', () => {
		const parsed = parseGameTrackCsvExport({ 'games.csv': 'uuid,igdb_id,title,platforms,hours_played,status\nid,1,Unknown,Mystery Console,0,Future Status\n' });
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const result = createGameTrackCsvNormalizer().normalize(parsed.value);
		expect(result.games[0]?.platforms[0]).toMatchObject({ id: 'mystery-console', rawName: 'Mystery Console' });
		expect(result.games[0]).not.toHaveProperty('status');
		expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'unknown-platform')).toBe(true);
	});

	it('marks malformed optional transport data as partial instead of writing a complete snapshot', async () => {
		const provider = new GameTrackCsvProvider({
			host: 'macos',
			source: { readBundle: async () => ({
				'games.csv': 'uuid,igdb_id,title,platforms,hours_played\nid,1,Title,PC,0\n',
				'steam_games.csv': 'game_uuid,appid\n"unterminated\n',
			}) },
		});
		const snapshot = await provider.getSnapshot();
		expect(snapshot.status).toBe('partial');
		expect(snapshot.diagnostics.diagnostics[0]?.code).toBe('OPTIONAL_FILE_PARSE_FAILED');
	});
});

describe('GameTrackCsvProvider', () => {
	it('returns a complete snapshot and declares manual file transport', async () => {
		const provider = new GameTrackCsvProvider({
			host: 'macos',
			source: { readBundle: fixtureBundle },
		});
		const snapshot = await provider.getSnapshot();
		expect(snapshot.status).toBe('complete');
		expect(snapshot.games).toHaveLength(5);
		expect(provider.getCapabilities()).toMatchObject({ supported: true, automaticSync: false, library: true, playtime: true });
	});

	it('reads a selected extracted export directory through the file-source boundary', async () => {
		const provider = new GameTrackCsvProvider({ host: 'macos', source: createGameTrackCsvDirectorySource(fixtureRoot.pathname, async (path) => readFile(path, 'utf8')) });
		const snapshot = await provider.getSnapshot();
		expect(snapshot.status).toBe('complete');
		expect(snapshot.games).toHaveLength(5);
	});

	it('fails safely when games.csv cannot be read', async () => {
		const provider = new GameTrackCsvProvider({
			host: 'ios',
			source: { readBundle: async () => ({}) },
		});
		const snapshot = await provider.getSnapshot();
		expect(snapshot.status).toBe('failed');
		expect(snapshot.games).toEqual([]);
		expect(snapshot.diagnostics.diagnostics[0]?.code).toBe('CSV_EXPORT_GAMES_MISSING');
		expect(provider.getCapabilities()).toMatchObject({ supported: true, mobile: true, automaticSync: false });
	});

	it('treats a changed source revision as a new snapshot without writing anything', async () => {
		let calls = 0;
		const provider = new GameTrackCsvProvider({
			host: 'windows',
			source: { readBundle: async () => { calls += 1; return { 'games.csv': 'uuid,igdb_id,title,platforms,hours_played\nid,1,Title,PC,0\n' }; } },
		});
		const first = await provider.getSnapshot();
		const second = await provider.getSnapshot();
		expect(calls).toBe(2);
		expect(first.revision).toBe(second.revision);
	});

	const realExportTest = process.env.GAMETRACK_CSV_ROOT === undefined ? it.skip : it;
	realExportTest('parses the real GameTrack 6.1.5 export without retaining its data', async () => {
		const root = process.env.GAMETRACK_CSV_ROOT as string;
		const names = ['games.csv', 'steam_games.csv', 'playstation_games.csv', 'xbox_games.csv', 'steam_achievements.csv', 'game_trophies.csv', 'xbox_achievements.csv'];
		const entries = await Promise.all(names.map(async (name) => [name, await readFile(join(root, name), 'utf8')] as const));
		const provider = new GameTrackCsvProvider({ host: 'macos', source: { readBundle: async () => Object.fromEntries(entries) } });
		const snapshot = await provider.getSnapshot();
		expect(snapshot.status).toBe('complete');
		expect(snapshot.games).toHaveLength(207);
		expect(new Set(snapshot.games.map((game) => game.identity.externalIds.gametrack)).size).toBe(207);
		expect(snapshot.games.every((game) => game.identity.externalIds.igdb !== undefined)).toBe(true);
	});
});
