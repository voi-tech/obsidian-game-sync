import { describe, expect, it, vi } from 'vitest';
import type { FileManager, Vault } from 'obsidian';
import { ObsidianVaultGateway, noteFingerprint } from '../src/vault/gateway';
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

	it('delegates Obsidian operations without parsing or serializing note content', async () => {
		const file = { path: 'Games/One.md', extension: 'md' };
		const content = '---\ncustom:\n  nested: true\n# comment\n---\nBody';
		const vault = {
			getAbstractFileByPath: vi.fn(() => file),
			getMarkdownFiles: vi.fn(() => [file]),
			read: vi.fn(async () => content),
			create: vi.fn(async () => file),
			process: vi.fn(async (_file: typeof file, updater: (content: string) => string) => { updater('Body'); }),
		};
		const fileManager = {
			processFrontMatter: vi.fn(async (_file: typeof file, updater: (frontmatter: Record<string, unknown>) => void) => {
				const frontmatter: Record<string, unknown> = { custom: { nested: true } };
				updater(frontmatter);
			}),
		};
		const gateway = new ObsidianVaultGateway(vault as unknown as Vault, fileManager as unknown as FileManager);

		await gateway.processFrontMatter('Games/One.md', (frontmatter) => { frontmatter['game-sync-id'] = 'game-sync:one'; }, noteFingerprint(content));
		await gateway.process('Games/One.md', (content) => `${content}\nManaged block`);

		expect(fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
		expect(vault.process).toHaveBeenCalledWith(file, expect.any(Function));
		expect(vault.read).toHaveBeenCalledWith(file);
		expect(vault.getAbstractFileByPath).toHaveBeenCalled();
	});
});
