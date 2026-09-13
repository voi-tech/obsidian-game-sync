export const en = {
	sync: {
		title: 'Game Sync',
		actions: {
			preview: 'Preview sync',
			apply: 'Apply selected changes',
		},
		providers: {
			steam: 'Steam',
			playstation: 'PlayStation',
		},
		status: {
			success: 'Completed',
			partial: 'Partially completed',
			failed: 'Failed',
		},
		summary: {
			gamesFetched: 'Games fetched: {count}',
			operationsCreated: 'Changes found: {count}',
			operationsApplied: 'Changes applied: {count}',
			deselected: 'Deselected: {count}',
			ignored: 'Ignored: {count}',
			reviewRequired: 'Review required: {count}',
		},
		messages: {
			providerFailed: 'The {provider} provider failed.',
		},
	},
	connect: {
		common: {
			connect: 'Connect',
		},
		steam: {
			title: 'Connect Steam',
			account: 'Steam account',
			accountDescription: 'Enter a SteamID64 or a public Steam profile URL.',
			apiKey: 'Steam Web API key',
			apiKeyDescription: 'The key is stored only after a successful connection test.',
			success: 'Connected to {displayName}. SteamID64: {steamId64}.',
			gameCount: 'Games: {count}',
			errors: {
				accountRequired: 'Enter a SteamID64 or profile URL.',
				apiKeyRequired: 'Enter a Steam Web API key.',
				invalidAccount: 'The Steam account could not be resolved.',
				invalidApiKey: 'The Steam Web API key was rejected.',
				privateGameDetails: 'Steam Game Details are private. Make the profile and Game Details public.',
				connectionFailed: 'The Steam connection failed. Check the account and try again.',
			},
		},
		playstation: {
			title: 'Connect PlayStation',
			unofficial: 'Unofficial integration',
			npssoWarning: 'NPSSO is treated like a password. Do not share it.',
			npsso: 'NPSSO',
			npssoDescription: 'Paste the temporary NPSSO value from your Sony account.',
			openPlayStation: 'Open PlayStation',
			openNpsso: 'Open Sony sign-in cookies',
			success: 'Connected as {displayName}.',
			error: 'The PlayStation connection failed. Try again.',
		},
	},
} as const;

export type TranslationCatalog = typeof en;

export type TranslationShape<T> = {
	readonly [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>;
};
