import { describe, expect, it, vi } from 'vitest';
import type { FileManager, Vault } from 'obsidian';
import { ObsidianVaultGateway, noteFingerprint } from '../src/vault/gateway';
import { FakeVaultGateway } from './fake-gateway';

describe('VaultGateway fake', () => {
	it('enumerates Markdown paths without reading every note', async () => {
		const file = { path: 'Games/One.md', extension: 'md' };
		const vault = { getMarkdownFiles: vi.fn(() => [file]), read: vi.fn(async () => 'Body') };
		const gateway = new ObsidianVaultGateway(vault as unknown as Vault, {} as FileManager);
		expect(await gateway.listMarkdownFiles()).toEqual([{ path: file.path }]);
		expect(vault.read).not.toHaveBeenCalled();
	});

	it('rejects an edit made after preview validation but before the atomic callback', async () => {
		const file = { path: 'Games/One.md', extension: 'md' };
		const original = '---\ntitle: Old\n---\nBody';
		let current = original;
		const vault = {
			getAbstractFileByPath: () => file,
			read: async () => original,
			process: async (_file: unknown, updater: (content: string) => string) => {
				current = '---\ntitle: User edit\n---\nBody';
				current = updater(current);
			},
		};
		const fileManager = { processFrontMatter: async (_file: unknown, updater: (frontmatter: Record<string, unknown>) => void) => {
			const frontmatter = { title: 'User edit' };
			updater(frontmatter);
			current = `---\ntitle: ${frontmatter.title}\n---\nBody`;
		} };
		const gateway = new ObsidianVaultGateway(vault as unknown as Vault, fileManager as unknown as FileManager);
		await expect(gateway.processFrontMatter(file.path, (frontmatter) => { frontmatter.title = 'Sync'; }, noteFingerprint(original))).rejects.toMatchObject({ name: 'VaultConflictError' });
		expect(current).toContain('User edit');
	});

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

	it('atomically updates frontmatter while keeping nested YAML and comments', async () => {
		const file = { path: 'Games/One.md', extension: 'md' };
		const content = '---\ncustom:\n  nested: true\n# comment\n---\nBody';
		const vault = {
			getAbstractFileByPath: vi.fn(() => file),
			getMarkdownFiles: vi.fn(() => [file]),
			read: vi.fn(async () => content),
			create: vi.fn(async () => file),
			process: vi.fn(async (_file: typeof file, updater: (content: string) => string) => {
				const updated = updater(content);
				expect(updated).toContain('nested: true');
				expect(updated).toContain('# comment');
			}),
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

		expect(fileManager.processFrontMatter).not.toHaveBeenCalled();
		expect(vault.process).toHaveBeenCalledWith(file, expect.any(Function));
		expect(vault.read).not.toHaveBeenCalled();
		expect(vault.getAbstractFileByPath).toHaveBeenCalled();
	});

	it('ensures parent folders before creating a nested note and leaves root files untouched', async () => {
		const files = new Map<string, { path: string; extension?: string; children?: unknown[] }>([
			['Root.md', { path: 'Root.md', extension: 'md' }],
		]);
		const vault = {
			getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
			getMarkdownFiles: vi.fn(() => [...files.values()].filter((file) => file.extension === 'md')),
			read: vi.fn(async () => '# root'),
			createFolder: vi.fn(async (path: string) => { files.set(path, { path, children: [] }); }),
			create: vi.fn(async (path: string) => { files.set(path, { path, extension: 'md' }); }),
			process: vi.fn(),
		};
		const gateway = new ObsidianVaultGateway(vault as unknown as Vault, {} as FileManager);

		await gateway.create('Games/PC/Example.md', '# Example');

		expect(vault.createFolder).toHaveBeenNthCalledWith(1, 'Games');
		expect(vault.createFolder).toHaveBeenNthCalledWith(2, 'Games/PC');
		expect(vault.create).toHaveBeenCalledWith('Games/PC/Example.md', '# Example');
		expect(files.get('Root.md')).toEqual({ path: 'Root.md', extension: 'md' });
	});

	it('fails before vault.create when a parent path is an existing file', async () => {
		const parentFile = { path: 'Games', extension: 'md' };
		const vault = {
			getAbstractFileByPath: vi.fn((path: string) => path === 'Games' ? parentFile : null),
			create: vi.fn(async () => undefined),
			createFolder: vi.fn(async () => undefined),
		};
		const gateway = new ObsidianVaultGateway(vault as unknown as Vault, {} as FileManager);

		await expect(gateway.create('Games/Example.md', '# Example')).rejects.toMatchObject({ code: 'TARGET_FOLDER_CONFLICT' });
		expect(vault.create).not.toHaveBeenCalled();
	});
});
