import type { TranslationCatalog, TranslationShape } from './en';

export const pl = {
	sync: {
		title: 'Game Sync',
		actions: {
			preview: 'Podgląd synchronizacji',
			apply: 'Zastosuj wybrane zmiany',
		},
		providers: {
			steam: 'Steam',
			playstation: 'PlayStation',
		},
		status: {
			success: 'Zakończono',
			partial: 'Zakończono częściowo',
			failed: 'Niepowodzenie',
		},
		summary: {
			gamesFetched: 'Pobrane gry: {count}',
			operationsCreated: 'Znalezione zmiany: {count}',
			operationsApplied: 'Zastosowane zmiany: {count}',
			deselected: 'Odznaczone: {count}',
			ignored: 'Pominięte: {count}',
			reviewRequired: 'Wymaga przeglądu: {count}',
		},
		messages: {
			providerFailed: 'Provider {provider} zakończył działanie błędem.',
		},
	},
} as const satisfies TranslationShape<TranslationCatalog>;
