import type { GameProvider } from './provider';
import type { SyncPlan } from './operations';

export type MatchManagerCategory = 'merged' | 'kept-separate' | 'unresolved';
export type MatchResolutionAction = 'merge' | 'keep-separate' | 'skip';

export interface MatchManagerProvider {
	provider: GameProvider;
	providerRef: string;
	providerName: string;
}

interface MatchManagerRowBase {
	title?: string;
	existingPath?: string;
	providers: readonly MatchManagerProvider[];
}

export type MatchManagerRow =
	| (MatchManagerRowBase & { category: 'merged'; canonicalId: string })
	| (MatchManagerRowBase & { category: 'kept-separate'; leftCanonicalId: string; rightCanonicalId: string })
	| (MatchManagerRowBase & { category: 'unresolved'; canonicalId: string; candidatePath?: string; candidatePaths?: readonly string[]; reason?: string });

export interface UnmergePropertyChange {
	name: string;
	previousValue?: unknown;
	nextValue?: unknown;
}

export interface UnmergePreview {
	existingPath: string;
	newPath: string;
	providerToKeep: GameProvider;
	providerToSplit: GameProvider;
	providerToKeepId: string;
	providerToSplitId: string;
	providerIds: Record<GameProvider, string>;
	propertiesRemoved: UnmergePropertyChange[];
	propertiesAdded: UnmergePropertyChange[];
}

export type UnmergePlan = SyncPlan;

export interface PreparedUnmerge {
	planId: string;
	plan: UnmergePlan;
	preview: UnmergePreview;
	conflict?: string;
}

export interface MatchManagerController {
	getMatchManagerRows(): Promise<readonly MatchManagerRow[]>;
	prepareUnmerge(existingCanonicalId: string, providerToKeep: GameProvider): Promise<PreparedUnmerge>;
	applyUnmerge(prepared: PreparedUnmerge): Promise<void>;
	allowMatchingAgain(leftCanonicalId: string, rightCanonicalId: string): Promise<void>;
	resolveUnresolved(canonicalId: string, action: MatchResolutionAction, candidatePath?: string): Promise<void>;
}

export interface MatchManagerAdapter extends Omit<MatchManagerController, 'getMatchManagerRows'> {
	rows: readonly MatchManagerRow[];
}
