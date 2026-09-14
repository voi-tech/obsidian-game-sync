import { describe, expect, it, vi } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { parseGameTrackZip } from '../src/providers/gametrack/csv/gametrack-zip';
import { createGameTrackCsvFileSource } from '../src/providers/gametrack/csv/gametrack-csv-file-source';
import { GameTrackCsvProvider, type GameTrackCsvSource } from '../src/providers/gametrack/csv/gametrack-csv-provider';
import { CanonicalSyncService } from '../src/sync/canonical-service';
import type { CanonicalGame } from '../src/model/canonical-game';
import { GameTrackCsvRuntime } from '../src/providers/gametrack/csv/gametrack-csv-runtime';
import { planCanonicalSync } from '../src/sync/canonical-planner';
import { FakeVaultGateway } from './fake-gateway';

function storedZip(files: Record<string, string>): Uint8Array {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(files)) {
		const nameBytes = encoder.encode(name);
		const data = encoder.encode(content);
		const local = new Uint8Array(30 + nameBytes.length + data.length);
		const view = new DataView(local.buffer);
		view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
		view.setUint16(8, 0, true); view.setUint32(14, crc32(data), true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, nameBytes.length, true);
		local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length); chunks.push(local);
		const entry = new Uint8Array(46 + nameBytes.length); const entryView = new DataView(entry.buffer);
		entryView.setUint32(0, 0x02014b50, true); entryView.setUint16(4, 20, true); entryView.setUint16(6, 20, true); entryView.setUint16(8, 0x800, true);
		entryView.setUint16(10, 0, true); entryView.setUint32(16, crc32(data), true); entryView.setUint32(20, data.length, true); entryView.setUint32(24, data.length, true); entryView.setUint16(28, nameBytes.length, true); entryView.setUint32(42, offset, true);
		entry.set(nameBytes, 46); central.push(entry); offset += local.length;
	}
	const centralBytes = concat(central); const end = new Uint8Array(22); const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, central.length, true); endView.setUint16(10, central.length, true); endView.setUint32(12, centralBytes.length, true); endView.setUint32(16, offset, true);
	return concat([...chunks, centralBytes, end]);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
	return result;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb88320;
	return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) value = (value >>> 8) ^ (CRC_TABLE[(value ^ byte) & 0xff] ?? 0);
	return (value ^ 0xffffffff) >>> 0;
}

const games = 'uuid,igdb_id,title,platforms,hours_played\nabc,123,Example,Steam,2.5\n';
const manifest = JSON.stringify({ version: '1.0', appVersion: '6.1.5', exportDate: '2026-09-14T12:38:51Z', counts: { games: 1 } });

