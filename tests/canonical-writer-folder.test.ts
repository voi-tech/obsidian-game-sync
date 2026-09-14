import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import { planCanonicalSync } from '../src/sync/canonical-planner';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { FakeVaultGateway } from './fake-gateway';

function game(): CanonicalGame {
	return {
		identity: { canonicalKey: 'gametrack:folder-test', externalIds: { gametrack: 'folder-test', igdb: 9001 } },
		title: 'Folder Test',
		metadata: { developers: [], publishers: [], genres: [] },
		platforms: [],
		playtime: { observations: [] },
		provenance: { provider: 'gametrack', sourceId: 'folder-test', schemaSignature: 'fixture' },
	};
}

async function plan(gateway: FakeVaultGateway, notesFolder: string): Promise<Awaited<ReturnType<typeof planCanonicalSync>>> {
	return planCanonicalSync([game()], { gateway, notesFolder });
}

describe('CanonicalVaultWriter target folders', () => {
	it('reuses an existing target folder', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Existing.md': '# existing' });
		const syncPlan = await plan(gateway, 'Games');

		await new CanonicalVaultWriter(gateway).apply(syncPlan);

		expect(gateway.hasFolder('Games')).toBe(true);
		expect(await gateway.exists('Games/Existing.md')).toBe(true);
		expect(await gateway.exists('Games/Folder Test.md')).toBe(true);
	});

	it('creates a missing target folder before the first note write', async () => {
		const gateway = new FakeVaultGateway();
		const syncPlan = await plan(gateway, 'Games');

		await new CanonicalVaultWriter(gateway).apply(syncPlan);

		expect(gateway.hasFolder('Games')).toBe(true);
		expect(await gateway.exists('Games/Folder Test.md')).toBe(true);
	});

	it('creates every missing parent in a nested target hierarchy', async () => {
		const gateway = new FakeVaultGateway();
		const syncPlan = await plan(gateway, 'Gaming/Library/Games');

		await new CanonicalVaultWriter(gateway).apply(syncPlan);

		expect(gateway.hasFolder('Gaming')).toBe(true);
		expect(gateway.hasFolder('Gaming/Library')).toBe(true);
		expect(gateway.hasFolder('Gaming/Library/Games')).toBe(true);
		expect(await gateway.exists('Gaming/Library/Games/Folder Test.md')).toBe(true);
	});

	it('stops before writes when the target path is an existing file', async () => {
		const gateway = new FakeVaultGateway({ Games: '# user file' });
		const syncPlan = await plan(gateway, 'Games');

		await expect(new CanonicalVaultWriter(gateway).apply(syncPlan)).rejects.toMatchObject({ code: 'TARGET_FOLDER_CONFLICT' });
		expect(await gateway.exists('Games/Folder Test.md')).toBe(false);
	});

	it('stops before writes when target folder creation fails', async () => {
		const gateway = new FakeVaultGateway();
		gateway.failEnsureFolder = new Error('permission denied');
		const syncPlan = await plan(gateway, 'Games');

		await expect(new CanonicalVaultWriter(gateway).apply(syncPlan)).rejects.toMatchObject({ code: 'TARGET_FOLDER_CREATE_FAILED' });
		expect(await gateway.exists('Games/Folder Test.md')).toBe(false);
	});
});
