import type { FileManager, TFile, Vault } from 'obsidian';
import { VaultConflictError } from '../network/errors';

function isMarkdownFile(candidate: ReturnType<Vault['getAbstractFileByPath']>): candidate is TFile {
	return candidate !== null && 'extension' in candidate && candidate.extension === 'md';
}

export interface VaultNoteRef {
	path: string;
	fingerprint?: string;
}

export interface VaultGateway {
	listMarkdownFiles(): Promise<VaultNoteRef[]>;
	read(path: string): Promise<string>;
	create(path: string, content: string): Promise<void>;
	process(path: string, updater: (content: string) => string): Promise<void>;
	processFrontMatter(
		path: string,
		updater: (frontmatter: Record<string, unknown>) => void,
		expectedFingerprint?: string,
	): Promise<void>;
	exists(path: string): Promise<boolean>;
}

export function noteFingerprint(content: string): string {
	let hash = 2166136261;
	for (let index = 0; index < content.length; index += 1) {
		hash ^= content.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export class ObsidianVaultGateway implements VaultGateway {
	constructor(private readonly vault: Vault, private readonly fileManager: FileManager) {}

	private file(path: string): TFile {
		const candidate = this.vault.getAbstractFileByPath(path);
		if (!isMarkdownFile(candidate)) throw new Error(`Missing Markdown note: ${path}`);
		return candidate;
	}

	async listMarkdownFiles(): Promise<VaultNoteRef[]> {
		const files = this.vault.getMarkdownFiles();
		const refs: VaultNoteRef[] = [];
		for (const file of files) refs.push({ path: file.path, fingerprint: noteFingerprint(await this.vault.read(file)) });
		return refs;
	}

	async read(path: string): Promise<string> {
		return this.vault.read(this.file(path));
	}

	async create(path: string, content: string): Promise<void> {
		await this.vault.create(path, content);
	}

	async process(path: string, updater: (content: string) => string): Promise<void> {
		await this.vault.process(this.file(path), updater);
	}

	async processFrontMatter(
		path: string,
		updater: (frontmatter: Record<string, unknown>) => void,
		expectedFingerprint?: string,
	): Promise<void> {
		const file = this.file(path);
		if (expectedFingerprint !== undefined) {
			const currentFingerprint = noteFingerprint(await this.vault.read(file));
			if (currentFingerprint !== expectedFingerprint) throw new VaultConflictError(`Stale note preview for ${path}.`);
		}
		await this.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => updater(frontmatter));
	}

	async exists(path: string): Promise<boolean> {
		const candidate = this.vault.getAbstractFileByPath(path);
		return isMarkdownFile(candidate);
	}
}
