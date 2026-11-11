import { VaultConflictError } from '../network/errors';

const OPEN_MARKER = /^%% game-sync:achievements %%[^\S\r\n]*\r?$/gm;
const CLOSE_MARKER = /^%% \/game-sync:achievements %%[^\S\r\n]*\r?$/gm;
// CommonMark: up to three spaces of indentation (a tab already makes an indented code block), then 3+ backticks or tildes.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[^\S\r\n]*\r?$/;

interface BlockMatch {
	start: number;
	end: number;
	text: string;
}

/** Offset of the Markdown body: a BOM and YAML frontmatter are never part of a managed block. */
function bodyStart(content: string): number {
	const bom = content.startsWith('\uFEFF') ? 1 : 0;
	const opening = /^---[^\S\r\n]*\r?\n/.exec(content.slice(bom));
	if (opening === null) return bom;
	const afterOpening = bom + opening[0].length;
	const closing = /^---[^\S\r\n]*(?:\r?\n|$)/m.exec(content.slice(afterOpening));
	return closing === null ? content.length : afterOpening + closing.index + closing[0].length;
}

/** Character ranges of fenced code blocks, where marker lines are examples, not delimiters. */
function fencedRanges(content: string, from: number): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let offset = from;
	let open: { start: number; marker: string } | undefined;
	for (const line of content.slice(from).split('\n')) {
		if (open === undefined) {
			const opener = FENCE_OPEN.exec(line);
			// A backtick fence's info string may not contain backticks (that line is inline code, not a fence).
			if (opener !== null && !(opener[1][0] === '`' && opener[2].includes('`'))) open = { start: offset, marker: opener[1] };
		} else {
			const closer = FENCE_CLOSE.exec(line)?.[1];
			if (closer !== undefined && closer[0] === open.marker[0] && closer.length >= open.marker.length) {
				ranges.push([open.start, offset + line.length]);
				open = undefined;
			}
		}
		offset += line.length + 1;
	}
	if (open !== undefined) ranges.push([open.start, content.length]);
	return ranges;
}

function markerOffsets(content: string, pattern: RegExp, from: number, fenced: Array<[number, number]>): Array<{ index: number; length: number }> {
	// Scan the body only, so `^` also matches at its first character (after a BOM or frontmatter).
	return [...content.slice(from).matchAll(pattern)]
		.map((match) => ({ index: from + match.index, length: match[0].replace(/\r$/, '').length }))
		.filter((match) => !fenced.some(([start, end]) => match.index >= start && match.index < end));
}

/**
 * Finds the single managed block. Delimiters count only as whole lines in the Markdown body outside
 * fenced code, so YAML values and documentation examples are never treated as (or replaced by) the block.
 * Unbalanced or nested delimiters are refused instead of guessing, because guessing deletes user text.
 */
function findBlock(content: string): BlockMatch | undefined {
	const from = bodyStart(content);
	const fenced = fencedRanges(content, from);
	const opens = markerOffsets(content, OPEN_MARKER, from, fenced);
	const closes = markerOffsets(content, CLOSE_MARKER, from, fenced);
	if (opens.length === 0 && closes.length === 0) return undefined;
	if (opens.length > 1 || closes.length > 1) throw new VaultConflictError('Multiple Game Sync achievement blocks found.');
	const [open] = opens;
	const [close] = closes;
	if (open === undefined || close === undefined || close.index < open.index) throw new VaultConflictError('Malformed Game Sync achievement block delimiters.');
	const end = close.index + close.length;
	return { start: open.index, end, text: content.slice(open.index, end) };
}

function appendBlock(content: string, block: string): string {
	const prefix = content.trimEnd();
	return prefix.length === 0 ? block : `${prefix}\n\n${block}`;
}

export function replaceAchievementsBlock(content: string, rendered: string): string {
	if (rendered.trim().length === 0) return content;
	const found = findBlock(content);
	if (found === undefined) return appendBlock(content, rendered);
	return `${content.slice(0, found.start)}${rendered}${content.slice(found.end)}`;
}

export function restoreAchievementsBlock(content: string, originalContent: string): string {
	const current = findBlock(content);
	const original = findBlock(originalContent);
	if (original === undefined) return current === undefined ? content : `${content.slice(0, current.start)}${content.slice(current.end)}`;
	if (current === undefined) return appendBlock(content, original.text);
	return `${content.slice(0, current.start)}${original.text}${content.slice(current.end)}`;
}
