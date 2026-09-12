import { VaultConflictError } from '../network/errors';

const BLOCK_PATTERN = /%% game-sync:achievements %%[\s\S]*?%% \/game-sync:achievements %%/g;

export function replaceAchievementsBlock(content: string, rendered: string): string {
	const matches = [...content.matchAll(BLOCK_PATTERN)];
	if (matches.length > 1) throw new VaultConflictError('Multiple Game Sync achievement blocks found.');
	if (matches.length === 0) {
		if (rendered.trim().length === 0) return content;
		const prefix = content.trimEnd();
		return prefix.length === 0 ? rendered : `${prefix}\n\n${rendered}`;
	}
	if (rendered.trim().length === 0) return content;
	const match = matches[0];
	return `${content.slice(0, match.index)}${rendered}${content.slice((match.index ?? 0) + match[0].length)}`;
}
