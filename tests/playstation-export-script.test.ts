/** @vitest-environment jsdom */
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { playStationExportScript } from '../src/purchases/playstation-export-script';
import { parsePurchaseCsv } from '../src/purchases/playstation-purchases';

describe('PlayStation console export script', () => {
	it('reuses the page request, pages through history and copies a CSV without payment details', async () => {
		const pages = [
			{ transactions: [{ transactionDetail: { transactionDate: '2024-06-09T10:00:00.000Z', transactionId: 'T2', ipAddress: '1.2.3.4' }, currencyCode: 'PLN', additionalInfo: { chargePayments: [{ paymentMethod: 'VISA', billingInfo: '****1234' }], orderItems: [{ transactionType: 'PRODUCT_PURCHASE', productName: 'Diablo® IV, Deluxe', skuId: 'SKU-D4', totalPrice: { value: 24900 } }] } }], hasMore: true, nextEndDate: '2024-01-01T00:00:00.000+0000' },
			{ transactions: [{ transactionDetail: { transactionDate: '2023-04-02T10:00:00.000Z', transactionId: 'T1' }, currencyCode: 'PLN', additionalInfo: { refundItems: [{ transactionType: 'REFUND_PAYMENT_CHARGE', productName: 'Returnal', total: { value: 29900 } }] } }], hasMore: false },
		];
		const requested: string[] = [];
		const fetchMock = vi.fn((input: string) => {
			requested.push(input);
			if (!input.includes('startDate=2010')) return Promise.resolve(new Response('{}'));
			return Promise.resolve(new Response(JSON.stringify(pages.shift())));
		});
		vi.stubGlobal('fetch', fetchMock);
		let copied = '';
		vi.stubGlobal('copy', (text: string) => { copied = text; });
		vi.spyOn(console, 'log').mockImplementation(() => undefined);

		// Indirect eval runs the pasted script exactly as a browser console would.
		const done = vm.runInThisContext(playStationExportScript('en')) as Promise<void>;
		await window.fetch('https://web.np.playstation.com/api/transactions/v2/history?page-own-call=1&limit=20', { headers: { Authorization: 'Bearer page-token' } });
		await done;

		expect(requested.filter((url) => url.includes('startDate=2010'))).toHaveLength(2);
		expect(copied.split('\n')[0]).toBe('date,transaction_id,type,product_name,sku_id,price,currency');
		expect(copied).not.toMatch(/VISA|1234|1\.2\.3\.4/u);
		const rows = parsePurchaseCsv(copied);
		expect(rows).toEqual([
			expect.objectContaining({ date: '2024-06-09', productName: 'Diablo® IV, Deluxe', skuId: 'SKU-D4', price: 249, currency: 'PLN' }),
			expect.objectContaining({ date: '2023-04-02', productName: 'Returnal', type: 'REFUND_PAYMENT_CHARGE', price: -299 }),
		]);
		vi.unstubAllGlobals();
	});

	it('does not copy an incomplete history when Sony fails part-way, and speaks the user language', async () => {
		const pages: Array<Response> = [
			new Response(JSON.stringify({ transactions: [{ transactionDetail: { transactionDate: '2024-06-09T10:00:00.000Z', transactionId: 'T2' }, currencyCode: 'PLN', additionalInfo: { orderItems: [{ transactionType: 'PRODUCT_PURCHASE', productName: 'Returnal', skuId: 'S', totalPrice: { value: 29900 } }] } }], hasMore: true, nextEndDate: '2024-01-01T00:00:00.000+0000' })),
			new Response('{}', { status: 503 }),
		];
		vi.stubGlobal('fetch', vi.fn((input: string) => Promise.resolve(input.includes('startDate=2010') ? pages.shift()! : new Response('{}'))));
		const copy = vi.fn();
		vi.stubGlobal('copy', copy);
		const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

		const done = vm.runInThisContext(playStationExportScript('pl')) as Promise<void>;
		await window.fetch('https://web.np.playstation.com/api/transactions/v2/history?page-own-call=1&limit=20', { headers: { Authorization: 'Bearer page-token' } });
		await done;

		expect(copy).not.toHaveBeenCalled();
		expect((window as unknown as { __gameSyncPurchasesCsv?: string }).__gameSyncPurchasesCsv).toContain('Returnal');
		const messages = log.mock.calls.map((call) => String(call[0])).join('\n');
		expect(messages).toContain('503');
		expect(messages).toContain('Nie kopiuję niepełnej historii');
		vi.unstubAllGlobals();
		log.mockRestore();
	});
});
