import type { MetadataLanguage } from '../model/settings';
import type { GameProvider } from '../model/provider';
import type { CanonicalGameCandidate } from '../identity/resolver';

export type { MetadataLanguage };

export interface MetadataEnrichment {
	provider: GameProvider;
	title?: string;
	originalTitle?: string;
	releaseDate?: string;
	description?: string;
	cover?: string;
	developers?: string[];
	publishers?: string[];
	genres?: string[];
	platforms?: string[];
	sourceUrl?: string;
	providerState?: Record<string, unknown>;
}

export interface MetadataProvider {
	readonly id: string;
	enrich(game: CanonicalGameCandidate, language: MetadataLanguage): Promise<MetadataEnrichment | null>;
}
