import { describe, expect, it } from 'vitest';
import { ProviderAuthError, ProviderNetworkError, ProviderRateLimitError } from '../src/network/errors';
import { isRetryableProviderError, retry } from '../src/sync/retry';
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

	it('retains status and retryability and excludes non-transient provider errors', async () => {
		const rateLimited = new ProviderRateLimitError('slow down', 25);
		const gateway = new ProviderNetworkError('bad gateway', { status: 502 });
		const serverError = new ProviderNetworkError('server error', { status: 500, retryable: false });

		expect(rateLimited.status).toBe(429);
		expect(rateLimited.retryable).toBe(true);
		expect(gateway.status).toBe(502);
		expect(gateway.retryable).toBe(true);
		expect(isRetryableProviderError(rateLimited)).toBe(true);
		expect(isRetryableProviderError(gateway)).toBe(true);
		expect(isRetryableProviderError(serverError)).toBe(false);

		let attempts = 0;
		await expect(
			retry(async () => {
				attempts += 1;
				throw serverError;
			}, { sleep: async () => undefined }),
		).rejects.toBe(serverError);
		expect(attempts).toBe(1);
	});

	it('clamps maxAttempts to one through three total attempts', async () => {
		for (const [requested, expected] of [
			[0, 1],
			[2, 2],
			[9, 3],
		] as const) {
			let attempts = 0;
			await expect(
				retry(
					async () => {
						attempts += 1;
						throw new ProviderRateLimitError('slow down');
					},
					{ maxAttempts: requested, sleep: async () => undefined },
				),
			).rejects.toThrow(ProviderRateLimitError);
			expect(attempts).toBe(expected);
		}
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
