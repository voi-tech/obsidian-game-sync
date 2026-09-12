import type { MetadataPreference } from '../model/settings';
import type { CanonicalGameCandidate } from '../identity/resolver';
import type { MetadataEnrichment, MetadataLanguage, MetadataProvider } from './provider';

export type MetadataSourcePreference = 'automatic' | 'steam-first' | 'playstation-first';

export interface MetadataResolverOptions {
	sourcePreference?: MetadataSourcePreference;
	/** Existing setting is accepted as a language preference, without treating it as provider order. */
	metadataPreference?: MetadataPreference;
}

type CommonField = 'originalTitle' | 'releaseDate' | 'description' | 'cover' | 'developers' | 'publishers' | 'genres' | 'platforms' | 'sourceUrl';

function hasValue(value: unknown): boolean {
	if (typeof value === 'string') return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return value !== undefined && value !== null;
}

function stableTitle(title: string): boolean {
	const normalized = title.trim().toLocaleLowerCase('en-US');
	return normalized.length > 0 && normalized !== 'unknown' && normalized !== 'untitled';
}

function providerOrder(preference: MetadataSourcePreference): string[] {
	return preference === 'playstation-first' ? ['playstation', 'steam'] : ['steam', 'playstation'];
}

function orderedEnrichments(enrichments: readonly MetadataEnrichment[], preference: MetadataSourcePreference): MetadataEnrichment[] {
	const order = providerOrder(preference);
	return [...enrichments].sort((left, right) => order.indexOf(left.provider) - order.indexOf(right.provider));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function clonePlainRecord(value: Record<string, unknown>): Record<string, unknown> {
	const clone: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value)) {
		clone[key] = isPlainRecord(nested) ? clonePlainRecord(nested) : nested;
	}
	return clone;
}

function mergePlainRecords(base: Record<string, unknown>, enrichment: Record<string, unknown>): Record<string, unknown> {
	const merged = clonePlainRecord(base);
	for (const [key, value] of Object.entries(enrichment)) {
		const current = merged[key];
		merged[key] = isPlainRecord(current) && isPlainRecord(value) ? mergePlainRecords(current, value) : value;
	}
	return merged;
}

function selectField<T extends CommonField>(
	game: CanonicalGameCandidate,
	enrichments: readonly MetadataEnrichment[],
	field: T,
): CanonicalGameCandidate[T] {
	for (const enrichment of enrichments) {
		const value = enrichment[field];
		if (hasValue(value)) return value as CanonicalGameCandidate[T];
	}
	return game[field];
}

function mergeProviderState(game: CanonicalGameCandidate, enrichments: readonly MetadataEnrichment[]): NonNullable<CanonicalGameCandidate['providers']> {
	const providers = Object.fromEntries(
		Object.entries(game.providers ?? {}).map(([provider, state]) => [provider, state === undefined ? undefined : { ...state }]),
	) as NonNullable<CanonicalGameCandidate['providers']>;
	for (const enrichment of enrichments) {
		if (enrichment.providerState === undefined) continue;
		const current = providers[enrichment.provider] ?? {};
		providers[enrichment.provider] = mergePlainRecords(current as Record<string, unknown>, enrichment.providerState);
	}
	return providers;
}

/** Resolves common metadata without registering or constructing external providers. */
export async function resolveCanonicalMetadata(
	game: CanonicalGameCandidate,
	providers: readonly MetadataProvider[],
	language: MetadataLanguage,
	options: MetadataResolverOptions | MetadataSourcePreference = {},
): Promise<CanonicalGameCandidate> {
	const resolvedOptions: MetadataResolverOptions = typeof options === 'string' ? { sourcePreference: options } : options;
	const preference = resolvedOptions.sourcePreference ?? 'automatic';
	const enrichments: MetadataEnrichment[] = [];
	for (const provider of providers) {
		const enrichment = await provider.enrich(game, language);
		if (enrichment !== null) enrichments.push(enrichment);
	}
	const ordered = orderedEnrichments(enrichments, preference);
	const title = preference === 'automatic' && stableTitle(game.title)
		? game.title
		: ordered.find((enrichment) => hasValue(enrichment.title))?.title ?? game.title;
	return {
		...game,
		title,
		originalTitle: selectField(game, ordered, 'originalTitle'),
		releaseDate: selectField(game, ordered, 'releaseDate'),
		description: selectField(game, ordered, 'description'),
		cover: selectField(game, ordered, 'cover'),
		developers: selectField(game, ordered, 'developers'),
		publishers: selectField(game, ordered, 'publishers'),
		genres: selectField(game, ordered, 'genres'),
		platforms: selectField(game, ordered, 'platforms'),
		sourceUrl: selectField(game, ordered, 'sourceUrl'),
		providers: mergeProviderState(game, ordered),
	};
}
