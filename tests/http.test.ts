import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProviderAuthError, ProviderNetworkError, ProviderSchemaError } from '../src/network/errors';
import { createHttpClient, type HttpTransport } from '../src/network/http';

const responseSchema = z.object({ ok: z.boolean() });

describe('typed provider HTTP client', () => {
	it('validates a successful response against the requested schema', async () => {
		const transport: HttpTransport = async () => ({
			status: 200,
			headers: {},
			json: { ok: true },
		});
		const client = createHttpClient(transport);

		expect(await client.request({ url: 'https://example.test' }, responseSchema)).toEqual({ ok: true });
	});

	it.each([
		[401, ProviderAuthError],
		[403, ProviderAuthError],
		[500, ProviderNetworkError],
	])('maps status %s to a typed provider error', async (status, errorType) => {
		const transport: HttpTransport = async () => ({ status, headers: {}, json: {} });
		const client = createHttpClient(transport);

		await expect(client.request({ url: 'https://example.test' }, responseSchema)).rejects.toThrow(errorType);
	});

	it('maps 429 and Retry-After to ProviderRateLimitError', async () => {
		const transport: HttpTransport = async () => ({
			status: 429,
			headers: { 'retry-after': '3' },
			json: {},
		});
		const client = createHttpClient(transport);

		await expect(client.request({ url: 'https://example.test' }, responseSchema)).rejects.toMatchObject({
			name: 'ProviderRateLimitError',
			retryAfterMs: 3000,
		});
	});

	it('maps schema mismatches to ProviderSchemaError', async () => {
		const transport: HttpTransport = async () => ({
			status: 200,
			headers: {},
			json: { ok: 'yes' },
		});
		const client = createHttpClient(transport);

		await expect(client.request({ url: 'https://example.test' }, responseSchema)).rejects.toThrow(ProviderSchemaError);
	});

	it('maps transport failures to ProviderNetworkError', async () => {
		const transport: HttpTransport = async () => {
			throw new Error('network timeout');
		};
		const client = createHttpClient(transport);

		await expect(client.request({ url: 'https://example.test' }, responseSchema)).rejects.toThrow(
			ProviderNetworkError,
		);
	});
});
