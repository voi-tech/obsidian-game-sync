import type { ProviderDiagnostic } from '../../../model/canonical-provider';
import type { CanonicalGame } from '../../../model/canonical-game';
import type { GameTrackAchievementData, GameTrackPlatformPlaytime, GameTrackRawGame } from '../gametrack-types';
import { normalizeGameTrackGame } from '../gametrack-normalizer';
import { parseCsv, tableRecords, type CsvTable } from './gametrack-csv-parser';

export const GAME_TRACK_CSV_REQUIRED_HEADERS = ['uuid', 'igdb_id', 'title', 'platforms', 'hours_played'] as const;
export const GAME_TRACK_CSV_REQUIRED_FILE = 'games.csv';

export interface GameTrackCsvBundle {
	readonly [filename: string]: string | undefined;
}

export interface GameTrackCsvExport {
	readonly games: readonly Readonly<Record<string, string>>[];
	readonly steamGames: readonly Readonly<Record<string, string>>[];
	readonly playStationGames: readonly Readonly<Record<string, string>>[];
	readonly xboxGames: readonly Readonly<Record<string, string>>[];
	readonly steamAchievements: readonly Readonly<Record<string, string>>[];
	readonly gameTrophies: readonly Readonly<Record<string, string>>[];
	readonly xboxAchievements: readonly Readonly<Record<string, string>>[];
	readonly schemaSignature: string;
	readonly parseDiagnostics: readonly ProviderDiagnostic[];
	readonly manifest?: GameTrackExportManifest;
}

export interface GameTrackExportManifest {
	readonly version?: string;
	readonly appVersion?: string;
	readonly exportDate?: string;
	readonly counts?: Readonly<Record<string, number>>;
}

export type GameTrackCsvParseErrorCode = 'missing-required-file' | 'missing-required-column' | 'duplicate-game-track-id' | 'invalid-csv' | 'missing-manifest' | 'invalid-manifest' | 'missing-stable-identity';

export interface GameTrackCsvParseError {
	readonly code: GameTrackCsvParseErrorCode;
	readonly message: string;
}

export type GameTrackCsvParseResult =
	| { readonly ok: true; readonly value: GameTrackCsvExport }
	| { readonly ok: false; readonly error: GameTrackCsvParseError };

export interface GameTrackCsvParseOptions {
	readonly requireManifest?: boolean;
	readonly requireStableIdentity?: boolean;
}

export interface NormalizedGameTrackCsvResult {
	readonly games: readonly CanonicalGame[];
	readonly diagnostics: readonly ProviderDiagnostic[];
}

