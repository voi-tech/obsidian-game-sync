import type { IdentityMapping } from '../model/identity';
import type { GameProvider } from '../model/provider';
import type { NegativeIdentityMapping } from '../state/schema';

export interface ProviderReference {
	provider: GameProvider;
	providerGameId: string;
}

export interface IdentityMappingState {
	identityMappings: readonly IdentityMapping[];
	negativeMappings: readonly NegativeIdentityMapping[];
}

export type IdentityMappingOperation =
	| { kind: 'add-positive'; mapping: IdentityMapping }
	| { kind: 'keep-separate'; mapping: NegativeIdentityMapping };

function requireText(value: string, label: string): string {
	if (value.trim().length === 0) throw new Error(`${label} must not be empty.`);
	return value;
}

function negativePair(leftCanonicalId: string, rightCanonicalId: string): NegativeIdentityMapping {
	const left = requireText(leftCanonicalId, 'Canonical game ID');
	const right = requireText(rightCanonicalId, 'Canonical game ID');
	if (left === right) throw new Error('A game cannot be kept separate from itself.');
	return left < right
		? { leftCanonicalId: left, rightCanonicalId: right }
		: { leftCanonicalId: right, rightCanonicalId: left };
}

export function findCanonicalId(state: IdentityMappingState, reference: ProviderReference): string | undefined {
	return state.identityMappings.find(
		(mapping) => mapping.provider === reference.provider && mapping.providerGameId === reference.providerGameId,
	)?.canonicalId;
}

export function addPositiveMapping(state: IdentityMappingState, mapping: IdentityMapping): IdentityMappingState {
	const existing = findCanonicalId(state, mapping);
	if (existing !== undefined && existing !== mapping.canonicalId) {
		throw new Error('Provider reference is already mapped to another canonical game.');
	}
	if (existing === mapping.canonicalId) return { ...state, identityMappings: [...state.identityMappings] };
	return { ...state, identityMappings: [...state.identityMappings, { ...mapping }] };
}

export function addNegativeMapping(state: IdentityMappingState, leftCanonicalId: string, rightCanonicalId: string): IdentityMappingState {
	const mapping = negativePair(leftCanonicalId, rightCanonicalId);
	const exists = state.negativeMappings.some(
		(entry) => entry.leftCanonicalId === mapping.leftCanonicalId && entry.rightCanonicalId === mapping.rightCanonicalId,
	);
	return exists ? { ...state, negativeMappings: [...state.negativeMappings] } : { ...state, negativeMappings: [...state.negativeMappings, mapping] };
}

export function areKeptSeparate(state: IdentityMappingState, leftCanonicalId: string, rightCanonicalId: string): boolean {
	const mapping = negativePair(leftCanonicalId, rightCanonicalId);
	return state.negativeMappings.some(
		(entry) => entry.leftCanonicalId === mapping.leftCanonicalId && entry.rightCanonicalId === mapping.rightCanonicalId,
	);
}

export function createPositiveMappingOperation(mapping: IdentityMapping): IdentityMappingOperation {
	return { kind: 'add-positive', mapping: { ...mapping } };
}

export function createKeepSeparateOperation(leftCanonicalId: string, rightCanonicalId: string): IdentityMappingOperation {
	return { kind: 'keep-separate', mapping: negativePair(leftCanonicalId, rightCanonicalId) };
}

export function applyIdentityMappingOperation(state: IdentityMappingState, operation: IdentityMappingOperation): IdentityMappingState {
	return operation.kind === 'add-positive'
		? addPositiveMapping(state, operation.mapping)
		: addNegativeMapping(state, operation.mapping.leftCanonicalId, operation.mapping.rightCanonicalId);
}
