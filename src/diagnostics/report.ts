import type { GameProvider } from '../model/provider';
import type { LibraryProviderId } from '../model/library-provider';
import { sanitizeDiagnosticData, sanitizeError } from '../auth/sanitize';

export interface DiagnosticProviderInput {
	enabled?: boolean;
	status?: unknown;
	state?: unknown;
	readiness?: unknown;
	games?: unknown;
	warnings?: unknown;
	errorCodes?: unknown;
}

export interface DiagnosticReportInput {
	gameSyncVersion?: unknown;
	pluginVersion?: unknown;
	version?: unknown;
	obsidianVersion?: unknown;
	os?: unknown;
	platform?: unknown;
	osPlatform?: unknown;
	providers?: Partial<Record<GameProvider | LibraryProviderId, DiagnosticProviderInput>>;
	providerStatus?: Partial<Record<GameProvider | LibraryProviderId, DiagnosticProviderInput>>;
	providerStatuses?: Partial<Record<GameProvider | LibraryProviderId, DiagnosticProviderInput>>;
	enabledProviders?: Partial<Record<GameProvider | LibraryProviderId, boolean>>;
	lastSyncState?: unknown;
	lastSync?: unknown;
	stateSchemaVersion?: unknown;
	cacheSchemaVersion?: unknown;
	lastError?: unknown;
	error?: unknown;
	[key: string]: unknown;
}

type ProviderName = GameProvider | 'gametrack';

interface AllowlistedReportData {
	gameSyncVersion: unknown;
	obsidianVersion: unknown;
	osPlatform: unknown;
	providers: Record<ProviderName, { enabled: unknown; status: unknown; readiness: unknown; games: unknown; warnings: unknown; errorCodes: unknown }>;
	lastSyncState: unknown;
	stateSchemaVersion: unknown;
	cacheSchemaVersion: unknown;
}

const PROVIDERS: readonly ProviderName[] = ['gametrack', 'steam', 'playstation'];

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asText(value: unknown, fallback = 'unknown'): string {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : fallback;
}

function errorCodesValue(value: unknown): string | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((item): item is string => typeof item === 'string').slice(0, 20).join(', ') || undefined;
}

function providerValue(
	input: DiagnosticReportInput,
	provider: ProviderName,
	field: 'enabled' | 'status' | 'state',
): unknown {
	if (field === 'enabled' && input.enabledProviders?.[provider] !== undefined) return input.enabledProviders[provider];
	for (const source of [input.providers, input.providerStatuses, input.providerStatus]) {
		const value = source?.[provider]?.[field];
		if (value !== undefined) return value;
	}
	return undefined;
}

function lastSyncState(input: DiagnosticReportInput, sanitizedError: string | undefined): unknown {
	if (input.lastSyncState !== undefined) return input.lastSyncState;
	const sync = asRecord(input.lastSync);
	if (sync?.state !== undefined) return sync.state;
	if (sync?.status !== undefined) return sync.status;
	return sanitizedError === undefined ? undefined : 'failed';
}

function copyProviderStatus(input: DiagnosticReportInput, provider: ProviderName): { enabled: unknown; status: unknown; readiness: unknown; games: unknown; warnings: unknown; errorCodes: unknown } {
	const source = input.providers?.[provider] ?? input.providerStatuses?.[provider] ?? input.providerStatus?.[provider];
	const state = providerValue(input, provider, 'status') ?? providerValue(input, provider, 'state');
	return {
		enabled: providerValue(input, provider, 'enabled'),
		status: state,
		readiness: source?.readiness,
		games: source?.games,
		warnings: source?.warnings,
		errorCodes: errorCodesValue(source?.errorCodes),
	};
}

export function buildDiagnosticReport(input: DiagnosticReportInput, secrets: readonly string[] = []): string {
	const rawError = input.lastError ?? input.error;
	const sanitizedError = rawError === undefined ? undefined : sanitizeError(rawError, secrets);
	const allowlisted: AllowlistedReportData = {
		gameSyncVersion: input.gameSyncVersion ?? input.pluginVersion ?? input.version,
		obsidianVersion: input.obsidianVersion,
		osPlatform: input.osPlatform ?? `${asText(input.os)} / ${asText(input.platform)}`,
		providers: {
			gametrack: copyProviderStatus(input, 'gametrack'),
			steam: copyProviderStatus(input, 'steam'),
			playstation: copyProviderStatus(input, 'playstation'),
		},
		lastSyncState: lastSyncState(input, sanitizedError),
		stateSchemaVersion: input.stateSchemaVersion,
		cacheSchemaVersion: input.cacheSchemaVersion,
	};
	const safe = sanitizeDiagnosticData(allowlisted, secrets);

	const lines = [
		'Game Sync diagnostic report',
		`Game Sync version: ${asText(safe.gameSyncVersion)}`,
		`Obsidian version: ${asText(safe.obsidianVersion)}`,
		`OS/platform: ${asText(safe.osPlatform)}`,
		'Provider status:',
	];
	for (const provider of PROVIDERS) {
		const status = safe.providers[provider];
		const details = provider === 'gametrack'
			? `; readiness=${asText(status.readiness)}; games=${asText(status.games)}; warnings=${asText(status.warnings)}; errors=${asText(status.errorCodes)}`
			: '';
		lines.push(`${provider}: enabled=${asText(status.enabled)}; status=${asText(status.status)}${details}`);
	}
	lines.push(
		`Last sync state: ${asText(safe.lastSyncState)}`,
		`State schema version: ${asText(safe.stateSchemaVersion)}`,
		`Cache schema version: ${asText(safe.cacheSchemaVersion)}`,
	);
	return lines.join('\n');
}

export function copyDiagnosticReport(
	writeText: (text: string) => void,
	input: DiagnosticReportInput,
	secrets: readonly string[] = [],
): string {
	const report = buildDiagnosticReport(input, secrets);
	writeText(report);
	return report;
}
