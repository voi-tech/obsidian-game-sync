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
	connect: {
		common: {
			connect: 'Połącz',
		},
		steam: {
			title: 'Połącz ze Steam',
			account: 'Konto Steam',
			accountDescription: 'Podaj SteamID64 albo publiczny adres profilu Steam.',
			apiKey: 'Klucz Steam Web API',
			apiKeyDescription: 'Klucz zostanie zapisany dopiero po pomyślnym teście połączenia.',
			success: 'Połączono z {displayName}. SteamID64: {steamId64}.',
			gameCount: 'Gry: {count}',
			errors: {
				accountRequired: 'Podaj SteamID64 albo adres profilu.',
				apiKeyRequired: 'Podaj klucz Steam Web API.',
				invalidAccount: 'Nie udało się rozpoznać konta Steam.',
				invalidApiKey: 'Klucz Steam Web API został odrzucony.',
				privateGameDetails: 'Szczegóły gier Steam są prywatne. Ustaw profil i szczegóły gier jako publiczne.',
				connectionFailed: 'Połączenie ze Steam nie powiodło się. Sprawdź konto i spróbuj ponownie.',
			},
		},
		playstation: {
			title: 'Połącz z PlayStation',
			unofficial: 'Nieoficjalna integracja',
			npssoWarning: 'NPSSO jest traktowane jak hasło. Nie udostępniaj go.',
			npsso: 'NPSSO',
			npssoDescription: 'Wklej tymczasową wartość NPSSO ze swojego konta Sony.',
			openPlayStation: 'Otwórz PlayStation',
			openNpsso: 'Otwórz ciasteczka logowania Sony',
			success: 'Połączono jako {displayName}.',
			error: 'Połączenie z PlayStation nie powiodło się. Spróbuj ponownie.',
		},
	},
} as const satisfies TranslationShape<TranslationCatalog>;
