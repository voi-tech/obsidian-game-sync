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
	setup: {
		common: {
			continue: 'Continue',
			back: 'Back',
			open: 'Open',
		},
		welcome: {
			title: 'Welcome to Game Sync',
			privacy: 'Data flows from Steam and PlayStation to Obsidian. Game Sync has no telemetry or backend, and does not send your vault content anywhere.',
			secrets: 'API keys, NPSSO values and refresh tokens stay in Obsidian SecretStorage. They are never part of GameSyncData, the DOM or status messages.',
		},
		providers: {
			title: 'Choose providers',
			description: 'Select at least one provider to synchronize.',
			steam: 'Steam',
			playstation: 'PlayStation',
			required: 'Select at least one provider.',
		},
		connections: {
			title: 'Connect accounts',
			description: 'Open the existing provider connection dialog. Secrets are entered only there.',
			openSteam: 'Connect Steam',
			openPlayStation: 'Connect PlayStation',
			statusConnected: 'Connected',
			statusDisconnected: 'Not connected',
			statusNeedsAuth: 'Authentication required',
			statusError: 'Connection unavailable',
			statusUnknown: 'Status unavailable',
		},
		vault: {
			title: 'Vault files',
			folder: 'Games folder',
			pattern: 'Filename pattern',
			template: 'Template path',
			base: 'Base path',
			createBase: 'Create Games Base',
			templateInvalid: 'The template could not be validated.',
			openTemplate: 'Open template',
			fixTemplate: 'Fix template',
		},
		filters: {
			title: 'Library filters',
			includeUnplayed: 'Include unplayed games',
			includeFreeToPlay: 'Include free-to-play games',
			includePreviouslyPlayedNoLongerOwned: 'Include previously played games no longer owned',
			includeDemosTrials: 'Include demos and trials',
			includeBetasTestApps: 'Include betas and test apps',
		},
		behavior: {
			title: 'Sync behavior and history',
			previewMode: 'Preview mode',
			previewAlways: 'Always preview',
			previewFirst: 'Preview first sync and review changes',
			previewReview: 'Preview only when review is required',
			backgroundSync: 'Enable background sync',
			recordHistory: 'Record JSONL event history',
			backgroundInterval: 'Background interval (minutes)',
			historyPath: 'History path',
		},
		initialFetch: {
			title: 'Initial fetch and preview',
			description: 'Save this configuration, fetch provider data and hand the prepared result to the future preview screen.',
			fetch: 'Fetch and preview',
			preparing: 'Preparing preview…',
			saveFailed: 'Configuration could not be saved.',
			prepareFailed: 'The initial preview could not be prepared.',
		},
	},
} as const;

export type TranslationCatalog = typeof en;

export type TranslationShape<T> = {
	readonly [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>;
};
