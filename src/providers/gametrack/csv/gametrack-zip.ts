import type { GameTrackCsvBundle } from './gametrack-csv-normalizer';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ENTRIES = 256;
const MAX_ENTRY_SIZE = 64 * 1024 * 1024;
const MAX_TOTAL_SIZE = 64 * 1024 * 1024;
export const GAME_TRACK_ZIP_MAX_INPUT_SIZE = 16 * 1024 * 1024;

interface ZipEntry {
	readonly name: string;
	readonly flags: number;
	readonly method: number;
	readonly crc: number;
	readonly compressedSize: number;
	readonly uncompressedSize: number;
	readonly localOffset: number;
	readonly directory: boolean;
}

export class GameTrackZipError extends Error {
	constructor(readonly code: 'EXPORT_INVALID_ZIP' | 'EXPORT_MANIFEST_MISSING' | 'EXPORT_ENTRY_UNSUPPORTED') {
		super(code);
		this.name = 'GameTrackZipError';
	}
}

export async function parseGameTrackZip(data: Uint8Array): Promise<GameTrackCsvBundle> {
	if (data.byteLength > GAME_TRACK_ZIP_MAX_INPUT_SIZE) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const endOffset = findEndOfCentralDirectory(view);
	if (endOffset < 0) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
	const entries = view.getUint16(endOffset + 10, true);
	const centralSize = view.getUint32(endOffset + 12, true);
	const centralOffset = view.getUint32(endOffset + 16, true);
	if (entries === 0 || entries > MAX_ENTRIES || centralOffset > data.byteLength || centralSize > data.byteLength - centralOffset) throw new GameTrackZipError('EXPORT_INVALID_ZIP');

	const centralEnd = centralOffset + centralSize;
	const metadata: ZipEntry[] = [];
	const names = new Set<string>();
	let declaredTotalSize = 0;
	let cursor = centralOffset;
	for (let index = 0; index < entries; index += 1) {
		if (centralEnd - cursor < 46 || view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		const flags = view.getUint16(cursor + 8, true);
		const method = view.getUint16(cursor + 10, true);
		const crc = view.getUint32(cursor + 16, true);
		const compressedSize = view.getUint32(cursor + 20, true);
		const uncompressedSize = view.getUint32(cursor + 24, true);
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		const localOffset = view.getUint32(cursor + 42, true);
		const recordLength = 46 + nameLength + extraLength + commentLength;
		if (recordLength > centralEnd - cursor) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		const name = decodeName(data.subarray(cursor + 46, cursor + 46 + nameLength), flags);
		cursor += recordLength;
		if (!isSafeEntryName(name) || uncompressedSize > MAX_ENTRY_SIZE || compressedSize > data.byteLength || names.has(name)) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		if ((flags & 0x1) !== 0 || (method !== 0 && method !== 8)) throw new GameTrackZipError('EXPORT_ENTRY_UNSUPPORTED');
		declaredTotalSize += uncompressedSize;
		if (declaredTotalSize > MAX_TOTAL_SIZE) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		names.add(name);
		metadata.push({ name, flags, method, crc, compressedSize, uncompressedSize, localOffset, directory: name.endsWith('/') });
	}
	if (cursor !== centralEnd) throw new GameTrackZipError('EXPORT_INVALID_ZIP');

	const bundle: Record<string, string> = {};
	let expandedSize = 0;
	for (const entry of metadata) {
		if (entry.directory) continue;
		const bytes = await readEntry(data, view, entry.localOffset, entry.compressedSize, entry.method, Math.min(entry.uncompressedSize, MAX_ENTRY_SIZE, MAX_TOTAL_SIZE - expandedSize));
		if (bytes.byteLength !== entry.uncompressedSize || crc32(bytes) !== entry.crc) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		expandedSize += bytes.byteLength;
		bundle[entry.name] = new TextDecoder().decode(bytes);
	}
	if (findBundleFile(bundle, 'manifest.json') === undefined) throw new GameTrackZipError('EXPORT_MANIFEST_MISSING');
	return bundle;
}

function findEndOfCentralDirectory(view: DataView): number {
	if (view.byteLength < 22) return -1;
	const start = Math.max(0, view.byteLength - 22 - 0xffff);
	for (let offset = view.byteLength - 22; offset >= start; offset -= 1) if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
	return -1;
}

function decodeName(bytes: Uint8Array, flags: number): string {
	return new TextDecoder((flags & 0x800) !== 0 ? 'utf-8' : 'utf-8', { fatal: false }).decode(bytes);
}

function isSafeEntryName(name: string): boolean {
	return !name.startsWith('/') && !name.split('/').some((part) => part === '..');
}

async function readEntry(data: Uint8Array, view: DataView, localOffset: number, compressedSize: number, method: number, maxOutputSize: number): Promise<Uint8Array> {
	if (localOffset > data.byteLength - 30 || view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
	const nameLength = view.getUint16(localOffset + 26, true);
	const extraLength = view.getUint16(localOffset + 28, true);
	const start = localOffset + 30 + nameLength + extraLength;
	if (start > data.byteLength || compressedSize > data.byteLength - start) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
	const compressed = data.subarray(start, start + compressedSize);
	if (method === 0) {
		if (compressed.byteLength > maxOutputSize) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		return compressed.slice();
	}
	const stream = new Blob([new Uint8Array(compressed).buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			const chunk = result.value;
			if (chunk.byteLength > maxOutputSize - total) {
				await cancelReader(reader);
				throw new GameTrackZipError('EXPORT_INVALID_ZIP');
			}
			chunks.push(chunk);
			total += chunk.byteLength;
		}
	} catch (error) {
		await cancelReader(reader);
		throw error;
	} finally {
		reader.releaseLock();
	}
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
	try { await reader.cancel(); } catch { /* The original ZIP error is more useful than a cancellation failure. */ }
}

function findBundleFile(bundle: GameTrackCsvBundle, filename: string): string | undefined {
	return Object.entries(bundle).find(([name]) => name === filename || name.endsWith(`/${filename}`))?.[1];
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
