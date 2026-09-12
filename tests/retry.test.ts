import { describe, expect, it } from 'vitest';
import { ProviderAuthError, ProviderRateLimitError } from '../src/network/errors';
import { retry } from '../src/sync/retry';
import { mapWithLimit } from '../src/utils/concurrency';

describe('provider retry and bounded concurrency', () => {
	it('retries transient failures at most three total attempts', async () => {
		let attempts = 0;
		const waits: number[] = [];

		const result = await retry(
			async () => {
				attempts += 1;
				if (attempts < 3) {
					throw new ProviderRateLimitError('slow down', 25);
				}
				return 'ok';
			},
			{ sleep: async (delay) => void waits.push(delay), random: () => 0.5 },
		);

		expect(result).toBe('ok');
		expect(attempts).toBe(3);
		expect(waits).toEqual([25, 25]);
	});

	it('does not retry authentication failures', async () => {
		let attempts = 0;

		await expect(
			retry(async () => {
				attempts += 1;
				throw new ProviderAuthError('unauthorized');
			}),
		).rejects.toThrow(ProviderAuthError);

		expect(attempts).toBe(1);
	});

	it('preserves output ordering while respecting the concurrency limit', async () => {
		let active = 0;
		let peak = 0;
		const result = await mapWithLimit([1, 2, 3, 4], 2, async (value) => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, value === 1 ? 5 : 1));
			active -= 1;
			return value * 2;
		});

		expect(result).toEqual([2, 4, 6, 8]);
		expect(peak).toBeLessThanOrEqual(2);
	});
});
