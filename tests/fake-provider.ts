import type { GameProvider, ProviderGame, ProviderSnapshot, ProviderSnapshotStatus } from '../src/model/provider';
import type { IdentityMapping } from '../src/model/identity';
import type { GameProviderAdapter } from '../src/providers/provider';
import { migrateState } from '../src/state/migrations';
import { createSyncPlanner } from '../src/sync/planner';
import { SyncService } from '../src/sync/service';
import { buildNoteIndex } from '../src/vault/note-index';
import { VaultWriter } from '../src/vault/writer';
import { FakeVaultGateway } from './fake-gateway';

export const INTEGRATION_FETCHED_AT = '2026-09-12T12:00:00.000Z';

export function fakeProviderGame(
	provider: GameProvider,
	providerGameId: string,
	title = 'Example Game',
	overrides: Partial<ProviderGame> = {},
): ProviderGame {
	const identity = provider === 'steam'
		? { provider: 'steam' as const, appId: Number(providerGameId.replace(/\D+/gu, '')) || 1 }
		: {
				provider: 'playstation' as const,
				conceptId: `concept-${providerGameId}`,
				titleIds: [`title-${providerGameId}`],
				npCommunicationIds: [`communication-${providerGameId}`],
		  };
	return {
		provider,
		providerGameId,
		title,
		releaseDate: '2024-01-01',
		developers: ['Studio'],
		publishers: [],
		genres: ['Action'],
		platforms: provider === 'steam' ? ['pc'] : ['ps5'],
		owned: true,
		acquisitionType: 'purchased',
		playtimeMinutes: 60,
		freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
		identity,
		...overrides,
	};
}

export function fakeProviderSnapshot(
	provider: GameProvider,
	games: readonly ProviderGame[],
	options: {
		status?: ProviderSnapshotStatus;
		fetchedAt?: string;
		error?: ProviderSnapshot['error'];
	} = {},
): ProviderSnapshot {
	const status = options.status ?? 'complete';
	return {
		provider,
		status,
		games: [...games],
		fetchedAt: options.fetchedAt ?? INTEGRATION_FETCHED_AT,
		pagination: { complete: status === 'complete', pagesFetched: 1 },
		paginationComplete: status === 'complete',
		...(options.error === undefined ? {} : { error: options.error }),
	};
}

export class FakeProvider {
	readonly id: GameProvider;
	snapshot: ProviderSnapshot;
	fetchCalls = 0;

	constructor(snapshot: ProviderSnapshot) {
		this.id = snapshot.provider;
		this.snapshot = snapshot;
	}

	adapter(): GameProviderAdapter {
		return {
			id: this.id,
			getConnectionStatus: async () => ({ provider: this.id, state: 'connected', connected: true }),
			testConnection: async () => ({ provider: this.id, displayName: this.id, accountId: `${this.id}-account` }),
			fetchLibrary: async () => {
				this.fetchCalls += 1;
				return this.snapshot;
			},
			disconnect: async () => undefined,
		};
	}
}

export interface IntegrationHarness {
	gateway: FakeVaultGateway;
	service: SyncService;
}

export async function createIntegrationHarness(options: {
	initialFiles?: Record<string, string>;
	providers: readonly FakeProvider[];
	state?: unknown;
}): Promise<IntegrationHarness> {
	const gateway = new FakeVaultGateway(options.initialFiles);
	const planner = createSyncPlanner({
		gateway,
		noteIndex: await buildNoteIndex(gateway),
		notesFolder: 'Games',
	});
	const service = new SyncService({
		adapters: options.providers.map((provider) => provider.adapter()),
		planner,
		writer: new VaultWriter(gateway),
		state: migrateState(options.state),
		now: () => INTEGRATION_FETCHED_AT,
	});
	return { gateway, service };
}

export function identityMappings(...pairs: Array<[GameProvider, string, string]>): IdentityMapping[] {
	return pairs.map(([provider, providerGameId, canonicalId]) => ({ provider, providerGameId, canonicalId }));
}

export async function applyPrepared(service: SyncService, prepared: Awaited<ReturnType<SyncService['prepareAll']>>) {
	return service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id), { explicit: true });
}