export function parseGameTrackCsvExport(bundle: GameTrackCsvBundle, options: GameTrackCsvParseOptions = {}): GameTrackCsvParseResult {
	const manifestText = findFile(bundle, 'manifest.json');
	if (options.requireManifest && manifestText === undefined) return { ok: false, error: { code: 'missing-manifest', message: 'GameTrack export does not contain manifest.json.' } };
	let manifest: GameTrackExportManifest | undefined;
	if (manifestText !== undefined) {
		try { manifest = parseManifest(manifestText); }
		catch (error) { return { ok: false, error: { code: 'invalid-manifest', message: error instanceof Error ? error.message : String(error) } }; }
	}
	const gamesText = findFile(bundle, GAME_TRACK_CSV_REQUIRED_FILE);
	if (gamesText === undefined) return { ok: false, error: { code: 'missing-required-file', message: 'GameTrack export does not contain games.csv.' } };
	let gamesTable: CsvTable;
	try {
		gamesTable = parseCsv(gamesText);
	} catch (error) {
		return { ok: false, error: { code: 'invalid-csv', message: error instanceof Error ? error.message : String(error) } };
	}
	const missing = GAME_TRACK_CSV_REQUIRED_HEADERS.filter((header) => !gamesTable.headers.includes(header));
	if (missing.length > 0) return { ok: false, error: { code: 'missing-required-column', message: `games.csv is missing required columns: ${missing.join(', ')}.` } };
	const games = tableRecords(gamesTable);
	const ids = games.map((row) => normalizeId(row.uuid));
	if (options.requireStableIdentity && games.some((row, index) => ids[index] === '' || parsePositiveInteger(row.igdb_id) === undefined)) {
		return { ok: false, error: { code: 'missing-stable-identity', message: 'games.csv contains a row without a valid UUID and IGDB ID.' } };
	}
	const duplicate = ids.find((id, index) => ids.indexOf(id) !== index && id.length > 0);
	if (duplicate !== undefined) return { ok: false, error: { code: 'duplicate-game-track-id', message: `games.csv contains duplicate GameTrack ID ${duplicate}.` } };
	return {
		ok: true,
		value: {
			games,
			steamGames: optionalRecords(bundle, 'steam_games.csv'),
			playStationGames: optionalRecords(bundle, 'playstation_games.csv'),
			xboxGames: optionalRecords(bundle, 'xbox_games.csv'),
			steamAchievements: optionalRecords(bundle, 'steam_achievements.csv'),
			gameTrophies: optionalRecords(bundle, 'game_trophies.csv'),
			xboxAchievements: optionalRecords(bundle, 'xbox_achievements.csv'),
			schemaSignature: csvSignature(gamesTable.headers),
			parseDiagnostics: optionalParseDiagnostics(bundle),
			...(manifest === undefined ? {} : { manifest }),
		},
	};
}

function parseManifest(text: string): GameTrackExportManifest {
	const value: unknown = JSON.parse(text);
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('manifest.json must contain an object.');
	const record = value as Record<string, unknown>;
	const counts = record.counts;
	if (counts !== undefined && (typeof counts !== 'object' || counts === null || Array.isArray(counts) || !Object.values(counts as Record<string, unknown>).every((count) => typeof count === 'number' && Number.isInteger(count) && count >= 0))) throw new Error('manifest.json contains invalid counts.');
	return {
		...(typeof record.version === 'string' ? { version: record.version } : {}),
		...(typeof record.appVersion === 'string' ? { appVersion: record.appVersion } : {}),
		...(typeof record.exportDate === 'string' ? { exportDate: record.exportDate } : {}),
		...(counts === undefined ? {} : { counts: counts as Readonly<Record<string, number>> }),
	};
}

export function createGameTrackCsvNormalizer(): { normalize(exportData: GameTrackCsvExport): NormalizedGameTrackCsvResult } {
	return { normalize: (exportData) => normalizeExport(exportData) };
}

