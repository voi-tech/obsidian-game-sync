import { describe, expect, it } from 'vitest';
import { mergeStateChanges } from '../src/state/merge';

describe('three-way state merge', () => {
	it('keeps changes made elsewhere when the writer did not touch that field', () => {
		const base = { settings: { notify: 'all', folder: 'Games' }, ignored: [] as string[], journal: [1] };
		const local = { settings: { notify: 'all', folder: 'Games' }, ignored: [] as string[], journal: [1, 2] };
		const current = { settings: { notify: 'none', folder: 'Games' }, ignored: ['x'], journal: [1] };

		expect(mergeStateChanges(base, local, current)).toEqual({ settings: { notify: 'none', folder: 'Games' }, ignored: ['x'], journal: [1, 2] });
	});

	it('merges array additions and removals from both sides', () => {
		expect(mergeStateChanges(['a', 'b'], ['b', 'c'], ['a', 'b', 'd'])).toEqual(['b', 'd', 'c']);
	});

	it('replaces an in-place modified array item instead of duplicating it', () => {
		const base = [{ id: 1, done: false }];
		const local = [{ id: 1, done: true }];
		expect(mergeStateChanges(base, local, base)).toEqual(local);
		expect(mergeStateChanges(base, local, [{ id: 1, done: false }, { id: 2, done: false }])).toEqual([{ id: 2, done: false }, { id: 1, done: true }]);
	});

	it('lets the writer win a conflicting scalar edit and drops keys it deleted', () => {
		expect(mergeStateChanges({ a: 1, b: 1 }, { a: 2 }, { a: 3, b: 1 })).toEqual({ a: 2 });
	});
});
