import { normalizeTitle } from '../identity/normalize-title';
import { parseCsv, tableRecords } from '../providers/gametrack/csv/gametrack-csv-parser';
import { resolvePropertyMapping, type PropertyMapping } from '../model/property-mapping';
import type { IndexedNote } from '../vault/note-index';

/** One line of the PlayStation transaction export (our console script, or the older extension format). */
export interface PurchaseRow {
	readonly date: string;
	readonly productName: string;
	readonly type?: string;
	readonly skuId?: string;
	readonly price?: number;
	readonly currency?: string;
}

export interface PurchaseMatch {
	readonly path: string;
	readonly title: string;
	readonly date: string;
	readonly price?: number;
	readonly currency?: string;
	readonly productNames: readonly string[];
	/** False when the note already holds exactly these values. */
	readonly changed: boolean;
}

export interface PurchaseImportPlan {
	readonly rows: number;
	readonly purchases: number;
	readonly refunded: number;
	readonly matches: readonly PurchaseMatch[];
	/** Purchased products without a single matching game note (DLC, bundles, games without a note). */
	readonly unmatched: readonly string[];
	/** Products whose name fits more than one game note; left alone instead of guessing. */
	readonly ambiguous: readonly string[];
}

const COLUMN_ALIASES = {
	date: ['date'],
	productName: ['product_name', 'product name'],
	type: ['type'],
	skuId: ['sku_id', 'product sku id'],
	price: ['price', 'total price'],
	currency: ['currency', 'currency code'],
} as const;

// Money movements that are not a game purchase.
const NON_PRODUCT_TYPES = /WALLET|DEPOSIT|SUBSCRIPTION|VOUCHER|CREDIT|CONVERSION/iu;
const PLATFORM_SUFFIX = /\s*[-–:(]?\s*\b(?:PS4|PS5|PlayStation\s*[45])(?:\s*(?:&|and|i|\/|,)\s*(?:PS4|PS5|PlayStation\s*[45]))?\s*\)?\s*(?:version|wersja)?\s*$/iu;

