import { ProviderNetworkError, ProviderRateLimitError } from '../network/errors';

export interface RetryOptions {
	maxAttempts?: number;
	baseDelayMs?: number;
	sleep?: (delayMs: number) => Promise<void>;
	random?: () => number;
}

const defaultSleep = (delayMs: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, delayMs));

function isRetryable(error: unknown): error is ProviderNetworkError | ProviderRateLimitError {
	return error instanceof ProviderNetworkError || error instanceof ProviderRateLimitError;
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const maxAttempts = options.maxAttempts ?? 3;
	const baseDelayMs = options.baseDelayMs ?? 250;
	const sleep = options.sleep ?? defaultSleep;
	const random = options.random ?? Math.random;
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new RangeError('Maximum attempts must be a positive integer.');
	}
	let attempt = 0;
	while (attempt < maxAttempts) {
		attempt += 1;
		try {
			return await operation();
		} catch (error) {
			if (!isRetryable(error) || attempt >= maxAttempts) {
				throw error;
			}
			const exponentialDelay = baseDelayMs * 2 ** (attempt - 1);
			const jitteredDelay = Math.round(exponentialDelay * (0.5 + random()));
			const delay = error instanceof ProviderRateLimitError && error.retryAfterMs !== undefined ? error.retryAfterMs : jitteredDelay;
			await sleep(delay);
		}
	}
	throw new Error('Retry loop exited unexpectedly.');
}
