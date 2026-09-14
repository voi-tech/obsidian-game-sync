import type { GameTrackCsvBundle } from './gametrack-csv-normalizer';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ENTRIES = 256;
const MAX_ENTRY_SIZE = 64 * 1024 * 1024;

export class GameTrackZipError extends Error {
	constructor(readonly code: 'EXPORT_INVALID_ZIP' | 'EXPORT_MANIFEST_MISSING' | 'EXPORT_ENTRY_UNSUPPORTED') {
		super(code);
		this.name = 'GameTrackZipError';
	}
}

export async function parseGameTrackZip(data: Uint8Array): Promise<GameTrackCsvBundle> {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const endOffset = findEndOfCentralDirectory(view);
	if (endOffset < 0) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
	const entries = view.getUint16(endOffset + 10, true);
	const centralSize = view.getUint32(endOffset + 12, true);
	const centralOffset = view.getUint32(endOffset + 16, true);
	if (entries === 0 || entries > MAX_ENTRIES || centralOffset + centralSize > data.byteLength) throw new GameTrackZipError('EXPORT_INVALID_ZIP');

	const bundle: Record<string, string> = {};
	let cursor = centralOffset;
	for (let index = 0; index < entries; index += 1) {
		if (cursor + 46 > data.byteLength || view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		const flags = view.getUint16(cursor + 8, true);
		const method = view.getUint16(cursor + 10, true);
		const crc = view.getUint32(cursor + 16, true);
		const compressedSize = view.getUint32(cursor + 20, true);
		const uncompressedSize = view.getUint32(cursor + 24, true);
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		const localOffset = view.getUint32(cursor + 42, true);
		const name = decodeName(data.subarray(cursor + 46, cursor + 46 + nameLength), flags);
		cursor += 46 + nameLength + extraLength + commentLength;
		if (name.endsWith('/')) continue;
		if (!isSafeEntryName(name) || uncompressedSize > MAX_ENTRY_SIZE || compressedSize > data.byteLength) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		if ((flags & 0x1) !== 0 || (method !== 0 && method !== 8)) throw new GameTrackZipError('EXPORT_ENTRY_UNSUPPORTED');
		const bytes = await readEntry(data, view, localOffset, compressedSize, method);
		if (bytes.byteLength !== uncompressedSize || crc32(bytes) !== crc) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		if (bundle[name] !== undefined) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
		bundle[name] = new TextDecoder().decode(bytes);
	}
	if (findBundleFile(bundle, 'manifest.json') === undefined) throw new GameTrackZipError('EXPORT_MANIFEST_MISSING');
	return bundle;
}

function findEndOfCentralDirectory(view: DataView): number {
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

async function readEntry(data: Uint8Array, view: DataView, localOffset: number, compressedSize: number, method: number): Promise<Uint8Array> {
	if (localOffset + 30 > data.byteLength || view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
	const nameLength = view.getUint16(localOffset + 26, true);
	const extraLength = view.getUint16(localOffset + 28, true);
	const start = localOffset + 30 + nameLength + extraLength;
	if (start + compressedSize > data.byteLength) throw new GameTrackZipError('EXPORT_INVALID_ZIP');
	const compressed = data.subarray(start, start + compressedSize);
	if (method === 0) return compressed.slice();
	const stream = new Blob([compressed.slice().buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
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
