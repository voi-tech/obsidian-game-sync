import type { ProviderSnapshot } from '../model/provider';
import { isCompleteProviderSnapshot } from '../model/provider';

export type PresenceState = 'present' | 'missing-once' | 'missing-confirmed';

export interface PresenceTransition {
	state: PresenceState;
	consecutiveMissing: number;
	canReduceOwnership: boolean;
}

function presentInSnapshot(snapshot: ProviderSnapshot, providerGameId: string): boolean {
	return snapshot.games.some((game) => game.providerGameId === providerGameId);
}

function missingCount(state: PresenceState): number {
	if (state === 'missing-once') return 1;
	if (state === 'missing-confirmed') return 2;
	return 0;
}

export function transitionPresence(
	previous: PresenceState | undefined,
	snapshot: ProviderSnapshot,
	providerGameId: string,
	observedOwned?: boolean,
): PresenceTransition {
	const prior = previous ?? 'present';
	if (!isCompleteProviderSnapshot(snapshot)) {
		return { state: prior, consecutiveMissing: missingCount(prior), canReduceOwnership: false };
	}
	if (presentInSnapshot(snapshot, providerGameId)) {
		if (observedOwned === false) {
			if (prior === 'missing-once' || prior === 'missing-confirmed') return { state: 'missing-confirmed', consecutiveMissing: 2, canReduceOwnership: true };
			return { state: 'missing-once', consecutiveMissing: 1, canReduceOwnership: false };
		}
		return { state: 'present', consecutiveMissing: 0, canReduceOwnership: false };
	}
	if (prior === 'missing-once' || prior === 'missing-confirmed') {
		return { state: 'missing-confirmed', consecutiveMissing: 2, canReduceOwnership: true };
	}
	return { state: 'missing-once', consecutiveMissing: 1, canReduceOwnership: false };
}

export const transitionPresenceState = transitionPresence;

export function canReduceOwnershipFromPresence(
	state: PresenceState,
	snapshot: ProviderSnapshot,
	providerGameId: string,
	observedOwned?: boolean,
): boolean {
	return transitionPresence(state, snapshot, providerGameId, observedOwned).canReduceOwnership;
}
