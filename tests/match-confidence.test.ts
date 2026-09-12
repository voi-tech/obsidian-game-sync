import { describe, expect, it } from 'vitest';
import { classifyMatch, isSafeForAutomaticMerge } from '../src/identity/confidence';
import type { MatchCandidate } from '../src/identity/confidence';

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
	return {
		title: 'Example Game',
		provider: 'steam',
		providerGameId: '10',
		...overrides,
	};
}

describe('match confidence', () => {
	it('classifies the same provider reference as explicit', () => {
		expect(classifyMatch({ left: candidate(), right: candidate() })).toBe('explicit');
	});

	it('classifies exact title, year and developer as high', () => {
		const left = candidate({ providerGameId: '10', year: 2019, developers: ['Example Studio'] });
		const right = candidate({ providerGameId: '20', year: 2019, developers: ['Example Studio'] });

		expect(classifyMatch({ left, right })).toBe('high');
		expect(isSafeForAutomaticMerge('high')).toBe(true);
	});

	it('keeps same-title different-year games ambiguous', () => {
		const left = candidate({ providerGameId: '2005', year: 2005 });
		const right = candidate({ providerGameId: '2023', year: 2023 });

		expect(classifyMatch({ left, right })).toBe('ambiguous');
		expect(isSafeForAutomaticMerge('ambiguous')).toBe(false);
	});

	it('keeps Resident Evil 4 releases and Last of Us editions from fuzzy merging', () => {
		expect(
			classifyMatch({
				left: candidate({ title: 'Resident Evil 4', year: 2005, providerGameId: '2005' }),
				right: candidate({ title: 'Resident Evil 4', year: 2023, providerGameId: '2023' }),
			}),
		).toBe('ambiguous');
		expect(
			classifyMatch({
				left: candidate({ title: 'The Last of Us Remastered', year: 2014, providerGameId: 'remastered' }),
				right: candidate({ title: 'The Last of Us Part I', year: 2022, providerGameId: 'part-i' }),
			}),
		).toBe('ambiguous');
		expect(isSafeForAutomaticMerge('likely')).toBe(false);
	});
});
