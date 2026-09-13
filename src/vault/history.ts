import type { GameProvider } from '../model/provider';
import { sanitizeError } from '../auth/sanitize';

export type GameEventType =
	| 'playtime-changed'
	| 'achievement-unlocked'
	| 'trophy-unlocked'
	| 'ownership-changed'
	| 'game-first-seen';

export interface GameEvent {
	schema: 1;
	observedAt: string;
	occurredAt?: string;
	provider: GameProvider;
	canonicalGameId: string;
	providerGameId: string;
	type: GameEventType;
	data: Record<string, unknown>;
}

export interface HistoryGateway {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	create(path: string, content: string): Promise<void>;
	process(path: string, updater: (content: string) => string): Promise<void>;
}

export interface EventHistoryOptions {
	gateway: HistoryGateway;
	path: string;
	enabled: boolean;
	secretValues?: readonly string[];
}

export interface AppendEventOptions {
	enabled?: boolean;
	noteApplied?: boolean;
	secretValues?: readonly string[];
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

function sanitizeValue(value: unknown, secretValues: readonly string[], key?: string): unknown {
	if (key !== undefined && /secret|token|password|npsso|api[-_]?key|authorization|credential|private|cookie|session|bearer/i.test(key)) return '[REDACTED]';
	if (typeof value === 'string') {
		return sanitizeError(value, secretValues);
	}
	if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, secretValues));
	if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, sanitizeValue(nested, secretValues, nestedKey)]));
	return value;
}

function sanitizeEvent(event: GameEvent, secretValues: readonly string[]): GameEvent {
	const sanitized = sanitizeValue(event, secretValues);
	if (!isRecord(sanitized) || !isRecord(sanitized.data)) throw new Error('Unable to sanitize game event.');
	return sanitized as unknown as GameEvent;
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
		.join(',')}}`;
}

export function createGameEvent(input: Omit<GameEvent, 'schema'>): GameEvent {
	if (input.observedAt.trim().length === 0 || input.canonicalGameId.trim().length === 0 || input.providerGameId.trim().length === 0) {
		throw new Error('Game events require observedAt, canonicalGameId and providerGameId.');
	}
	return {
		schema: 1,
		observedAt: input.observedAt,
		...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
		provider: input.provider,
		canonicalGameId: input.canonicalGameId,
		providerGameId: input.providerGameId,
		type: input.type,
		data: cloneValue(input.data),
	};
}

export function buildPlaytimeEvent(
	previousMinutes: number | undefined,
	playtimeMinutes: number | undefined,
	context: Pick<GameEvent, 'provider' | 'canonicalGameId' | 'providerGameId' | 'observedAt'> & { occurredAt?: string },
): GameEvent | undefined {
	if (previousMinutes === undefined || playtimeMinutes === undefined || previousMinutes === playtimeMinutes) return undefined;
	return createGameEvent({
		...context,
		type: 'playtime-changed',
		data: { previousMinutes, playtimeMinutes },
	});
}

export function gameEventId(event: GameEvent): string {
	const { observedAt: _observedAt, ...durable } = event;
	let hash = 2166136261;
	for (const character of stableStringify(durable)) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export const stableEventId = gameEventId;

function parseEvent(line: string): GameEvent | undefined {
	try {
		const value: unknown = JSON.parse(line);
		if (!isRecord(value)) return undefined;
		const allowed = ['schema', 'observedAt', 'occurredAt', 'provider', 'canonicalGameId', 'providerGameId', 'type', 'data'];
		if (Object.keys(value).some((key) => !allowed.includes(key))) return undefined;
		if (value.schema !== 1 || typeof value.observedAt !== 'string' || value.observedAt.trim().length === 0 ||
			(value.provider !== 'steam' && value.provider !== 'playstation') || typeof value.canonicalGameId !== 'string' || value.canonicalGameId.trim().length === 0 ||
			typeof value.providerGameId !== 'string' || value.providerGameId.trim().length === 0 ||
			(value.occurredAt !== undefined && typeof value.occurredAt !== 'string') ||
			(value.type !== 'playtime-changed' && value.type !== 'achievement-unlocked' && value.type !== 'trophy-unlocked' && value.type !== 'ownership-changed' && value.type !== 'game-first-seen') ||
			!isRecord(value.data)) return undefined;
		return createGameEvent({
			observedAt: value.observedAt,
			...(value.occurredAt === undefined ? {} : { occurredAt: value.occurredAt }),
			provider: value.provider,
			canonicalGameId: value.canonicalGameId,
			providerGameId: value.providerGameId,
			type: value.type,
			data: cloneValue(value.data),
		});
	} catch {
		return undefined;
	}
}

function parseEvents(content: string): GameEvent[] {
	const seen = new Set<string>();
	const events: GameEvent[] = [];
	for (const line of content.split(/\r?\n/u).filter((value) => value.trim().length > 0)) {
		const event = parseEvent(line);
		if (event === undefined) continue;
		const id = gameEventId(event);
		if (seen.has(id)) continue;
		seen.add(id);
		events.push(event);
	}
	return events;
}

export async function readGameEvents(gateway: HistoryGateway, path: string): Promise<GameEvent[]> {
	if (!(await gateway.exists(path))) return [];
	const content = await gateway.read(path);
	return parseEvents(content);
}

export class EventHistory {
	private readonly gateway: HistoryGateway;
	private readonly path: string;
	private readonly enabled: boolean;
	private readonly secretValues: readonly string[];

	constructor(options: EventHistoryOptions) {
		this.gateway = options.gateway;
		this.path = options.path;
		this.enabled = options.enabled;
		this.secretValues = options.secretValues ?? [];
	}

	private isAlreadyExistsError(error: unknown): boolean {
		return error instanceof Error && /already\s+exists?/iu.test(error.message);
	}

	async record(event: GameEvent, noteApplied: boolean): Promise<boolean> {
		if (!this.enabled || !noteApplied) return false;
		const sanitized = sanitizeEvent(event, this.secretValues);
		const id = gameEventId(sanitized);
		const line = `${JSON.stringify(sanitized)}\n`;
		if (!(await this.gateway.exists(this.path))) {
			try {
				await this.gateway.create(this.path, line);
				return true;
			} catch (error) {
				if (!this.isAlreadyExistsError(error) || !(await this.gateway.exists(this.path))) throw error;
			}
		}
		let appended = false;
		await this.gateway.process(this.path, (content) => {
			if (parseEvents(content).some((existing) => gameEventId(existing) === id)) return content;
			appended = true;
			if (content.length === 0) return line;
			return `${content}${content.endsWith('\n') ? '' : '\n'}${line}`;
		});
		return appended;
	}
}

export function createEventHistory(options: EventHistoryOptions): EventHistory {
	return new EventHistory(options);
}

export async function appendGameEvent(
	gateway: HistoryGateway,
	path: string,
	event: GameEvent,
	options: AppendEventOptions = {},
): Promise<boolean> {
	return new EventHistory({
		gateway,
		path,
		enabled: options.enabled ?? true,
		secretValues: options.secretValues,
	}).record(event, options.noteApplied ?? true);
}