function column(record: Readonly<Record<string, string>>, aliases: readonly string[]): string | undefined {
	for (const [key, value] of Object.entries(record)) {
		if (aliases.includes(key.trim().toLowerCase()) && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

function parsePrice(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined;
	const cleaned = raw.replace(/[^\d,.-]/gu, '');
	// "1.234,56" and "1,234.56" both end with the decimal separator.
	const decimal = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? ',' : '.';
	const normalized = cleaned.replaceAll(decimal === ',' ? '.' : ',', '').replace(',', '.');
	const value = Number(normalized);
	return Number.isFinite(value) && normalized.length > 0 ? Math.round(value * 100) / 100 : undefined;
}

function isoDate(raw: string): string | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(raw.trim());
	return match === null ? undefined : `${match[1]}-${match[2]}-${match[3]}`;
}

export function parsePurchaseCsv(text: string): PurchaseRow[] {
	const table = parseCsv(text);
	const headers = table.headers.map((header) => header.toLowerCase());
	if (!COLUMN_ALIASES.date.some((name) => headers.includes(name)) || !COLUMN_ALIASES.productName.some((name) => headers.includes(name))) {
		throw new Error('The file has no date and product name columns.');
	}
	return tableRecords(table).flatMap((record) => {
		const date = isoDate(column(record, COLUMN_ALIASES.date) ?? '');
		const productName = column(record, COLUMN_ALIASES.productName);
		if (date === undefined || productName === undefined) return [];
		const type = column(record, COLUMN_ALIASES.type);
		const skuId = column(record, COLUMN_ALIASES.skuId);
		const price = parsePrice(column(record, COLUMN_ALIASES.price));
		const currency = column(record, COLUMN_ALIASES.currency)?.toUpperCase();
		return [{ date, productName, ...(type === undefined ? {} : { type }), ...(skuId === undefined ? {} : { skuId }), ...(price === undefined ? {} : { price }), ...(currency === undefined ? {} : { currency }) }];
	});
}

/** Comparison key for a store product: trademark marks and trailing "PS4 & PS5" style platform labels removed. */
export function productKey(name: string): string {
	let value = name.replace(/[™®©]/gu, '').trim();
	for (let index = 0; index < 3; index += 1) {
		const next = value.replace(PLATFORM_SUFFIX, '').trim();
		if (next === value || next.length === 0) break;
		value = next;
	}
	return normalizeTitle(value);
}

function isRefund(row: PurchaseRow): boolean {
	return /REFUND/iu.test(row.type ?? '') || (row.price !== undefined && row.price < 0);
}

/** Purchases still in effect: refunds cancel the latest earlier purchase of the same product. */
export function effectivePurchases(rows: readonly PurchaseRow[]): { purchases: PurchaseRow[]; refunded: number } {
	const ordered = [...rows].sort((left, right) => left.date.localeCompare(right.date));
	const active: PurchaseRow[] = [];
	let refunded = 0;
	for (const row of ordered) {
		if (NON_PRODUCT_TYPES.test(row.type ?? '') && !isRefund(row)) continue;
		if (!isRefund(row)) { active.push(row); continue; }
		const key = productKey(row.productName);
		for (let index = active.length - 1; index >= 0; index -= 1) {
			if (productKey(active[index].productName) === key) { active.splice(index, 1); refunded += 1; break; }
		}
	}
	return { purchases: active, refunded };
}

function noteTitles(note: IndexedNote): string[] {
	const stem = note.path.split('/').at(-1)?.replace(/\.md$/iu, '') ?? note.path;
	return [...new Set([note.title, stem].filter((title): title is string => title !== undefined && title.trim().length > 0))];
}

function samePrice(current: unknown, next: number | undefined): boolean {
	if (next === undefined) return current === undefined;
	return (typeof current === 'number' || typeof current === 'string') && Number(current) === next;
}

/**
 * Matches purchases to game notes by exact normalized title. The earliest remaining purchase wins
 * (a later PS5 upgrade does not replace the original purchase date).
 */
export function planPurchaseImport(rows: readonly PurchaseRow[], notes: readonly IndexedNote[], options: { notesFolder: string; propertyMapping?: PropertyMapping }): PurchaseImportPlan {
	const folder = `${options.notesFolder.replace(/^\/+|\/+$/gu, '')}/`;
	const byKey = new Map<string, IndexedNote[]>();
	for (const note of notes) {
		if (folder !== '/' && !note.path.startsWith(folder)) continue;
		for (const title of noteTitles(note)) {
			const key = productKey(title);
			const list = byKey.get(key) ?? [];
			if (!list.includes(note)) list.push(note);
			byKey.set(key, list);
		}
	}
	const { purchases, refunded } = effectivePurchases(rows);
	const perNote = new Map<string, { note: IndexedNote; purchases: PurchaseRow[] }>();
	const unmatched = new Set<string>();
	const ambiguous = new Set<string>();
	for (const purchase of purchases) {
		const candidates = byKey.get(productKey(purchase.productName)) ?? [];
		if (candidates.length === 0) { unmatched.add(purchase.productName); continue; }
		if (candidates.length > 1) { ambiguous.add(purchase.productName); continue; }
		const note = candidates[0];
		const entry = perNote.get(note.path) ?? { note, purchases: [] };
		entry.purchases.push(purchase);
		perNote.set(note.path, entry);
	}
	const keys = resolvePropertyMapping(options.propertyMapping ?? {});
	const matches = [...perNote.values()].map(({ note, purchases: notePurchases }): PurchaseMatch => {
		const first = [...notePurchases].sort((left, right) => left.date.localeCompare(right.date))[0];
		const props = note.properties;
		const changed = (keys.purchaseDate !== undefined && props[keys.purchaseDate] !== first.date)
			|| (keys.purchasePrice !== undefined && !samePrice(props[keys.purchasePrice], first.price))
			|| (keys.purchaseCurrency !== undefined && (props[keys.purchaseCurrency] ?? undefined) !== first.currency);
		return {
			path: note.path,
			title: noteTitles(note)[0] ?? note.path,
			date: first.date,
			...(first.price === undefined ? {} : { price: first.price }),
			...(first.currency === undefined ? {} : { currency: first.currency }),
			productNames: [...new Set(notePurchases.map((purchase) => purchase.productName))],
			changed,
		};
	}).sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true }));
	return {
		rows: rows.length,
		purchases: purchases.length,
		refunded,
		matches,
		unmatched: [...unmatched].sort((left, right) => left.localeCompare(right)),
		ambiguous: [...ambiguous].sort((left, right) => left.localeCompare(right)),
	};
}

/** Applies one match to a frontmatter object, honouring disabled (unmapped) destinations. */
export function applyPurchase(frontmatter: Record<string, unknown>, match: PurchaseMatch, propertyMapping: PropertyMapping = {}): void {
	const keys = resolvePropertyMapping(propertyMapping);
	if (keys.purchaseDate !== undefined) frontmatter[keys.purchaseDate] = match.date;
	if (keys.purchasePrice !== undefined) {
		if (match.price === undefined) delete frontmatter[keys.purchasePrice];
		else frontmatter[keys.purchasePrice] = match.price;
	}
	if (keys.purchaseCurrency !== undefined) {
		if (match.currency === undefined) delete frontmatter[keys.purchaseCurrency];
		else frontmatter[keys.purchaseCurrency] = match.currency;
	}
}
