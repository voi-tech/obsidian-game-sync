import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import { planCanonicalSync } from '../src/sync/canonical-planner';
import { buildCanonicalManagedProperties } from '../src/vault/canonical-projection';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { buildCanonicalTemplateContext } from '../src/vault/canonical-template';
import { FakeVaultGateway } from './fake-gateway';

class TrackingGateway extends FakeVaultGateway {
	readonly existsCalls: string[] = [];
	override async exists(path: string): Promise<boolean> {
		this.existsCalls.push(path);
		return super.exists(path);
	}
}

function game(overrides: Partial<CanonicalGame> = {}): CanonicalGame {
	return {
		identity: { canonicalKey: 'gametrack:integrity', externalIds: { gametrack: 'integrity', igdb: 42, steam: '440', playstation: 'ps-1' } },
		title: 'Integrity Game',
		metadata: { releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: ['Action'] },
		platforms: [{ id: 'pc', source: 'steam', owned: true }, { id: 'playstation-5', source: 'playstation' }],
		playtime: {
			observations: [
				{ source: 'steam', platform: 'pc', rawValue: 90, rawUnit: 'minutes', minutes: 90, confidence: 'high', valid: true },
				{ source: 'playstation', platform: 'playstation-5', rawValue: 30, rawUnit: 'minutes', minutes: 30, confidence: 'high', valid: true },
			],
		},
		activity: { lastPlayed: { value: '2026-09-20T12:00:00.000Z', source: 'steam', confidence: 'high' } },
		achievements: [
			{ source: 'steam', unlocked: 3, total: 10, completionPercent: 30, confidence: 'high' },
			{ source: 'playstation', unlocked: 2, total: 4, completionPercent: 50, confidence: 'high', details: [{ id: 'b', unlocked: true, trophyType: 'bronze' }] },
		],
		provenance: { provider: 'gametrack', sourceId: 'integrity', schemaSignature: 'fixture' },
		...overrides,
	};
}

