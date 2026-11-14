import { normalizeTitle } from '../identity/normalize-title';
import { parseCsv, tableRecords } from '../providers/gametrack/csv/gametrack-csv-parser';
import { resolvePropertyMapping, type PropertyMapping } from '../model/property-mapping';
import { existingPropertyKey } from '../vault/frontmatter';
import type { IndexedNote } from '../vault/note-index';

/** One line of the PlayStation transaction export (our console script, or the older extension format). */
export interface PurchaseRow {
	readonly date: string;
	/** Full transaction time (ms) when the export has one; orders same-day purchases and refunds. */
	readonly time?: number;
	readonly transactionId?: string;
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
	/** Fingerprint of the note when the preview was made; the write is rejected if the note changed since. */
	readonly fingerprint?: string;
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
	/** Refunds that fit more than one earlier purchase of the product; nothing was cancelled for them. */
	readonly unresolvedRefunds: readonly string[];
}

const COLUMN_ALIASES = {
	date: ['date'],
	transactionId: ['transaction_id', 'transaction id'],
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

// Plain amount with an optional decimal part ("299", "-12.5", "59,99").
const PLAIN_AMOUNT = /^-?\d+(?:[.,]\d{1,2})?$/u;
// Grouped amount with a mandatory decimal part ("1,234.56", "1.234,56", "1 234,56").
const GROUPED_AMOUNT = /^-?\d{1,3}(?:([ .,'])\d{3})+([.,])\d{2}$/u;

/**
 * Reads a price only when its format is unambiguous. "1,234" (thousands or decimals?) is rejected rather than
 * guessed; an unreadable price is treated as unknown, which leaves the note's existing price untouched.
 */
export function parsePrice(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined;
	let text = raw.replace(/[\u00a0\u202f]/gu, ' ').trim();
	const accountingNegative = /^\(.*\)$/u.test(text);
	if (accountingNegative) text = text.slice(1, -1);
	// Currency symbols and codes around the number ("zł 299,00", "$59.99", "59.99 USD").
	text = text.replace(/^[^\d-]+|[^\d]+$/gu, '').trim();
	let normalized: string | undefined;
	if (PLAIN_AMOUNT.test(text)) normalized = text.replace(',', '.');
	else {
		const grouped = GROUPED_AMOUNT.exec(text);
		if (grouped !== null && grouped[1] !== grouped[2]) normalized = text.replace(/[ .,']/gu, (_separator, offset: number) => offset === text.length - 3 ? '.' : '');
	}
	if (normalized === undefined) return undefined;
	const value = Number(normalized);
	if (!Number.isFinite(value)) return undefined;
	return Math.round((accountingNegative ? -Math.abs(value) : value) * 100) / 100;
}

/** Calendar date (YYYY-MM-DD) and, when present, the full timestamp; impossible dates are rejected. */
function parseDate(raw: string): { date: string; time?: number } | undefined {
	const trimmed = raw.trim();
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/u.exec(trimmed);
	if (match === null) return undefined;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const check = new Date(Date.UTC(year, month - 1, day));
	if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
	// Sony writes offsets as "+0000"; Date.parse needs "+00:00".
	const time = Date.parse(trimmed.replace(/([+-]\d{2})(\d{2})$/u, '$1:$2'));
	return { date: `${match[1]}-${match[2]}-${match[3]}`, ...(Number.isFinite(time) && trimmed.length > 10 ? { time } : {}) };
}

export function parsePurchaseCsv(text: string): PurchaseRow[] {
	const table = parseCsv(text);
	const headers = table.headers.map((header) => header.toLowerCase());
	if (!COLUMN_ALIASES.date.some((name) => headers.includes(name)) || !COLUMN_ALIASES.productName.some((name) => headers.includes(name))) {
		throw new Error('The file has no date and product name columns.');
	}
	return tableRecords(table).flatMap((record) => {
		const parsedDate = parseDate(column(record, COLUMN_ALIASES.date) ?? '');
		const productName = column(record, COLUMN_ALIASES.productName);
		if (parsedDate === undefined || productName === undefined) return [];
		const transactionId = column(record, COLUMN_ALIASES.transactionId);
		const type = column(record, COLUMN_ALIASES.type);
		const skuId = column(record, COLUMN_ALIASES.skuId);
		const price = parsePrice(column(record, COLUMN_ALIASES.price));
		const currency = column(record, COLUMN_ALIASES.currency)?.toUpperCase();
		return [{ ...parsedDate, ...(transactionId === undefined ? {} : { transactionId }), productName, ...(type === undefined ? {} : { type }), ...(skuId === undefined ? {} : { skuId }), ...(price === undefined ? {} : { price }), ...(currency === undefined ? {} : { currency }) }];
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

function rowIdentity(row: PurchaseRow): string {
	return JSON.stringify([row.transactionId, row.time ?? row.date, row.type ?? '', row.productName, row.skuId ?? '', row.price ?? null, row.currency ?? '']);
}

/** The same transaction line exported twice (overlapping pages, repeated paste) counts once. */
function withoutDuplicates(rows: readonly PurchaseRow[]): PurchaseRow[] {
	const seen = new Set<string>();
	return rows.filter((row) => {
		if (row.transactionId === undefined) return true;
		const identity = rowIdentity(row);
		if (seen.has(identity)) return false;
		seen.add(identity);
		return true;
	});
}

function chronological(left: PurchaseRow, right: PurchaseRow): number {
	const byTime = (left.time ?? Date.parse(left.date)) - (right.time ?? Date.parse(right.date));
	if (byTime !== 0) return byTime;
	// Without a time of day, a purchase comes before a refund on the same date.
	return Number(isRefund(left)) - Number(isRefund(right));
}

/**
 * The purchase a refund cancels: the same SKU (narrowed by amount and currency), else the same amount and
 * currency, else the only purchase of that product. Several identical purchases are interchangeable, so the
 * latest one goes (a refund follows its purchase). When the fitting purchases differ, nothing is cancelled
 * (undefined) instead of guessing.
 */
function refundedIndex(active: readonly PurchaseRow[], refund: PurchaseRow): number | undefined {
	const key = productKey(refund.productName);
	const candidates = active.map((row, index) => ({ row, index })).filter(({ row }) => productKey(row.productName) === key);
	if (candidates.length === 0) return -1;
	const amount = refund.price === undefined ? undefined : Math.abs(refund.price);
	const sameAmount = (list: typeof candidates) => amount === undefined ? [] : list.filter(({ row }) => row.price === amount && (refund.currency === undefined || row.currency === undefined || row.currency === refund.currency));
	const latestIfIdentical = (list: typeof candidates): number | undefined => new Set(list.map(({ row }) => `${row.skuId ?? ''}|${row.price ?? ''}|${row.currency ?? ''}`)).size === 1 ? list.at(-1)!.index : undefined;
	const bySku = refund.skuId === undefined ? [] : candidates.filter(({ row }) => row.skuId === refund.skuId);
	if (bySku.length > 0) {
		const narrowed = sameAmount(bySku);
		return latestIfIdentical(narrowed.length > 0 ? narrowed : bySku);
	}
	const byAmount = sameAmount(candidates);
	if (byAmount.length > 0) return latestIfIdentical(byAmount);
	return candidates.length === 1 ? candidates[0].index : undefined;
}

/** Purchases still in effect after refunds, in chronological order. */
export function effectivePurchases(rows: readonly PurchaseRow[]): { purchases: PurchaseRow[]; refunded: number; unresolvedRefunds: string[] } {
	const ordered = withoutDuplicates(rows).sort(chronological);
	const active: PurchaseRow[] = [];
	const unresolvedRefunds: string[] = [];
	let refunded = 0;
	for (const row of ordered) {
		if (NON_PRODUCT_TYPES.test(row.type ?? '') && !isRefund(row)) continue;
		if (!isRefund(row)) { active.push(row); continue; }
		const index = refundedIndex(active, row);
		if (index === undefined) unresolvedRefunds.push(row.productName);
		else if (index >= 0) { active.splice(index, 1); refunded += 1; }
	}
	return { purchases: active, refunded, unresolvedRefunds };
}

function noteTitles(note: IndexedNote): string[] {
	const stem = note.path.split('/').at(-1)?.replace(/\.md$/iu, '') ?? note.path;
	return [...new Set([note.title, stem].filter((title): title is string => title !== undefined && title.trim().length > 0))];
}

function samePrice(current: unknown, next: number | undefined): boolean {
	// An unknown imported price leaves the note's price as it is.
	if (next === undefined) return true;
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
	const { purchases, refunded, unresolvedRefunds } = effectivePurchases(rows);
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
		const first = [...notePurchases].sort(chronological)[0];
		const props = note.properties;
		const read = (key: string): unknown => props[existingPropertyKey(props, key)];
		const changed = (keys.purchaseDate !== undefined && read(keys.purchaseDate) !== first.date)
			|| (keys.purchasePrice !== undefined && !samePrice(read(keys.purchasePrice), first.price))
			|| (keys.purchaseCurrency !== undefined && first.currency !== undefined && read(keys.purchaseCurrency) !== first.currency);
		return {
			path: note.path,
			title: noteTitles(note)[0] ?? note.path,
			date: first.date,
			...(first.price === undefined ? {} : { price: first.price }),
			...(first.currency === undefined ? {} : { currency: first.currency }),
			productNames: [...new Set(notePurchases.map((purchase) => purchase.productName))],
			...(note.fingerprint === undefined ? {} : { fingerprint: note.fingerprint }),
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
		unresolvedRefunds: [...new Set(unresolvedRefunds)].sort((left, right) => left.localeCompare(right)),
	};
}

/**
 * Applies one match to a frontmatter object, honouring disabled (unmapped) destinations. A value missing from
 * the export is unknown, not "no price": the note keeps what it has.
 */
export function applyPurchase(frontmatter: Record<string, unknown>, match: PurchaseMatch, propertyMapping: PropertyMapping = {}): void {
	const keys = resolvePropertyMapping(propertyMapping);
	const set = (key: string | undefined, value: unknown): void => {
		if (key !== undefined && value !== undefined) frontmatter[existingPropertyKey(frontmatter, key)] = value;
	};
	set(keys.purchaseDate, match.date);
	set(keys.purchasePrice, match.price);
	set(keys.purchaseCurrency, match.currency);
}
