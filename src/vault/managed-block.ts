import { VaultConflictError } from '../network/errors';

const OPEN_MARKER = /^%% game-sync:achievements %%[^\S\r\n]*\r?$/gm;
const CLOSE_MARKER = /^%% \/game-sync:achievements %%[^\S\r\n]*\r?$/gm;
const FENCE = /^[^\S\r\n]{0,3}(`{3,}|~{3,})/;

interface BlockMatch {
	start: number;
	end: number;
	text: string;
}

/** Offset of the Markdown body: markers inside YAML frontmatter are user data, never a managed block. */
function bodyStart(content: string): number {
	const opening = /^\uFEFF?---[^\S\r\n]*\r?\n/.exec(content);
	if (opening === null) return 0;
	const closing = /^---[^\S\r\n]*(?:\r?\n|$)/m.exec(content.slice(opening[0].length));
	return closing === null ? content.length : opening[0].length + closing.index + closing[0].length;
}

/** Character ranges of fenced code blocks, where marker lines are examples, not delimiters. */
function fencedRanges(content: string, from: number): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let offset = from;
	let open: { start: number; marker: string } | undefined;
	for (const line of content.slice(from).split('\n')) {
		const fence = FENCE.exec(line)?.[1];
		if (fence !== undefined) {
			if (open === undefined) open = { start: offset, marker: fence };
			else if (fence[0] === open.marker[0] && fence.length >= open.marker.length) {
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
	return [...content.matchAll(pattern)]
		.filter((match) => match.index >= from && !fenced.some(([start, end]) => match.index >= start && match.index < end))
		.map((match) => ({ index: match.index, length: match[0].replace(/\r$/, '').length }));
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
	const found = findBlock(content);
	if (rendered.trim().length === 0) return content;
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
