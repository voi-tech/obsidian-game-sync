import type { GameProvider } from '../model/provider';

export interface CacheEnvelope<T> {
	schemaVersion: 1;
	provider: GameProvider;
	createdAt: string;
	data: T;
}

export type CachePayloadValidator<T> = (value: unknown) => value is T;

export type CacheTtlKind = 'metadata' | 'achievements' | 'ownership' | 'playtime';

export const CACHE_TTL_MS: Readonly<Record<CacheTtlKind, number>> = Object.freeze({
	metadata: 30 * 24 * 60 * 60 * 1000,
	achievements: 7 * 24 * 60 * 60 * 1000,
	ownership: 60 * 60 * 1000,
	playtime: 60 * 60 * 1000,
});

export const CACHE_TTLS = CACHE_TTL_MS;

function isProvider(value: unknown): value is GameProvider {
	return value === 'steam' || value === 'playstation';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneUnknown(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item: unknown) => cloneUnknown(item));
	if (isRecord(value)) {
		const result: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value)) result[key] = cloneUnknown(nested);
		return result;
	}
	return value;
}

function cloneValue<T>(value: T): T {
	return cloneUnknown(value) as T;
}

function parseTimestamp(value: string): number | undefined {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function createCacheEnvelope<T>(provider: GameProvider, data: T, createdAt = new Date().toISOString()): CacheEnvelope<T> {
	if (parseTimestamp(createdAt) === undefined) throw new Error('Cache envelope createdAt must be an ISO timestamp.');
	return {
		schemaVersion: 1,
		provider,
		createdAt,
		data: cloneValue(data),
	};
}

export function parseCacheEnvelope<T>(value: unknown, provider?: GameProvider, validate?: CachePayloadValidator<T>): CacheEnvelope<T> | undefined {
	if (!isRecord(value) || value.schemaVersion !== 1 || !isProvider(value.provider) || (provider !== undefined && value.provider !== provider)) return undefined;
	if (typeof value.createdAt !== 'string' || parseTimestamp(value.createdAt) === undefined || !Object.prototype.hasOwnProperty.call(value, 'data')) return undefined;
	if (validate !== undefined && !validate(value.data)) return undefined;
	return {
		schemaVersion: 1,
		provider: value.provider,
		createdAt: value.createdAt,
		data: cloneValue(value.data as T),
	};
}

export const readCacheEnvelope = parseCacheEnvelope;

export function isCacheFresh(
	envelope: CacheEnvelope<unknown>,
	now = Date.now(),
	ttlMs = CACHE_TTL_MS.metadata,
): boolean {
	const createdAt = parseTimestamp(envelope.createdAt);
	return createdAt !== undefined && Number.isFinite(now) && now >= createdAt && now - createdAt < ttlMs;
}

function ttlFor(value: CacheTtlKind | number): number {
	return typeof value === 'number' ? value : CACHE_TTL_MS[value];
}

export interface CacheClockOptions {
	now?: () => number;
}

export interface DisposableCache {
	get<T>(key: string, provider: GameProvider, ttl: CacheTtlKind | number, now?: number, validate?: CachePayloadValidator<T>): Promise<T | undefined>;
	set<T>(key: string, provider: GameProvider, data: T, createdAt?: string): Promise<void>;
	delete(key: string, provider?: GameProvider): Promise<void>;
	clear(): Promise<void>;
	getRaw<T>(key: string, provider: GameProvider): Promise<CacheEnvelope<T> | undefined>;
	setRaw(key: string, envelope: unknown): void;
}

export class InMemoryDisposableCache implements DisposableCache {
	private readonly entries = new Map<string, unknown>();
	private readonly now: () => number;

	constructor(options: CacheClockOptions = {}) {
		this.now = options.now ?? (() => Date.now());
	}

	private storageKey(key: string, provider: GameProvider): string {
		return `${provider}:${key}`;
	}

	async getRaw<T>(key: string, provider: GameProvider): Promise<CacheEnvelope<T> | undefined> {
		const parsed = parseCacheEnvelope<T>(this.entries.get(this.storageKey(key, provider)) ?? this.entries.get(key), provider);
		return parsed === undefined ? undefined : cloneValue(parsed);
	}

	async get<T>(key: string, provider: GameProvider, ttl: CacheTtlKind | number, now = this.now(), validate?: CachePayloadValidator<T>): Promise<T | undefined> {
		const envelope = parseCacheEnvelope<T>(this.entries.get(this.storageKey(key, provider)) ?? this.entries.get(key), provider, validate);
		if (envelope === undefined || !isCacheFresh(envelope, now, ttlFor(ttl))) {
			this.entries.delete(this.storageKey(key, provider));
			return undefined;
		}
		return cloneValue(envelope.data);
	}

	async set<T>(key: string, provider: GameProvider, data: T, createdAt?: string): Promise<void> {
		this.entries.set(this.storageKey(key, provider), createCacheEnvelope(provider, data, createdAt));
	}

	setRaw(key: string, envelope: unknown): void {
		this.entries.set(key, cloneValue(envelope));
	}

	async delete(key: string, provider?: GameProvider): Promise<void> {
		if (provider !== undefined) {
			this.entries.delete(this.storageKey(key, provider));
			return;
		}
		for (const storedKey of this.entries.keys()) if (storedKey.endsWith(`:${key}`)) this.entries.delete(storedKey);
	}

	async clear(): Promise<void> {
		this.entries.clear();
	}
}

export function createCacheStore(options: CacheClockOptions = {}): InMemoryDisposableCache {
	return new InMemoryDisposableCache(options);
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
	return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(',')}}`;
}

function webCrypto(): Crypto {
	const cryptoApi = typeof window !== 'undefined' ? window.crypto : typeof crypto !== 'undefined' ? crypto : undefined;
	if (cryptoApi?.subtle === undefined) throw new Error('Web Crypto SHA-256 is unavailable.');
	return cryptoApi;
}

export async function sha256Fingerprint(value: unknown): Promise<string> {
	const text = typeof value === 'string' ? value : stableStringify(value);
	const bytes = new TextEncoder().encode(text);
	const digest = await webCrypto().subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const fingerprint = sha256Fingerprint;
