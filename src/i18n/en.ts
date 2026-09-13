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
} as const;

export type TranslationCatalog = typeof en;

export type TranslationShape<T> = {
	readonly [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>;
};
