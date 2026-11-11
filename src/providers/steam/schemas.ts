// Named imports let esbuild tree-shake Zod; the `z` namespace object pulls in the whole library (about 350 KB).
import { array, boolean, number, object, record, string, union, type infer as Infer } from 'zod';

const optionalString = string().optional();

export const steamPlayerSummarySchema = object({
	steamid: string().regex(/^\d{17}$/),
	personaname: string(),
	profileurl: optionalString,
});

export const steamPlayerSummariesSchema = object({
	response: object({ players: array(steamPlayerSummarySchema).default([]) }),
});

export const steamResolveVanitySchema = object({
	response: object({
		success: number(),
		steamid: string().regex(/^\d{17}$/).optional(),
		message: optionalString,
	}),
});

const genreSchema = union([object({ id: optionalString, description: optionalString }), string()]);

export const steamOwnedGameSchema = object({
	appid: number().int().positive(),
		name: optionalString,
	playtime_forever: number().nonnegative().optional(),
	playtime_2weeks: number().nonnegative().optional(),
	rtime_last_played: number().nonnegative().optional(),
	last_played: optionalString,
	has_community_visible_stats: boolean().optional(),
	type: optionalString,
	app_type: optionalString,
	category: union([string(), array(string())]).optional(),
	is_free: boolean().optional(),
	platforms: union([record(string(), boolean()), array(string())]).optional(),
	genres: array(genreSchema).optional(),
	developers: array(string()).optional(),
	publishers: array(string()).optional(),
	description: optionalString,
	short_description: optionalString,
	header_image: optionalString,
	cover: optionalString,
	release_date: union([object({ date: optionalString }), string()]).optional(),
}).loose();

export const steamOwnedGamesSchema = object({
	response: object({
		game_count: number().int().nonnegative().optional(),
		games: array(steamOwnedGameSchema).optional(),
	}),
});

export const steamAppDetailsSchema = record(string(), object({
	success: boolean(),
	data: object({
		type: optionalString,
		is_free: boolean().optional(),
		name: optionalString,
		short_description: optionalString,
		detailed_description: optionalString,
		header_image: optionalString,
		platforms: record(string(), boolean()).optional(),
		genres: array(genreSchema).optional(),
		developers: array(string()).optional(),
		publishers: array(string()).optional(),
		categories: array(union([object({ id: number().optional(), description: optionalString }), string()])).optional(),
	}).loose().optional(),
}).loose());

export const steamPlayerAchievementSchema = object({
	apiname: optionalString,
	name: optionalString,
	displayName: optionalString,
	description: optionalString,
	achieved: number().int().min(0).max(1).optional(),
	unlocktime: number().nonnegative().optional(),
	icon: optionalString,
	icongray: optionalString,
	hidden: boolean().optional(),
});

export const steamPlayerAchievementsSchema = object({
	playerstats: object({
		steamID: optionalString,
		gameName: optionalString,
		success: boolean().optional(),
		error: optionalString,
		achievements: array(steamPlayerAchievementSchema).optional(),
	}),
});

export type SteamPlayerSummariesPayload = Infer<typeof steamPlayerSummariesSchema>;
export type SteamResolveVanityPayload = Infer<typeof steamResolveVanitySchema>;
export type SteamOwnedGamesPayload = Infer<typeof steamOwnedGamesSchema>;
export type SteamPlayerAchievementsPayload = Infer<typeof steamPlayerAchievementsSchema>;
