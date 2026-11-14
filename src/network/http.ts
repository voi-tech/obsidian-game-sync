import { requestUrl, type RequestUrlResponse } from 'obsidian';
import type { ZodType } from 'zod';
import {
	ProviderAuthError,
	ProviderHttpError,
	ProviderNetworkError,
	ProviderRateLimitError,
	ProviderSchemaError,
} from './errors';
import { describeIssues, issuePaths, withoutNulls } from './validation';

export interface HttpRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

export interface HttpTransportResponse {
	status: number;
	headers: Record<string, string>;
	json: unknown;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpTransportResponse>;

export interface HttpClient {
	request<T>(request: HttpRequest, schema: ZodType<T>): Promise<T>;
}

function retryAfterMs(headers: Record<string, string>): number | undefined {
	const value = headers['retry-after'] ?? headers['Retry-After'];
	if (value === undefined) {
		return undefined;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1000);
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

/** A fixed message: server-supplied text is never copied into errors, diagnostics or notes. */
function responseMessage(response: HttpTransportResponse): string {
	return `Provider request failed with HTTP ${response.status}.`;
}

function mapStatus(response: HttpTransportResponse): never | undefined {
	if (response.status === 401 || response.status === 403) {
		throw new ProviderAuthError(responseMessage(response), { status: response.status });
	}
	if (response.status === 429) {
		throw new ProviderRateLimitError(responseMessage(response), retryAfterMs(response.headers));
	}
	if (response.status >= 500) {
		throw new ProviderNetworkError(responseMessage(response), {
			status: response.status,
			retryable: response.status === 502 || response.status === 503 || response.status === 504,
		});
	}
	if (response.status >= 400) {
		throw new ProviderHttpError(responseMessage(response), response.status);
	}
	return undefined;
}

function responseJson(response: RequestUrlResponse): unknown {
	try {
		return response.json;
	} catch {
		try {
			return JSON.parse(response.text);
		} catch {
			return undefined;
		}
	}
}

function statusFromError(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
	const status = error.status;
	return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

async function defaultTransport(request: HttpRequest): Promise<HttpTransportResponse> {
	try {
		const response: RequestUrlResponse = await requestUrl({ ...request, throw: false });
		return { status: response.status, headers: response.headers, json: responseJson(response) };
	} catch (error) {
		const status = statusFromError(error);
		if (status !== undefined) mapStatus({ status, headers: {}, json: undefined });
		throw new ProviderNetworkError('Provider request failed.', { cause: error });
	}
}

export interface HttpRetryOptions {
	/** Extra attempts after the first one. Only idempotent GET requests are retried. */
	retries?: number;
	baseDelayMs?: number;
	/** A longer Retry-After is not waited out; the rate-limit error is reported instead. */
	maxDelayMs?: number;
	sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY: Required<Omit<HttpRetryOptions, 'sleep'>> = { retries: 2, baseDelayMs: 1000, maxDelayMs: 30_000 };

function retryDelay(error: unknown, attempt: number, options: Required<Omit<HttpRetryOptions, 'sleep'>>): number | undefined {
	if (error instanceof ProviderRateLimitError) {
		const delay = error.retryAfterMs ?? options.baseDelayMs * 2 ** attempt;
		return delay <= options.maxDelayMs ? delay : undefined;
	}
	if (error instanceof ProviderNetworkError && error.retryable) return Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
	return undefined;
}

export function createHttpClient(transport: HttpTransport = defaultTransport, retry: HttpRetryOptions = {}): HttpClient {
	const retryOptions = { ...DEFAULT_RETRY, ...retry };
	const sleep = retry.sleep ?? ((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));
	const send = async (request: HttpRequest): Promise<HttpTransportResponse> => {
		let response: HttpTransportResponse;
		try {
			response = await transport(request);
		} catch (error) {
			if (error instanceof ProviderAuthError || error instanceof ProviderRateLimitError || error instanceof ProviderNetworkError || error instanceof ProviderHttpError) {
				throw error;
			}
			throw new ProviderNetworkError('Provider request failed.', { cause: error });
		}
		mapStatus(response);
		return response;
	};
	return {
		async request<T>(request: HttpRequest, schema: ZodType<T>): Promise<T> {
			const idempotent = (request.method ?? 'GET').toUpperCase() === 'GET';
			let response: HttpTransportResponse;
			for (let attempt = 0; ; attempt += 1) {
				try {
					response = await send(request);
					break;
				} catch (error) {
					const delay = idempotent && attempt < retryOptions.retries ? retryDelay(error, attempt, retryOptions) : undefined;
					if (delay === undefined) throw error;
					await sleep(delay);
				}
			}
			// Optional fields often arrive as null; schemas describe them as absent.
			const parsed = schema.safeParse(withoutNulls(response.json));
			if (!parsed.success) {
				throw new ProviderSchemaError(`Provider response did not match the expected schema${describeIssues(issuePaths(parsed.error))}.`, { cause: parsed.error });
			}
			return parsed.data;
		},
	};
}
