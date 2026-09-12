import { z } from 'zod';

const imageSchema = z.object({ url: z.string().optional() }).loose();

export const playStationPlayedGameSchema = z.object({
	titleId: z.string(),
	name: z.string(),
	localizedName: z.string().optional(),
	imageUrl: z.string().optional(),
	localizedImageUrl: z.string().optional(),
	category: z.string().optional(),
	service: z.string().optional(),
	playCount: z.number().optional(),
	concept: z.object({ id: z.union([z.number(), z.string()]).optional(), titleIds: z.array(z.string()).optional(), name: z.string().optional(), media: z.object({ images: z.array(z.object({ url: z.string().optional() }).loose()).optional() }).loose().optional() }).loose().optional(),
	firstPlayedDateTime: z.string().optional(),
	lastPlayedDateTime: z.string().optional(),
	playDuration: z.string().optional(),
}).loose();

export const playStationPlayedGamesSchema = z.object({ titles: z.array(playStationPlayedGameSchema), totalItemCount: z.number().int().nonnegative().optional(), nextOffset: z.number().optional() });

export const playStationPurchasedGameSchema = z.object({ conceptId: z.string().nullable().optional(), name: z.string(), platform: z.string().optional(), titleId: z.string().optional(), image: imageSchema.optional(), membership: z.string().optional() }).loose();
export const playStationPurchasedGamesSchema = z.object({ games: z.array(playStationPurchasedGameSchema) });

export const playStationRecentlyPlayedGameSchema = z.object({ name: z.string(), platform: z.string().optional(), lastPlayedDateTime: z.string().optional(), titleId: z.string().optional(), conceptId: z.string().optional(), image: imageSchema.optional() }).loose();
export const playStationRecentlyPlayedGamesSchema = z.object({ games: z.array(playStationRecentlyPlayedGameSchema) });

export const playStationTrophyTitlesSchema = z.object({ titles: z.array(z.object({ npServiceName: z.enum(['trophy', 'trophy2']).optional(), npCommunicationId: z.string(), trophyTitleName: z.string(), trophyTitlePlatform: z.string().optional(), hiddenFlag: z.boolean().optional() }).loose()), totalItemCount: z.number().int().nonnegative().optional(), nextOffset: z.number().optional() });

export const playStationTrophyMetadataSchema = z.object({ npServiceName: z.enum(['trophy', 'trophy2']).optional(), totalItemCount: z.number().int().nonnegative().optional(), trophies: z.array(z.object({ trophyId: z.number().int(), trophyHidden: z.boolean().optional(), trophyType: z.enum(['bronze', 'silver', 'gold', 'platinum']).optional(), trophyName: z.string().optional(), trophyDetail: z.string().optional(), trophyIconUrl: z.string().optional() }).loose()), nextOffset: z.number().optional() }).loose();
export const playStationEarnedTrophiesSchema = z.object({ totalItemCount: z.number().int().nonnegative().optional(), trophies: z.array(z.object({ trophyId: z.number().int(), trophyHidden: z.boolean().optional(), earned: z.boolean().optional(), earnedDateTime: z.string().optional(), trophyType: z.enum(['bronze', 'silver', 'gold', 'platinum']).optional(), trophyEarnedRate: z.string().optional() }).loose()), nextOffset: z.number().optional() }).loose();
