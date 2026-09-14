import { requestUrl, type RequestUrlResponse } from 'obsidian';
import type { ZodType } from 'zod';
import {
	ProviderAuthError,
	ProviderHttpError,
	ProviderNetworkError,
	ProviderRateLimitError,
	ProviderSchemaError,
} from './errors';

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

function responseMessage(response: HttpTransportResponse): string {
	if (typeof response.json === 'object' && response.json !== null && 'message' in response.json) {
		const message = response.json.message;
		return typeof message === 'string' ? message : `Provider request failed with HTTP ${response.status}.`;
	}
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

export function createHttpClient(transport: HttpTransport = defaultTransport): HttpClient {
	return {
		async request<T>(request: HttpRequest, schema: ZodType<T>): Promise<T> {
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
			const parsed = schema.safeParse(response.json);
			if (!parsed.success) {
				throw new ProviderSchemaError('Provider response did not match the expected schema.', { cause: parsed.error });
			}
			return parsed.data;
		},
	};
}
