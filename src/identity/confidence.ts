import type { GameProvider } from '../model/provider';
import { normalizeTitle } from './normalize-title';

export type MatchConfidence = 'explicit' | 'high' | 'likely' | 'ambiguous' | 'none';

export interface MatchCandidate {
	title: string;
	year?: number;
	releaseDate?: string;
	developers?: readonly string[];
	provider?: GameProvider;
	providerGameId?: string;
	providerIds?: Partial<Record<GameProvider, string>>;
	canonicalId?: string;
}

export interface MatchEvidence {
	left: MatchCandidate;
	right: MatchCandidate;
}

function nonEmpty(value: string | undefined): value is string {
	return value !== undefined && value.trim().length > 0;
}

function yearOf(candidate: MatchCandidate): number | undefined {
	if (candidate.year !== undefined) return candidate.year;
	if (candidate.releaseDate === undefined) return undefined;
	const year = Number(candidate.releaseDate.slice(0, 4));
	return Number.isInteger(year) && year > 0 ? year : undefined;
}

function normalizedDevelopers(candidate: MatchCandidate): Set<string> {
	return new Set((candidate.developers ?? []).map((developer) => normalizeTitle(developer)).filter((developer) => developer.length > 0));
}

function hasSameProviderReference(left: MatchCandidate, right: MatchCandidate): boolean {
	if (left.provider !== undefined && left.provider === right.provider && nonEmpty(left.providerGameId) && left.providerGameId === right.providerGameId) {
		return true;
	}
	for (const provider of ['steam', 'playstation'] as const) {
		if (nonEmpty(left.providerIds?.[provider]) && left.providerIds?.[provider] === right.providerIds?.[provider]) return true;
	}
	return false;
}

function hasCommonDeveloper(left: MatchCandidate, right: MatchCandidate): boolean {
	const rightDevelopers = normalizedDevelopers(right);
	return [...normalizedDevelopers(left)].some((developer) => rightDevelopers.has(developer));
}

function isVariantOfSameTitle(left: string, right: string): boolean {
	const leftWords = left.split(' ');
	const rightWords = right.split(' ');
	let common = 0;
	while (common < leftWords.length && common < rightWords.length && leftWords[common] === rightWords[common]) common += 1;
	const shortest = Math.min(leftWords.length, rightWords.length);
	return common >= 3 && common < shortest;
}

/**
 * Classifies evidence only. This function never performs or authorizes a
 * vault merge; fuzzy and variant matches remain reviewable suggestions.
 */
export function classifyMatch(evidence: MatchEvidence): MatchConfidence {
	const { left, right } = evidence;
	if (nonEmpty(left.canonicalId) && left.canonicalId === right.canonicalId) return 'explicit';
	if (hasSameProviderReference(left, right)) return 'explicit';

	const leftTitle = normalizeTitle(left.title);
	const rightTitle = normalizeTitle(right.title);
	if (leftTitle.length === 0 || rightTitle.length === 0) return 'none';

	const leftYear = yearOf(left);
	const rightYear = yearOf(right);
	const sameTitle = leftTitle === rightTitle;
	const sameYear = leftYear !== undefined && rightYear !== undefined && leftYear === rightYear;
	const differentYears = leftYear !== undefined && rightYear !== undefined && leftYear !== rightYear;
	const commonDeveloper = hasCommonDeveloper(left, right);

	if (sameTitle && differentYears) return 'ambiguous';
	if (isVariantOfSameTitle(leftTitle, rightTitle)) return 'ambiguous';
	if (sameTitle && sameYear && commonDeveloper) return 'high';
	if (sameTitle && sameYear) return 'likely';
	if (sameTitle && (leftYear === undefined || rightYear === undefined)) return 'likely';
	if (differentYears && commonDeveloper) return 'ambiguous';
	if (leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) return 'likely';
	return 'none';
}

/** Only direct identity or explicit metadata evidence may be auto-accepted. */
export function isSafeForAutomaticMerge(confidence: MatchConfidence): boolean {
	return confidence === 'explicit' || confidence === 'high';
}
