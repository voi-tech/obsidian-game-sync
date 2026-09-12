import { z } from 'zod';

const optionalString = z.string().optional();

export const steamPlayerSummarySchema = z.object({
	steamid: z.string().regex(/^\d{17}$/),
	personaname: z.string(),
	profileurl: optionalString,
});

export const steamPlayerSummariesSchema = z.object({
	response: z.object({ players: z.array(steamPlayerSummarySchema).default([]) }),
});

export const steamResolveVanitySchema = z.object({
	response: z.object({
		success: z.number(),
		steamid: z.string().regex(/^\d{17}$/).optional(),
		message: optionalString,
	}),
});

const genreSchema = z.union([z.object({ id: optionalString, description: optionalString }), z.string()]);

export const steamOwnedGameSchema = z.object({
	appid: z.number().int().positive(),
		name: optionalString,
	playtime_forever: z.number().nonnegative().optional(),
	playtime_2weeks: z.number().nonnegative().optional(),
	rtime_last_played: z.number().nonnegative().optional(),
	last_played: optionalString,
	has_community_visible_stats: z.boolean().optional(),
	type: optionalString,
	app_type: optionalString,
	category: z.union([z.string(), z.array(z.string())]).optional(),
	is_free: z.boolean().optional(),
	platforms: z.union([z.record(z.string(), z.boolean()), z.array(z.string())]).optional(),
	genres: z.array(genreSchema).optional(),
	developers: z.array(z.string()).optional(),
	publishers: z.array(z.string()).optional(),
	description: optionalString,
	short_description: optionalString,
	header_image: optionalString,
	cover: optionalString,
	release_date: z.union([z.object({ date: optionalString }), z.string()]).optional(),
}).loose();

export const steamOwnedGamesSchema = z.object({
	response: z.object({
		game_count: z.number().int().nonnegative().optional(),
		games: z.array(steamOwnedGameSchema).optional(),
	}),
});

export const steamAppDetailsSchema = z.record(z.string(), z.object({
	success: z.boolean(),
	data: z.object({
		type: optionalString,
		is_free: z.boolean().optional(),
		name: optionalString,
		short_description: optionalString,
		detailed_description: optionalString,
		header_image: optionalString,
		platforms: z.record(z.string(), z.boolean()).optional(),
		genres: z.array(genreSchema).optional(),
		developers: z.array(z.string()).optional(),
		publishers: z.array(z.string()).optional(),
		categories: z.array(z.union([z.object({ id: z.number().optional(), description: optionalString }), z.string()])).optional(),
	}).loose().optional(),
}).loose());

export const steamPlayerAchievementSchema = z.object({
	name: optionalString,
	displayName: optionalString,
	description: optionalString,
	achieved: z.number().int().min(0).max(1).optional(),
	unlocktime: z.number().nonnegative().optional(),
	icon: optionalString,
	icongray: optionalString,
	hidden: z.boolean().optional(),
});

export const steamPlayerAchievementsSchema = z.object({
	playerstats: z.object({
		steamID: optionalString,
		gameName: optionalString,
		achievements: z.array(steamPlayerAchievementSchema).optional(),
	}),
});

export type SteamPlayerSummariesPayload = z.infer<typeof steamPlayerSummariesSchema>;
export type SteamResolveVanityPayload = z.infer<typeof steamResolveVanitySchema>;
export type SteamOwnedGamesPayload = z.infer<typeof steamOwnedGamesSchema>;
export type SteamPlayerAchievementsPayload = z.infer<typeof steamPlayerAchievementsSchema>;
