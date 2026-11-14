import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ProviderAuthError, ProviderNetworkError, ProviderSchemaError } from '../src/network/errors';
import { createHttpClient, type HttpTransport, type HttpTransportResponse } from '../src/network/http';

const requestUrl = vi.hoisted(() => vi.fn());

vi.mock('obsidian', () => ({ requestUrl }));

const responseSchema = z.object({ ok: z.boolean() });

describe('typed provider HTTP client', () => {
	it('uses Obsidian requestUrl for the default transport', async () => {
		requestUrl.mockResolvedValue({ status: 200, headers: {}, json: { ok: true }, text: '{"ok":true}' });
		const client = createHttpClient();

		await expect(client.request({ url: 'https://example.test' }, responseSchema)).resolves.toEqual({ ok: true });
		expect(requestUrl).toHaveBeenCalledWith({ url: 'https://example.test', throw: false });
	});

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
		const client = createHttpClient(transport, { sleep: async () => undefined });

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
		const client = createHttpClient(transport, { sleep: async () => undefined });

		await expect(client.request({ url: 'https://example.test' }, responseSchema)).rejects.toThrow(
			ProviderNetworkError,
		);
	});

	it('keeps HTTP status when Obsidian cannot parse an HTML error response as JSON', async () => {
		requestUrl.mockResolvedValue({
			status: 403,
			headers: {},
			get json(): never {
				throw new SyntaxError('Unexpected token < in JSON');
			},
			text: '<html><body>Forbidden</body></html>',
		});
		const client = createHttpClient();

		await expect(client.request({ url: 'https://example.test' }, responseSchema)).rejects.toThrow(ProviderAuthError);
	});

	it('maps a requestUrl exception carrying an HTTP status instead of calling it a network failure', async () => {
		requestUrl.mockRejectedValue({ status: 403, message: 'Forbidden' });
		const client = createHttpClient();

		await expect(client.request({ url: 'https://example.test' }, responseSchema)).rejects.toThrow(ProviderAuthError);
	});

	it('retries a GET after a short Retry-After and 503, but not a POST or a long Retry-After', async () => {
		const delays: number[] = [];
		const sleep = async (ms: number): Promise<void> => { delays.push(ms); };
		const responses: HttpTransportResponse[] = [{ status: 429, headers: { 'retry-after': '2' }, json: {} }, { status: 503, headers: {}, json: {} }, { status: 200, headers: {}, json: { ok: true } }];
		const flaky: HttpTransport = async () => responses.shift()!;
		await expect(createHttpClient(flaky, { sleep }).request({ url: 'https://example.test' }, responseSchema)).resolves.toEqual({ ok: true });
		expect(delays).toEqual([2000, 2000]);

		const post = vi.fn<HttpTransport>(async () => ({ status: 503, headers: {}, json: {} }));
		await expect(createHttpClient(post, { sleep }).request({ url: 'https://example.test', method: 'POST' }, responseSchema)).rejects.toBeInstanceOf(ProviderNetworkError);
		expect(post).toHaveBeenCalledOnce();

		const limited = vi.fn<HttpTransport>(async () => ({ status: 429, headers: { 'retry-after': '3600' }, json: {} }));
		await expect(createHttpClient(limited, { sleep }).request({ url: 'https://example.test' }, responseSchema)).rejects.toMatchObject({ name: 'ProviderRateLimitError' });
		expect(limited).toHaveBeenCalledOnce();
	});

	it('never copies server-supplied text into error messages', async () => {
		const transport: HttpTransport = async () => ({ status: 403, headers: {}, json: { message: 'key=secret-api-key rejected' } });
		const error = await createHttpClient(transport).request({ url: 'https://example.test' }, responseSchema).then(() => new Error('expected failure'), (caught: unknown) => caught as Error);

		expect(error).toBeInstanceOf(ProviderAuthError);
		expect(error.message).toBe('Provider request failed with HTTP 403.');
	});

	it('names failing field paths, never values, in schema errors', async () => {
		const transport: HttpTransport = async () => ({ status: 200, headers: {}, json: { ok: 'secret-value' } });
		const error = await createHttpClient(transport).request({ url: 'https://example.test' }, responseSchema).then(() => new Error('expected failure'), (caught: unknown) => caught as Error);

		expect(error).toBeInstanceOf(ProviderSchemaError);
		expect(error.message).toContain('at ok');
		expect(error.message).not.toContain('secret-value');
	});
});
