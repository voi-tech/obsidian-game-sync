import type { GameProvider } from './provider';

export interface SteamIdentity {
	provider: 'steam';
	appId: number;
}

export interface PlayStationIdentity {
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
