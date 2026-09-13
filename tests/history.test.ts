import { describe, expect, it } from 'vitest';
import { FakeVaultGateway } from './fake-gateway';
import {
	buildPlaytimeEvent,
	createEventHistory,
	createGameEvent,
	readGameEvents,
} from '../src/vault/history';

const context = {
	provider: 'steam' as const,
	canonicalGameId: 'game-sync:one',
	providerGameId: '1',
	observedAt: '2026-09-12T12:00:00.000Z',
};

describe('optional game event history', () => {
	it('does nothing when disabled', async () => {
		const gateway = new FakeVaultGateway();
		const history = createEventHistory({ gateway, path: 'archive/game-events.jsonl', enabled: false });
		const event = buildPlaytimeEvent(60, 90, context);

		if (event === undefined) throw new Error('Expected a playtime event.');
		expect(await history.record(event, true)).toBe(false);
		expect(await gateway.exists('archive/game-events.jsonl')).toBe(false);
	});

	it('does not create an event for unchanged playtime', () => {
		expect(buildPlaytimeEvent(60, 60, context)).toBeUndefined();
	});

	it('appends one event after a successful note apply and deduplicates a repeat sync', async () => {
		const gateway = new FakeVaultGateway({ 'archive/game-events.jsonl': '{"external":true}\n' });
		const history = createEventHistory({ gateway, path: 'archive/game-events.jsonl', enabled: true });
		const event = buildPlaytimeEvent(60, 90, context);

		if (event === undefined) throw new Error('Expected a playtime event.');
		expect(await history.record(event, true)).toBe(true);
		expect(await history.record(event, true)).toBe(false);
		const lines = await readGameEvents(gateway, 'archive/game-events.jsonl');
		expect(lines).toHaveLength(1);
		expect((await gateway.read('archive/game-events.jsonl')).startsWith('{"external":true}\n')).toBe(true);
		expect(lines[0]).toMatchObject({ type: 'playtime-changed', data: { previousMinutes: 60, playtimeMinutes: 90 } });
	});

	it('maps a provider timestamp to occurredAt and creates a missing file', async () => {
		const gateway = new FakeVaultGateway();
		const history = createEventHistory({ gateway, path: 'archive/game-events.jsonl', enabled: true });
		const event = createGameEvent({
			...context,
			type: 'achievement-unlocked',
			occurredAt: '2026-09-11T11:00:00.000Z',
			data: { achievementId: 'a-1' },
		});

		expect(await history.record(event, true)).toBe(true);
		expect((await readGameEvents(gateway, 'archive/game-events.jsonl'))[0]).toMatchObject({ occurredAt: '2026-09-11T11:00:00.000Z' });
	});

	it('does not record when the writer did not apply the note and redacts sensitive fields', async () => {
		const gateway = new FakeVaultGateway();
		const history = createEventHistory({ gateway, path: 'archive/game-events.jsonl', enabled: true, secretValues: ['secret-value'] });
		const event = createGameEvent({ ...context, type: 'game-first-seen', data: { apiKey: 'secret-value', safe: 'ok' } });

		expect(await history.record(event, false)).toBe(false);
		expect(await gateway.exists('archive/game-events.jsonl')).toBe(false);
	});

	it('sanitizes the complete event, including identifier fields and nested secret-shaped values', async () => {
		const gateway = new FakeVaultGateway();
		const history = createEventHistory({ gateway, path: 'archive/game-events.jsonl', enabled: true, secretValues: ['secret-value'] });
		const event = createGameEvent({
			...context,
			canonicalGameId: 'canonical-secret-value',
			providerGameId: 'provider-secret-value',
			type: 'game-first-seen',
			data: { nested: { token: 'secret-value', identifier: 'secret-value', safe: 'ok' } },
		});

		expect(await history.record(event, true)).toBe(true);
		const raw = await gateway.read('archive/game-events.jsonl');
		expect(raw).not.toContain('secret-value');
		expect(raw).toContain('[REDACTED]');
	});

	it('deduplicates duplicate durable lines when reading history', async () => {
		const event = createGameEvent({ ...context, type: 'game-first-seen', data: { operation: 'create-note' } });
		const line = `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`;
		const gateway = new FakeVaultGateway({ 'archive/game-events.jsonl': line });

		expect(await readGameEvents(gateway, 'archive/game-events.jsonl')).toHaveLength(1);
	});

	it('checks the event ID inside the atomic append callback', async () => {
		const gateway = new FakeVaultGateway();
		const originalProcess = gateway.process.bind(gateway);
		let processQueue = Promise.resolve();
		gateway.process = async (path, updater) => {
			const next = processQueue.then(() => originalProcess(path, updater));
			processQueue = next.then(() => undefined);
			await next;
		};
		await gateway.create('archive/game-events.jsonl', '');
		const history = createEventHistory({ gateway, path: 'archive/game-events.jsonl', enabled: true });
		const event = createGameEvent({ ...context, type: 'game-first-seen', data: { operation: 'create-note' } });

		expect(await Promise.all([history.record(event, true), history.record(event, true)])).toEqual([true, false]);
		expect((await gateway.read('archive/game-events.jsonl')).split('\n').filter(Boolean)).toHaveLength(1);
	});

	it('recovers a concurrent first append when create loses the race', async () => {
		const gateway = new FakeVaultGateway();
		const originalCreate = gateway.create.bind(gateway);
		gateway.create = async (path, content) => {
			await Promise.resolve();
			await originalCreate(path, content);
		};
		const history = createEventHistory({ gateway, path: 'archive/game-events.jsonl', enabled: true });
		const event = createGameEvent({ ...context, type: 'game-first-seen', data: { operation: 'create-note' } });

		expect(await Promise.all([history.record(event, true), history.record(event, true)])).toEqual([true, false]);
		expect((await readGameEvents(gateway, 'archive/game-events.jsonl'))).toHaveLength(1);
	});
});