describe('canonical projection integrity', () => {
	it('keeps provider fields separate and uses source-backed values', () => {
		const properties = buildCanonicalManagedProperties(game());

		expect(properties).toMatchObject({
			platforms: ['pc', 'playstation-5'], providers: ['gametrack', 'steam', 'playstation'], owned: true,
			'acquisition-type': 'unknown',
			'steam-owned': true, 'steam-playtime': 90, 'steam-last-played': '2026-09-20', 'playstation-playtime': 30,
			'playstation-id': 'ps-1', 'steam-achievements-earned': 3, 'psn-trophies-earned': 2, 'psn-bronze': 1,
		});
		expect(properties).not.toHaveProperty('achievements-unlocked');
	});

	it('projects zero trophy categories from an empty reliable details snapshot', () => {
		const properties = buildCanonicalManagedProperties(game({
			achievements: [{ source: 'playstation', unlocked: 0, total: 0, completionPercent: 0, confidence: 'high', details: [] }],
		}));

		expect(properties).toMatchObject({ 'psn-bronze': 0, 'psn-silver': 0, 'psn-gold': 0, 'psn-platinum': 0 });
	});

	it('keeps trophy categories unknown when the summary or details snapshot is absent', () => {
		const withoutSummary = buildCanonicalManagedProperties(game({ achievements: undefined }));
		const withoutDetails = buildCanonicalManagedProperties(game({
			achievements: [{ source: 'playstation', unlocked: 0, total: 0, completionPercent: 0, confidence: 'high' }],
		}));

		expect(withoutSummary).not.toHaveProperty('psn-bronze');
		expect(withoutDetails).not.toHaveProperty('psn-bronze');
	});

	it('omits a provider playtime value when observations conflict or are invalid', () => {
		const properties = buildCanonicalManagedProperties(game({ playtime: { observations: [
			{ source: 'steam', rawValue: 1, rawUnit: 'minutes', minutes: 1, confidence: 'high', valid: true },
			{ source: 'steam', rawValue: 2, rawUnit: 'minutes', minutes: 2, confidence: 'high', valid: true },
			{ source: 'playstation', rawValue: -1, rawUnit: 'minutes', minutes: -1, confidence: 'low', valid: false },
		] } }));

		expect(properties).not.toHaveProperty('steam-playtime');
		expect(properties).not.toHaveProperty('playstation-playtime');
	});

	it('preserves explicit false ownership for aggregate and provider-specific projections', () => {
		const properties = buildCanonicalManagedProperties(game({
			platforms: [{ id: 'pc', source: 'steam', owned: false }, { id: 'playstation-5', source: 'playstation', owned: false }],
		}));

		expect(properties).toMatchObject({ owned: false, 'steam-owned': false, 'playstation-owned': false });
	});

	it('leaves mixed and unknown ownership unresolved', () => {
		const properties = buildCanonicalManagedProperties(game({
			platforms: [{ id: 'pc', source: 'steam', owned: false }, { id: 'deck', source: 'steam' }, { id: 'playstation-5', source: 'playstation', owned: false }],
		}));

		expect(properties).not.toHaveProperty('owned');
		expect(properties).not.toHaveProperty('steam-owned');
		expect(properties['playstation-owned']).toBe(false);

		const context = buildCanonicalTemplateContext(game({
			platforms: [{ id: 'pc', source: 'steam', owned: false }, { id: 'deck', source: 'steam' }, { id: 'playstation-5', source: 'playstation', owned: false }],
		}));
		expect(context.owned).toBeUndefined();
		expect(context.steamOwned).toBeUndefined();
		expect(context.playstationOwned).toBe(false);
	});

	it('uses one updated timestamp in preview, template and written frontmatter', async () => {
		const gateway = new FakeVaultGateway({ 'Templates/game.tmpl': '# {{title}}\nupdated={{updated}}\n' });
		const plan = await planCanonicalSync([game()], { gateway, notesFolder: 'Games', templatePath: 'Templates/game.tmpl', updatedAt: '2026-09-24T10:00:00.000Z' });
		const operation = plan.operations[0];

		expect(operation.preview.properties['game-sync-updated']).toBe('2026-09-24T10:00:00.000Z');
		expect(operation.preview.body).toContain('updated=2026-09-24T10:00:00.000Z');
		await new CanonicalVaultWriter(gateway).apply(plan);
		expect((await gateway.read(operation.path))).toContain('game-sync-updated: 2026-09-24T10:00:00.000Z');
	});

	it('rejects a partial apply that selects only the technical timestamp before creating folders', async () => {
		const gateway = new FakeVaultGateway();
		const plan = await planCanonicalSync([game()], { gateway, notesFolder: 'Games', updatedAt: '2026-09-24T10:00:00.000Z' });
		const operation = plan.operations[0];
		const updated = operation.preview.changes.find((change) => change.sourceField === 'updated')!;

		await expect(new CanonicalVaultWriter(gateway).apply(plan, { operationIds: [operation.id], fieldIdsByOperation: { [operation.id]: [updated.fieldId] } })).rejects.toThrow(/technical updated/i);
		expect(gateway.hasFolder('Games')).toBe(false);
	});

	it('does not read a missing template for update-only plans', async () => {
		const gateway = new TrackingGateway();
		const initial = await planCanonicalSync([game()], { gateway, notesFolder: 'Games', updatedAt: '2026-09-24T10:00:00.000Z' });
		await new CanonicalVaultWriter(gateway).apply(initial);
		gateway.existsCalls.length = 0;

		const changed = game({ title: 'Integrity Game 2' });
		const plan = await planCanonicalSync([changed], { gateway, notesFolder: 'Games', templatePath: 'Templates/missing.tmpl', updatedAt: '2026-09-24T10:00:01.000Z' });

		expect(plan.statuses[0]?.status).toBe('update');
		expect(gateway.existsCalls).not.toContain('Templates/missing.tmpl');
	});

	it('reports a conflict without reading a template when every stable identity mapping is disabled', async () => {
		const gateway = new TrackingGateway();
		const plan = await planCanonicalSync([game()], {
			gateway,
			notesFolder: 'Games',
			templatePath: 'Templates/missing.tmpl',
			propertyMapping: { gameSyncId: null, igdbId: null, gametrackId: null, steamId: null, playstationId: null },
		});

		expect(plan.operations).toHaveLength(0);
		expect(plan.statuses[0]?.status).toBe('conflict');
		expect(gateway.existsCalls).not.toContain('Templates/missing.tmpl');
	});

	it('preserves a custom mapped canonical identity during an update', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Integrity Game.md': '---\nLOGICAL-ID: legacy-canonical\nigdb-id: 42\ntitle: Integrity Game\n---\nmanual\n' });
		const mapping = { gameSyncId: 'logical-id' } as const;
		const plan = await planCanonicalSync([game({ title: 'Integrity Game 2' })], { gateway, notesFolder: 'Games', propertyMapping: mapping, updatedAt: '2026-09-24T10:00:00.000Z' });

		expect(plan.operations[0]?.existingCanonicalId).toBe('legacy-canonical');
		await new CanonicalVaultWriter(gateway).apply(plan);
		expect(await gateway.read('Games/Integrity Game.md')).toContain('LOGICAL-ID: legacy-canonical');
	});

	it('does not create an update only for an old timestamp and omits disabled updated mapping', async () => {
		const gateway = new FakeVaultGateway();
		const initial = await planCanonicalSync([game()], { gateway, notesFolder: 'Games', updatedAt: '2026-01-01T00:00:00.000Z' });
		await new CanonicalVaultWriter(gateway).apply(initial);
		const unchanged = await planCanonicalSync([game()], { gateway, notesFolder: 'Games', updatedAt: '2026-09-24T10:00:00.000Z' });

		expect(unchanged.operations).toHaveLength(0);
		const disabled = await planCanonicalSync([game({ title: 'Integrity Game 2' })], { gateway, notesFolder: 'Games', propertyMapping: { updated: null }, updatedAt: '2026-09-24T10:00:00.000Z' });
		expect(disabled.operations[0]?.preview.properties).not.toHaveProperty('game-sync-updated');
	});
});
