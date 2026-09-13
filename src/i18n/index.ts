import { getLanguage } from 'obsidian';
import { en, type TranslationCatalog } from './en';
import { pl } from './pl';

export { en } from './en';
export { pl } from './pl';
export type { TranslationCatalog, TranslationShape } from './en';

type TranslationTree = { readonly [key: string]: string | TranslationTree };

type LeafPaths<T> = {
	[K in keyof T & string]: T[K] extends string ? K : T[K] extends object ? `${K}.${LeafPaths<T[K]>}` : never;
}[keyof T & string];

type LeafAtPath<T, Path extends string> = Path extends `${infer Head}.${infer Tail}`
	? Head extends keyof T
		? LeafAtPath<T[Head], Tail>
		: never
	: Path extends keyof T
		? T[Path] extends string ? T[Path] : never
		: never;

type PlaceholderNames<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
	? Name | PlaceholderNames<Rest>
	: never;

export type TranslationKey = LeafPaths<TranslationCatalog>;

export type TranslationParams<Key extends TranslationKey> = [PlaceholderNames<LeafAtPath<TranslationCatalog, Key>>] extends [never]
	? never
	: Partial<Record<PlaceholderNames<LeafAtPath<TranslationCatalog, Key>>, string | number>>;

function readLeaf(tree: TranslationTree, key: string): string | undefined {
	let current: string | TranslationTree = tree;
	for (const segment of key.split('.')) {
		if (typeof current === 'string') return undefined;
		current = current[segment];
		if (current === undefined) return undefined;
	}
	return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
	return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) => {
		const value = params?.[name];
		return value === undefined ? placeholder : String(value);
	});
}

export function t<Key extends TranslationKey>(key: Key, params?: TranslationParams<Key>): string {
	const language = getLanguage().toLocaleLowerCase();
	const selected = language.startsWith('pl') ? pl : en;
	const template = readLeaf(selected, key) ?? readLeaf(en, key) ?? key;
	return interpolate(template, params as Record<string, string | number> | undefined);
}