function normalizeExport(exportData: GameTrackCsvExport): NormalizedGameTrackCsvResult {
	const diagnostics: ProviderDiagnostic[] = [];
	const steamByUuid = groupBy(exportData.steamGames, 'game_uuid');
	const playStationByUuid = groupBy(exportData.playStationGames, 'game_uuid');
	const xboxByUuid = groupBy(exportData.xboxGames, 'game_uuid');
	const steamAchievementsByApp = groupBy(exportData.steamAchievements, 'steam_game_appid');
	const games: CanonicalGame[] = [];

	for (const row of exportData.games) {
		const id = normalizeId(row.uuid);
		if (id.length === 0 || row.title.trim().length === 0) {
			diagnostics.push({ code: 'INVALID_GAME_ROW', message: 'GameTrack CSV row has no UUID or title.', gameId: id || undefined });
			continue;
		}
		const igdbId = parsePositiveInteger(row.igdb_id);
		if (igdbId === undefined) diagnostics.push({ code: 'MISSING_IGDB_ID', message: 'GameTrack CSV game has no valid IGDB ID.', gameId: id, field: 'igdb_id' });
		const steamRows = steamByUuid.get(id) ?? [];
		const psRows = playStationByUuid.get(id) ?? [];
		const xboxRows = xboxByUuid.get(id) ?? [];
		const steamId = firstNonEmpty(steamRows.map((steam) => steam.appid));
		const playstationId = firstNonEmpty(psRows.flatMap((ps) => [ps.np_communication_id, ps.title_id, ps.store_id]));
		const xboxId = firstNonEmpty(xboxRows.flatMap((xbox) => [xbox.title_id, xbox.modern_title_id]));
		const raw: GameTrackRawGame = {
			gameTrackId: id,
			...(igdbId === undefined ? {} : { igdbId }),
			...(steamId === undefined ? {} : { steamId }),
			...(playstationId === undefined ? {} : { playstationId }),
			...(xboxId === undefined ? {} : { xboxId }),
			title: row.title,
			summary: optional(row.summary),
			developer: optional(row.developer),
			publisher: optional(row.publisher),
			releaseDate: optional(row.release_date),
			cover: optional(row.poster_url),
			platforms: splitList(row.platforms).concat(splitList(row.additional_platforms)),
			ownedPlatform: optional(row.owned_platform),
			playtimeHours: parseNumber(row.hours_played),
			platformPlaytime: [
				...steamRows.flatMap((steam) => numericObservation(steam.playtime_forever, { source: 'steam', platform: 'Steam', id: optional(steam.appid) })),
				...psRows.flatMap((ps) => numericObservation(ps.play_duration, { source: 'playstation', platform: optional(ps.trophy_title_platform) ?? 'PlayStation', unit: 'hours', id: optional(ps.store_id) })),
			],
			lastPlayed: [
				...psRows.flatMap((ps) => dateObservation(ps.last_played, 'playstation')),
				...xboxRows.flatMap((xbox) => dateObservation(xbox.last_time_played, 'xbox')),
			],
			achievements: [
				...steamRows.flatMap((steam) => steamAchievementSummary(steam.appid, steamAchievementsByApp)),
				...psRows.flatMap(playStationAchievementSummary),
				...xboxRows.flatMap(xboxAchievementSummary),
			],
			genres: splitList(row.genres),
		};
		try {
			const normalized = normalizeGameTrackGame(raw, exportData.schemaSignature);
			games.push(normalized.game);
			for (const warning of normalized.diagnostics.warnings) diagnostics.push({ code: warning.code, message: warning.message, gameId: id, field: warning.field });
		} catch (error) {
			diagnostics.push({ code: 'GAME_NORMALIZATION_FAILED', message: error instanceof Error ? error.message : String(error), gameId: id });
		}
	}
	return { games, diagnostics };
}

function steamAchievementSummary(appId: string | undefined, byApp: ReadonlyMap<string, readonly Readonly<Record<string, string>>[]>): GameTrackAchievementData[] {
	if (appId === undefined) return [];
	const achievements = byApp.get(appId) ?? [];
	if (achievements.length === 0) return [];
	return [{ source: 'steam', platform: 'Steam', unlocked: achievements.filter((row) => row.achieved === '1' || row.achieved.toLocaleLowerCase('en-US') === 'true').length, total: achievements.length, complete: true }];
}

function playStationAchievementSummary(row: Readonly<Record<string, string>>): GameTrackAchievementData[] {
	const keys = ['defined_bronze', 'defined_silver', 'defined_gold', 'defined_platinum', 'earned_bronze', 'earned_silver', 'earned_gold', 'earned_platinum'];
	if (!keys.some((key) => row[key]?.trim().length > 0)) return [];
	const total = sumNumbers(row, ['defined_bronze', 'defined_silver', 'defined_gold', 'defined_platinum']);
	const unlocked = sumNumbers(row, ['earned_bronze', 'earned_silver', 'earned_gold', 'earned_platinum']);
	return [{ source: 'playstation', platform: optional(row.trophy_title_platform) ?? 'PlayStation', unlocked, total, complete: false }];
}

