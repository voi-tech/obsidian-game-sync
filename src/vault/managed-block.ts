import { VaultConflictError } from '../network/errors';

const BLOCK_PATTERN = /%% game-sync:achievements %%[\s\S]*?%% \/game-sync:achievements %%/g;

function matches(content: string): RegExpMatchArray[] {
	return [...content.matchAll(BLOCK_PATTERN)];
}

export function replaceAchievementsBlock(content: string, rendered: string): string {
	const found = matches(content);
	if (found.length > 1) throw new VaultConflictError('Multiple Game Sync achievement blocks found.');
	if (found.length === 0) {
		if (rendered.trim().length === 0) return content;
		const prefix = content.trimEnd();
		return prefix.length === 0 ? rendered : `${prefix}\n\n${rendered}`;
	}
	if (rendered.trim().length === 0) return content;
	const match = found[0];
	return `${content.slice(0, match.index)}${rendered}${content.slice((match.index ?? 0) + match[0].length)}`;
}

export function restoreAchievementsBlock(content: string, originalContent: string): string {
	const current = matches(content);
	const original = matches(originalContent);
	if (current.length > 1 || original.length > 1) throw new VaultConflictError('Multiple Game Sync achievement blocks found.');
	if (original.length === 0) {
		if (current.length === 0) return content;
		const match = current[0];
		return `${content.slice(0, match.index)}${content.slice((match.index ?? 0) + match[0].length)}`;
	}
	if (current.length === 0) {
		const prefix = content.trimEnd();
		return prefix.length === 0 ? original[0][0] : `${prefix}\n\n${original[0][0]}`;
	}
	const match = current[0];
	return `${content.slice(0, match.index)}${original[0][0]}${content.slice((match.index ?? 0) + match[0].length)}`;
}
