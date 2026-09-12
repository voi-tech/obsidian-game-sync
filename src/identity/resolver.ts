import type { GameProvider } from '../model/provider';
import type { NormalizedProviderGame } from '../model/game';
import { createCanonicalGameId } from './id';
import type { CanonicalGameId, CanonicalIdFactory } from './id';
import { classifyMatch, type MatchCandidate, type MatchConfidence } from './confidence';
import {
	addNegativeMapping,
	areKeptSeparate,
	createPositiveMappingOperation,
	findCanonicalId,
	type IdentityMappingOperation,
	type IdentityMappingState,
	type ProviderReference,
} from './mappings';

export { createCanonicalGameId } from './id';
export type { CanonicalGameId, CanonicalIdFactory } from './id';
export type ProviderSpecificState = NormalizedProviderGame | Record<string, unknown>;

export interface CanonicalGameCandidate extends MatchCandidate {
	canonicalId: CanonicalGameId;
	title: string;
	originalTitle?: string;
	releaseDate?: string;
	description?: string;
	cover?: string;
	developers?: string[];
	publishers?: string[];
	genres?: string[];
	platforms?: string[];
	sourceUrl?: string;
	providers?: Partial<Record<GameProvider, ProviderSpecificState>>;
}

export interface IdentitySuggestion {
	canonicalId: CanonicalGameId;
	confidence: MatchConfidence;
}

export interface IdentityResolution {
	canonicalId: CanonicalGameId;
	confidence: MatchConfidence;
	suggestions: IdentitySuggestion[];
	operation?: IdentityMappingOperation;
}

export interface IdentityResolverOptions {
	mappings?: IdentityMappingState;
	idFactory?: CanonicalIdFactory;
}

function referenceOf(candidate: MatchCandidate): ProviderReference | undefined {
	if (candidate.provider === undefined || candidate.providerGameId === undefined || candidate.providerGameId.trim().length === 0) return undefined;
	return { provider: candidate.provider, providerGameId: candidate.providerGameId };
}

export function createIdentityResolver(options: IdentityResolverOptions = {}) {
	let state: IdentityMappingState = options.mappings ?? { identityMappings: [], negativeMappings: [] };
	const idFactory = options.idFactory;

	return {
		resolve(candidate: MatchCandidate, existingCandidates: readonly CanonicalGameCandidate[] = []): IdentityResolution {
			const reference = referenceOf(candidate);
			const durableCanonicalId = reference === undefined ? undefined : findCanonicalId(state, reference);
			if (durableCanonicalId !== undefined) {
				return { canonicalId: durableCanonicalId, confidence: 'explicit', suggestions: [] };
			}

			const suggestions = existingCandidates
				.map((existing) => ({ canonicalId: existing.canonicalId, confidence: classifyMatch({ left: candidate, right: existing }) }))
				.filter((suggestion) => suggestion.confidence !== 'none')
				.filter((suggestion) => candidate.canonicalId === undefined || !areKeptSeparate(state, candidate.canonicalId, suggestion.canonicalId))
				.sort((left, right) => ['explicit', 'high', 'likely', 'ambiguous', 'none'].indexOf(left.confidence) - ['explicit', 'high', 'likely', 'ambiguous', 'none'].indexOf(right.confidence));
			const canonicalId = candidate.canonicalId ?? createCanonicalGameId(idFactory);
			return { canonicalId, confidence: suggestions[0]?.confidence ?? 'none', suggestions };
		},
		mapProvider(reference: ProviderReference, canonicalId: CanonicalGameId): IdentityMappingOperation {
			return createPositiveMappingOperation({ canonicalId, ...reference });
		},
		getMappings(): IdentityMappingState {
			return { identityMappings: [...state.identityMappings], negativeMappings: [...state.negativeMappings] };
		},
		apply(operation: IdentityMappingOperation): void {
			if (operation.kind === 'add-positive') {
				const existing = findCanonicalId(state, operation.mapping);
				if (existing !== undefined && existing !== operation.mapping.canonicalId) {
					throw new Error('Provider reference is already mapped to another canonical game.');
				}
				if (existing === undefined) state = { ...state, identityMappings: [...state.identityMappings, { ...operation.mapping }] };
				return;
			}
			state = addNegativeMapping(state, operation.mapping.leftCanonicalId, operation.mapping.rightCanonicalId);
		},
	};
}