function xboxAchievementSummary(row: Readonly<Record<string, string>>): GameTrackAchievementData[] {
	const total = optionalNumber(parseNumber(row.total_achievements));
	const unlocked = optionalNumber(parseNumber(row.current_achievements));
	if (total === undefined && unlocked === undefined) return [];
	return [{ source: 'xbox', platform: 'Xbox', ...(unlocked === undefined ? {} : { unlocked }), ...(total === undefined ? {} : { total }), complete: total !== undefined && unlocked !== undefined }];
}

function numericObservation(value: string | undefined, base: { readonly source: 'steam' | 'playstation'; readonly platform: string; readonly id?: string; readonly unit?: 'minutes' | 'hours' }): GameTrackPlatformPlaytime[] {
	return [{ source: base.source, platform: base.platform, value: parseNumber(value) ?? null, unit: base.unit ?? 'minutes', ...(base.id === undefined ? {} : { id: base.id }) }];
}

function dateObservation(value: string | undefined, source: 'playstation' | 'xbox'): GameTrackRawGame['lastPlayed'] {
	return optional(value) === undefined ? [] : [{ source, value: value ?? null }];
}

function sumNumbers(row: Readonly<Record<string, string>>, keys: readonly string[]): number | undefined {
	const values = keys.map((key) => parseNumber(row[key])).filter((value): value is number => value !== null);
	return values.length === keys.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function optionalNumber(value: number | null): number | undefined {
	return value === null ? undefined : value;
}

function optional(value: string | undefined): string | undefined {
	return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

function parseNumber(value: string | undefined): number | null {
	if (value === undefined || value.trim().length === 0) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function splitList(value: string | undefined): string[] {
	return (value ?? '').split('|').map((item) => item.trim()).filter(Boolean);
}

function firstNonEmpty(values: readonly (string | undefined)[]): string | undefined {
	return values.find((value) => value !== undefined && value.trim().length > 0)?.trim();
}

function normalizeId(value: string | undefined): string {
	return (value ?? '').trim().replaceAll('-', '').toLocaleLowerCase('en-US');
}

function groupBy(rows: readonly Readonly<Record<string, string>>[], key: string): ReadonlyMap<string, readonly Readonly<Record<string, string>>[]> {
	const groups = new Map<string, Readonly<Record<string, string>>[]>();
	for (const row of rows) {
		const value = normalizeId(row[key]);
		if (value.length === 0) continue;
		const group = groups.get(value) ?? [];
		group.push(row);
		groups.set(value, group);
	}
	return groups;
}

function optionalRecords(bundle: GameTrackCsvBundle, filename: string): readonly Readonly<Record<string, string>>[] {
	const text = findFile(bundle, filename);
	if (text === undefined) return [];
	try { return tableRecords(parseCsv(text)); } catch { return []; }
}

function optionalParseDiagnostics(bundle: GameTrackCsvBundle): readonly ProviderDiagnostic[] {
	const diagnostics: ProviderDiagnostic[] = [];
	for (const filename of ['steam_games.csv', 'playstation_games.csv', 'xbox_games.csv', 'steam_achievements.csv', 'game_trophies.csv', 'xbox_achievements.csv']) {
		const text = findFile(bundle, filename);
		if (text === undefined) continue;
		try { parseCsv(text); } catch (error) {
			diagnostics.push({ code: 'OPTIONAL_FILE_PARSE_FAILED', message: `${filename}: ${error instanceof Error ? error.message : String(error)}`, field: filename });
		}
	}
	return diagnostics;
}

function findFile(bundle: GameTrackCsvBundle, filename: string): string | undefined {
	return Object.entries(bundle).find(([name]) => name === filename || name.endsWith(`/${filename}`))?.[1];
}

function csvSignature(headers: readonly string[]): string {
	let hash = 2166136261;
	for (const character of [...headers].sort().join('|')) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return `gametrack-csv:v1:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
