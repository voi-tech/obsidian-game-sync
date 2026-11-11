import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { applyPurchase, effectivePurchases, parsePurchaseCsv, planPurchaseImport, productKey } from '../src/purchases/playstation-purchases';
import { PLAYSTATION_EXPORT_SCRIPT } from '../src/purchases/playstation-export-script';
import type { IndexedNote } from '../src/vault/note-index';

function note(path: string, properties: Record<string, unknown> = {}, title?: string): IndexedNote {
	return { path, properties, ...(title === undefined ? {} : { title }), normalizedFilename: path.toLowerCase() };
}

const SCRIPT_CSV = [
	'date,transaction_id,type,product_name,sku_id,price,currency',
	'2023-04-02T10:00:00.000Z,T1,PRODUCT_PURCHASE,Horizon Zero Dawn™ Complete Edition,EP9000-CUSA10237_00-HZDCE,79.00,PLN',
	'2022-11-20T10:00:00.000Z,T2,PRODUCT_PURCHASE,Horizon Zero Dawn™,EP9000-CUSA01967_00-HZD,49.00,PLN',
	'2024-06-07T10:00:00.000Z,T3,PRODUCT_PURCHASE,Diablo® IV,EP0002-PPSA02442_00-D4,"299,00",PLN',
	'2024-06-08T10:00:00.000Z,T4,REFUND_PAYMENT_CHARGE,Diablo® IV,,-299.00,PLN',
	'2024-06-09T10:00:00.000Z,T5,PRODUCT_PURCHASE,Diablo® IV PS4 & PS5,EP0002-PPSA02442_00-D4,249.00,PLN',
	'2024-07-01T10:00:00.000Z,T6,DEPOSIT_CHARGE,PlayStation Store wallet top-up,,100.00,PLN',
	'2024-08-01T10:00:00.000Z,T7,PRODUCT_PURCHASE,Some Soundtrack,,9.99,PLN',
].join('\n');

describe('PlayStation purchase import', () => {
	it('reads the console-script CSV and the older extension column names', () => {
		const rows = parsePurchaseCsv(SCRIPT_CSV);
		expect(rows).toHaveLength(7);
		expect(rows[2]).toMatchObject({ date: '2024-06-07', productName: 'Diablo® IV', price: 299, currency: 'PLN' });
		const legacy = parsePurchaseCsv('Date,Time,Transaction ID,Type,Product sku ID,Product Name,Total Price,Currency Code\n2021-01-02,10:00:00,T,PRODUCT_PURCHASE,SKU,Returnal,299.00,PLN\n');
		expect(legacy[0]).toMatchObject({ date: '2021-01-02', productName: 'Returnal', skuId: 'SKU', price: 299, currency: 'PLN' });
		expect(() => parsePurchaseCsv('foo,bar\n1,2\n')).toThrow();
	});

	it('strips trademark marks and platform labels from store product names', () => {
		expect(productKey('Diablo® IV PS4 & PS5')).toBe(productKey('Diablo IV'));
		expect(productKey('Returnal™ (PS5)')).toBe('returnal');
		expect(productKey('Horizon Zero Dawn™ Complete Edition')).not.toBe(productKey('Horizon Zero Dawn'));
	});

	it('cancels refunded purchases and ignores wallet top-ups', () => {
		const { purchases, refunded } = effectivePurchases(parsePurchaseCsv(SCRIPT_CSV));
		expect(refunded).toBe(1);
		expect(purchases.map((purchase) => purchase.productName)).not.toContain('PlayStation Store wallet top-up');
		expect(purchases.filter((purchase) => productKey(purchase.productName) === productKey('Diablo IV'))).toHaveLength(1);
	});

	it('matches only notes in the games folder, uses the earliest purchase, and never guesses on ambiguity', () => {
		const notes = [
			note('Games/Diablo® IV.md', {}, 'Diablo® IV'),
			note('Games/Horizon Zero Dawn™.md', { 'purchase-date': '2022-11-20', 'purchase-price': 49, 'purchase-currency': 'PLN' }, 'Horizon Zero Dawn™'),
			note('resources/Some Soundtrack.md', {}, 'Some Soundtrack'),
		];
		const plan = planPurchaseImport(parsePurchaseCsv(SCRIPT_CSV), notes, { notesFolder: 'Games' });
		const diablo = plan.matches.find((match) => match.path === 'Games/Diablo® IV.md');
		expect(diablo).toMatchObject({ date: '2024-06-09', price: 249, currency: 'PLN', changed: true });
		expect(plan.matches.find((match) => match.path === 'Games/Horizon Zero Dawn™.md')).toMatchObject({ changed: false });
		expect(plan.unmatched).toEqual(['Horizon Zero Dawn™ Complete Edition', 'Some Soundtrack']);

		const twoNotes = [note('Games/Returnal.md', {}, 'Returnal'), note('Games/Returnal (2).md', {}, 'Returnal')];
		const ambiguous = planPurchaseImport(parsePurchaseCsv('date,product_name,price,currency\n2021-01-01,Returnal,299,PLN\n'), twoNotes, { notesFolder: 'Games' });
		expect(ambiguous.matches).toHaveLength(0);
		expect(ambiguous.ambiguous).toEqual(['Returnal']);
	});

	it('writes to the mapped property names and skips disabled ones', () => {
		const frontmatter: Record<string, unknown> = { status: 'playing' };
		applyPurchase(frontmatter, { path: 'x', title: 'x', date: '2024-06-09', price: 249, currency: 'PLN', productNames: [], changed: true }, { purchaseDate: 'kupiono', purchaseCurrency: null });
		expect(frontmatter).toEqual({ status: 'playing', kupiono: '2024-06-09', 'purchase-price': 249 });
	});

	it('ships a console script that never exports payment or address details', () => {
		expect(PLAYSTATION_EXPORT_SCRIPT).toContain('date,transaction_id,type,product_name,sku_id,price,currency');
		expect(PLAYSTATION_EXPORT_SCRIPT).not.toMatch(/ipAddress|billingInfo|paymentMethod/u);
		// Syntax check without executing: compile as a module script.
		expect(() => new vm.Script(PLAYSTATION_EXPORT_SCRIPT)).not.toThrow();
	});
});
