import type { GameProvider } from './provider';

export interface SteamIdentity {
	provider: 'steam';
	appId: number;
}

export type NonEmptyStringArray = [string, ...string[]];

export type PlayStationIdentity =
	| {
			provider: 'playstation';
			conceptId: string;
			titleIds: string[];
			npCommunicationIds: string[];
	  }
	| {
			provider: 'playstation';
			conceptId?: string;
			titleIds: NonEmptyStringArray;
			npCommunicationIds: string[];
	  }
	| {
			provider: 'playstation';
			conceptId?: string;
			titleIds: string[];
			npCommunicationIds: NonEmptyStringArray;
	  };

export interface PlayStationIdentityShape {
	provider: 'playstation';
	conceptId?: string;
	titleIds: string[];
	npCommunicationIds: string[];
}

export type ProviderIdentity = SteamIdentity | PlayStationIdentity;

export interface GameIdentity {
	canonicalId: string;
	steamAppId?: number;
	playstation?: Omit<PlayStationIdentity, 'provider'>;
}

export interface IdentityMapping {
	canonicalId: string;
	provider: GameProvider;
	providerGameId: string;
}

function nonEmpty(value: string | undefined): value is string {
	return value !== undefined && value.trim().length > 0;
}

export function createCanonicalGameId(identity: ProviderIdentity | GameIdentity): string {
	if ('canonicalId' in identity) {
		if (!nonEmpty(identity.canonicalId)) {
			throw new Error('Canonical game ID must not be empty.');
		}
		return identity.canonicalId;
	}
	if (identity.provider === 'steam') {
		if (!Number.isInteger(identity.appId) || identity.appId < 1) {
			throw new Error('Steam identity requires a positive numeric app ID.');
		}
		return `game-sync:steam:${identity.appId}`;
	}
	const concept = nonEmpty(identity.conceptId) ? identity.conceptId : '';
	const titleIds = identity.titleIds.filter(nonEmpty).sort();
	const communicationIds = identity.npCommunicationIds.filter(nonEmpty).sort();
	if (concept.length === 0 && titleIds.length === 0 && communicationIds.length === 0) {
		throw new Error('PlayStation identity requires a concept ID, title ID or communication ID.');
	}
	return `game-sync:playstation:${concept}:${titleIds.join(',')}:${communicationIds.join(',')}`;
}

export function resolveCanonicalGameId(
	identity: ProviderIdentity,
	providerGameId: string,
	mappings: readonly IdentityMapping[],
): string {
	if (!nonEmpty(providerGameId)) {
		throw new Error('Provider game ID must not be empty.');
	}
	const durableMapping = mappings.find(
		(mapping) => mapping.provider === identity.provider && mapping.providerGameId === providerGameId,
	);
	return durableMapping?.canonicalId ?? createCanonicalGameId(identity);
}
