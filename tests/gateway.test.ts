import { describe, expect, it } from 'vitest';
import { noteFingerprint } from '../src/vault/gateway';
import { FakeVaultGateway } from './fake-gateway';

describe('VaultGateway fake', () => {
	it('lists, reads, creates, processes and checks existence deterministically', async () => {
		const gateway = new FakeVaultGateway({ 'Games/One.md': '# One' });
		expect(await gateway.exists('Games/One.md')).toBe(true);
		expect(await gateway.read('Games/One.md')).toBe('# One');
		expect(await gateway.listMarkdownFiles()).toEqual([{ path: 'Games/One.md', fingerprint: noteFingerprint('# One') }]);

		await gateway.process('Games/One.md', (content) => `${content}\nBody`);
		await gateway.create('Games/Two.md', '# Two');
		expect(await gateway.read('Games/One.md')).toBe('# One\nBody');
		expect(await gateway.read('Games/Two.md')).toBe('# Two');
	});
});
