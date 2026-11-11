// Named imports let esbuild tree-shake Zod; the `z` namespace object pulls in the whole library (about 350 KB).
import { array, boolean, enum as zenum, number, object, string, union } from 'zod';

const imageSchema = object({ url: string().optional() }).loose();

export const playStationPlayedGameSchema = object({
	titleId: string(),
	name: string(),
	localizedName: string().optional(),
	imageUrl: string().optional(),
	localizedImageUrl: string().optional(),
	category: string().optional(),
	service: string().optional(),
	playCount: number().optional(),
	concept: object({ id: union([number(), string()]).optional(), titleIds: array(string()).optional(), name: string().optional(), media: object({ images: array(object({ url: string().optional() }).loose()).optional() }).loose().optional() }).loose().optional(),
	firstPlayedDateTime: string().optional(),
	lastPlayedDateTime: string().optional(),
	playDuration: string().optional(),
}).loose();

export const playStationPlayedGamesSchema = object({ titles: array(playStationPlayedGameSchema), totalItemCount: number().int().nonnegative().optional(), nextOffset: number().optional() });

export const playStationPurchasedGameSchema = object({ conceptId: string().nullable().optional(), name: string(), platform: string().optional(), titleId: string().optional(), image: imageSchema.optional(), membership: string().optional() }).loose();
export const playStationPurchasedGamesSchema = object({ games: array(playStationPurchasedGameSchema) });

export const playStationRecentlyPlayedGameSchema = object({ name: string(), platform: string().optional(), lastPlayedDateTime: string().optional(), titleId: string().optional(), conceptId: string().optional(), image: imageSchema.optional() }).loose();
export const playStationRecentlyPlayedGamesSchema = object({ games: array(playStationRecentlyPlayedGameSchema) });

export const playStationTrophyTitleSchema = object({ npServiceName: zenum(['trophy', 'trophy2']).optional(), npCommunicationId: string(), trophyTitleName: string(), trophyTitlePlatform: string().optional(), hiddenFlag: boolean().optional() }).loose();
export const playStationTrophyTitlesSchema = object({ titles: array(playStationTrophyTitleSchema), totalItemCount: number().int().nonnegative().optional(), nextOffset: number().optional() });

/** Paging envelope; list items are validated one by one so a single odd title cannot fail the whole sync. */
export const playStationPageSchema = object({ totalItemCount: number().int().nonnegative().optional(), nextOffset: number().optional() }).loose();

export const playStationTrophyMetadataSchema = object({ npServiceName: zenum(['trophy', 'trophy2']).optional(), totalItemCount: number().int().nonnegative().optional(), trophies: array(object({ trophyId: number().int(), trophyHidden: boolean().optional(), trophyType: zenum(['bronze', 'silver', 'gold', 'platinum']).optional(), trophyName: string().optional(), trophyDetail: string().optional(), trophyIconUrl: string().optional() }).loose()), nextOffset: number().optional() }).loose();
export const playStationEarnedTrophiesSchema = object({ totalItemCount: number().int().nonnegative().optional(), trophies: array(object({ trophyId: number().int(), trophyHidden: boolean().optional(), earned: boolean().optional(), earnedDateTime: string().optional(), trophyType: zenum(['bronze', 'silver', 'gold', 'platinum']).optional(), trophyEarnedRate: string().optional() }).loose()), nextOffset: number().optional() }).loose();
