import type { VaultGateway, VaultNoteRef } from '../src/vault/gateway';
import { parseFrontmatter, serializeNote } from '../src/vault/frontmatter';
import { noteFingerprint } from '../src/vault/gateway';

export class FakeVaultGateway implements VaultGateway {
	private readonly files = new Map<string, string>();
	frontMatterProcessCount = 0;
	beforeProcess?: (path: string) => void;
	failProcessBeforeUpdate?: Error;
	failProcessAfterUpdate?: Error;

	constructor(initial: Record<string, string> = {}) {
		for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
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

	async processFrontMatter(path: string, updater: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		this.frontMatterProcessCount += 1;
		const current = await this.read(path);
		const parsed = parseFrontmatter(current);
		updater(parsed.frontmatter);
		this.files.set(path, serializeNote(parsed.frontmatter, parsed.body));
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	set(path: string, content: string): void {
		this.files.set(path, content);
	}
}
