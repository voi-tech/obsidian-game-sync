const TRADEMARK_MARKS = /[™®©]/gu;
const DASH_VARIANTS = /[‐‑‒–—―−﹘﹣－]/gu;
const SINGLE_QUOTE_VARIANTS = /[‘’‚‛]/gu;
const DOUBLE_QUOTE_VARIANTS = /[“”„‟]/gu;
const OTHER_TYPOGRAPHIC_PUNCTUATION: ReadonlyMap<string, string> = new Map([
	['…', '...'],
	['«', '"'],
	['»', '"'],
]);

/**
 * Produces a comparison key for candidate discovery. It deliberately keeps
 * words such as Remastered, Remake and Director's Cut intact.
 */
export function normalizeTitle(title: string): string {
	let normalized = title.replace(TRADEMARK_MARKS, '').normalize('NFKC').replace(TRADEMARK_MARKS, '');
	normalized = normalized.replace(DASH_VARIANTS, '-');
	normalized = normalized.replace(SINGLE_QUOTE_VARIANTS, "'");
	normalized = normalized.replace(DOUBLE_QUOTE_VARIANTS, '"');
	for (const [from, to] of OTHER_TYPOGRAPHIC_PUNCTUATION) {
		normalized = normalized.replaceAll(from, to);
	}
	return normalized.toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}