describe('GameTrack ZIP transport', () => {
	it('reads manifest and CSV entries in memory without extraction', async () => {
		const bundle = await parseGameTrackZip(storedZip({ 'manifest.json': manifest, 'games.csv': games }));
		expect(bundle['manifest.json']).toBe(manifest);
		expect(bundle['games.csv']).toBe(games);
	});

	it('rejects an archive without manifest', async () => {
		await expect(parseGameTrackZip(storedZip({ 'games.csv': games }))).rejects.toMatchObject({ code: 'EXPORT_MANIFEST_MISSING' });
	});

	it('marks a source that changes during read as unsafe', async () => {
		let revision = 1;
		const source: GameTrackCsvSource = {
			readBundle: async () => ({ 'manifest.json': manifest, 'games.csv': games }),
			getFingerprint: async () => ({ name: 'export.zip', size: revision, modifiedAt: revision }),
		};
		const provider = new GameTrackCsvProvider({ source, host: 'macos', requireManifest: true, beforeRead: async () => { revision = 2; } });
		const snapshot = await provider.getSnapshot();
		expect(snapshot.status).toBe('failed');
		expect(snapshot.diagnostics.diagnostics[0]?.code).toBe('EXPORT_CHANGED_DURING_READ');
	});

	it('fails safely when required identity is missing', async () => {
		const source: GameTrackCsvSource = { readBundle: async () => ({ 'manifest.json': manifest, 'games.csv': 'uuid,igdb_id,title,platforms,hours_played\nabc,,Example,Steam,2.5\n' }) };
		const provider = new GameTrackCsvProvider({ source, host: 'macos', requireManifest: true, requireStableIdentity: true });
		const snapshot = await provider.getSnapshot();
		expect(snapshot.status).toBe('failed');
		expect(snapshot.games).toHaveLength(0);
	});

	it('does not expose source content in a sanitized source error', async () => {
		const source: GameTrackCsvSource = { readBundle: vi.fn(async () => { throw new Error('/Users/private/GameTrack_Export.zip'); }) };
		const provider = new GameTrackCsvProvider({ source, host: 'macos', requireManifest: true });
		const snapshot = await provider.getSnapshot();
		expect(snapshot.status).toBe('failed');
		expect(snapshot.diagnostics.diagnostics[0]?.code).toBe('EXPORT_SOURCE_READ_FAILED');
	});

	it('invalidates a preview when the provider revision changes before apply', async () => {
		const game = { identity: { canonicalKey: 'gametrack:abc', externalIds: { gametrack: 'abc', igdb: 123 } }, title: 'Example', metadata: { developers: [], publishers: [], genres: [] }, platforms: [], playtime: { observations: [] }, provenance: { provider: 'gametrack', sourceId: 'abc', schemaSignature: 'v1' } } satisfies CanonicalGame;
		let revision = 'one';
		const provider = { id: 'gametrack', getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }), isAvailable: async () => true, getLibrary: async () => [game], getDiagnostics: () => ({ provider: 'gametrack', database: 'found' as const, schema: 'supported' as const, gamesRead: 1, gamesNormalized: 1, diagnostics: [] }), getSnapshot: async () => ({ status: 'complete' as const, games: [game], revision, diagnostics: provider.getDiagnostics() }) };
		const writer = { apply: vi.fn(async () => []) };
		const service = new CanonicalSyncService({ provider, planner: { gateway: { listMarkdownFiles: async () => [], read: async () => '', create: async () => undefined, process: async () => undefined, processFrontMatter: async () => undefined, exists: async () => false } as never }, writer: writer as never });
		const preview = await service.preview(); revision = 'two';
		await expect(service.applyPreview(preview)).rejects.toThrow('preview is no longer valid');
		expect(writer.apply).not.toHaveBeenCalled();
	});

	it('parses the real GameTrack ZIP when explicitly supplied for integration testing', async () => {
		const path = process.env.GAMETRACK_ZIP_PATH;
		if (path === undefined) return;
		const bytes = await readFile(path);
		const fileStat = await stat(path);
		const file = { name: path.split('/').at(-1) ?? 'GameTrack_Export.zip', size: bytes.byteLength, lastModified: fileStat.mtimeMs, arrayBuffer: async () => new Uint8Array(bytes).buffer };
		const provider = new GameTrackCsvProvider({ source: createGameTrackCsvFileSource(file), host: 'macos', requireManifest: true, requireStableIdentity: true });
		const snapshot = await provider.getSnapshot();
		expect(snapshot.status).toBe('complete');
		expect(snapshot.games).toHaveLength(207);
	});

	it('allocates collision-safe paths for every game in the real export', async () => {
		const path = process.env.GAMETRACK_ZIP_PATH;
		if (path === undefined) return;
		const bytes = await readFile(path);
		const fileStat = await stat(path);
		const file = { name: path.split('/').at(-1) ?? 'GameTrack_Export.zip', size: bytes.byteLength, lastModified: fileStat.mtimeMs, arrayBuffer: async () => new Uint8Array(bytes).buffer };
		const provider = new GameTrackCsvProvider({ source: createGameTrackCsvFileSource(file), host: 'macos', requireManifest: true, requireStableIdentity: true });
		const snapshot = await provider.getSnapshot();
		const plan = await planCanonicalSync(snapshot.games, { gateway: new FakeVaultGateway(), notesFolder: 'Games' });
		const deadSpaceKeys = new Set(snapshot.games.filter((game) => game.title === 'Dead Space').map((game) => game.identity.canonicalKey));
		const deadSpace = plan.statuses.filter((status) => deadSpaceKeys.has(status.canonicalKey));

		expect(snapshot.status).toBe('complete');
		expect(snapshot.games).toHaveLength(207);
		expect(plan.statuses.filter((status) => status.status === 'conflict')).toHaveLength(0);
		expect(plan.operations).toHaveLength(207);
		expect(deadSpace.map((status) => status.path)).toEqual(['Games/Dead Space (2008).md', 'Games/Dead Space (2023).md']);
	});

	it('reports manual export readiness separately from source selection', async () => {
		let source: GameTrackCsvSource | undefined;
		const runtime = new GameTrackCsvRuntime({ host: 'macos', configured: () => source !== undefined, source: async () => source });
		expect((await runtime.getStatus()).code).toBe('EXPORT_NOT_SELECTED');
		source = { readBundle: async () => ({ 'manifest.json': manifest, 'games.csv': games }) };
		expect((await runtime.getStatus()).code).toBe('READY');
		expect((await runtime.getProvider())?.getCapabilities().automaticSync).toBe(false);
	});
});
