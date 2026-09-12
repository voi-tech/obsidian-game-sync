import type { ProviderAchievementSet } from './achievement';
import type { GameIdentity } from './identity';
import type {
	AcquisitionType,
	GamePlatform,
	GameProvider,
	ProviderGameFreshness,
} from './provider';

export interface NormalizedProviderGame {
	providerGameId: string;
	title: string;
	originalTitle?: string;
	releaseDate?: string;
	description?: string;
	cover?: string;
	developers: string[];
	publishers: string[];
	genres: string[];
	platforms: GamePlatform[];
	owned?: boolean;
	acquisitionType?: AcquisitionType;
	playtimeMinutes?: number;
	lastPlayed?: string;
	achievements?: ProviderAchievementSet;
	sourceUrl?: string;
	freshness: ProviderGameFreshness;
}

export interface NormalizedGame {
	identity: GameIdentity;
	canonicalId: string;
	title: string;
	originalTitle?: string;
	releaseDate?: string;
	description?: string;
	cover?: string;
	developers: string[];
	publishers: string[];
	genres: string[];
	platforms: GamePlatform[];
	providers: Partial<Record<GameProvider, NormalizedProviderGame>>;
	owned: boolean;
	acquisitionType: AcquisitionType;
	playtimeMinutes: number;
	lastPlayed?: string;
}
