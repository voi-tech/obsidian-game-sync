import { ProviderNetworkError, ProviderRateLimitError } from '../network/errors';

export interface RetryOptions {
	maxAttempts?: number;
	baseDelayMs?: number;
	sleep?: (delayMs: number) => Promise<void>;
	random?: () => number;
}

const defaultSleep = (delayMs: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, delayMs));

export function isRetryableProviderError(error: unknown): error is ProviderNetworkError | ProviderRateLimitError {
	if (error instanceof ProviderRateLimitError) {
		return error.status === 429 && error.retryable;
	}
	if (error instanceof ProviderNetworkError) {
		return error.retryable && (error.status === undefined || error.status === 502 || error.status === 503 || error.status === 504);
	}
	return false;
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const requestedAttempts = options.maxAttempts ?? 3;
	const maxAttempts = Number.isFinite(requestedAttempts) ? Math.min(3, Math.max(1, Math.floor(requestedAttempts))) : 3;
	const baseDelayMs = options.baseDelayMs ?? 250;
	const sleep = options.sleep ?? defaultSleep;
	const random = options.random ?? Math.random;
	let attempt = 0;
	while (attempt < maxAttempts) {
		attempt += 1;
		try {
			return await operation();
		} catch (error) {
			if (!isRetryableProviderError(error) || attempt >= maxAttempts) {
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
