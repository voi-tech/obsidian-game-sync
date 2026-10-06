import { VaultFolderError, type VaultGateway, type VaultNoteRef } from '../src/vault/gateway';
import { updateFrontmatter } from '../src/vault/frontmatter';
import { noteFingerprint } from '../src/vault/gateway';
import { VaultConflictError } from '../src/network/errors';

export class FakeVaultGateway implements VaultGateway {
	private readonly files = new Map<string, string>();
	private readonly folders = new Set<string>();
	frontMatterProcessCount = 0;
	beforeProcess?: (path: string) => void;
	beforeProcessFrontMatter?: (path: string) => void;
	failProcessBeforeUpdate?: Error;
	failProcessAfterUpdate?: Error;
	failEnsureFolder?: Error;

	constructor(initial: Record<string, string> = {}) {
		for (const [path, content] of Object.entries(initial)) {
			this.files.set(path, content);
			this.addParentFolders(path);
		}
	}

	async listMarkdownFiles(): Promise<VaultNoteRef[]> {
		return [...this.files.entries()]
			.filter(([path]) => path.endsWith('.md'))
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([path, content]) => ({ path, fingerprint: noteFingerprint(content) }));
	}

	async read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`Missing vault note: ${path}`);
		return content;
	}

	async create(path: string, content: string): Promise<void> {
		if (this.files.has(path)) throw new Error(`Vault note already exists: ${path}`);
		this.files.set(path, content);
	}

	async ensureFolder(path: string): Promise<void> {
		if (this.failEnsureFolder !== undefined) {
			const error = this.failEnsureFolder;
			this.failEnsureFolder = undefined;
			throw error;
		}
		if (path.length === 0) return;
		const parts = path.split('/');
		for (let index = 1; index <= parts.length; index += 1) {
			const candidate = parts.slice(0, index).join('/');
			if (this.files.has(candidate)) throw new VaultFolderError('TARGET_FOLDER_CONFLICT', `Vault path is a file: ${candidate}`);
		}
		for (let index = 1; index <= parts.length; index += 1) this.folders.add(parts.slice(0, index).join('/'));
	}

	async remove(path: string, expectedFingerprint?: string): Promise<void> {
		const content = await this.read(path);
		if (expectedFingerprint !== undefined && noteFingerprint(content) !== expectedFingerprint) throw new VaultConflictError(`Refusing to remove a changed note ${path}.`);
		this.files.delete(path);
	}

	async process(path: string, updater: (content: string) => string): Promise<void> {
		this.beforeProcess?.(path);
		const current = await this.read(path);
		if (this.failProcessBeforeUpdate) {
			const error = this.failProcessBeforeUpdate;
			this.failProcessBeforeUpdate = undefined;
			throw error;
		}
		this.files.set(path, updater(current));
		if (this.failProcessAfterUpdate) {
			const error = this.failProcessAfterUpdate;
			this.failProcessAfterUpdate = undefined;
			throw error;
		}
	}

	async processFrontMatter(
		path: string,
		updater: (frontmatter: Record<string, unknown>) => void,
		expectedFingerprint?: string,
	): Promise<void> {
		this.frontMatterProcessCount += 1;
		this.beforeProcessFrontMatter?.(path);
		const current = await this.read(path);
		if (expectedFingerprint !== undefined && noteFingerprint(current) !== expectedFingerprint) {
			throw new VaultConflictError(`Stale note preview for ${path}.`);
		}
		this.files.set(path, updateFrontmatter(current, updater));
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	set(path: string, content: string): void {
		this.files.set(path, content);
		this.addParentFolders(path);
	}

	hasFolder(path: string): boolean { return this.folders.has(path); }

	private addParentFolders(path: string): void {
		const parts = path.split('/');
		for (let index = 1; index < parts.length; index += 1) this.folders.add(parts.slice(0, index).join('/'));
	}
}
