import type { FileManager, TFile, TFolder, Vault } from 'obsidian';
import { VaultConflictError } from '../network/errors';

function isMarkdownFile(candidate: ReturnType<Vault['getAbstractFileByPath']>): candidate is TFile {
	return candidate !== null && 'extension' in candidate && candidate.extension === 'md';
}

function isFolder(candidate: ReturnType<Vault['getAbstractFileByPath']>): candidate is TFolder {
	return candidate !== null && 'children' in candidate;
}

export type VaultFolderErrorCode = 'TARGET_FOLDER_CONFLICT' | 'TARGET_FOLDER_CREATE_FAILED';

export class VaultFolderError extends Error {
	constructor(readonly code: VaultFolderErrorCode, message: string) {
		super(message);
		this.name = 'VaultFolderError';
	}
}

export interface VaultNoteRef {
	path: string;
	fingerprint?: string;
}

export interface VaultGateway {
	listMarkdownFiles(): Promise<VaultNoteRef[]>;
	read(path: string): Promise<string>;
	create(path: string, content: string): Promise<void>;
	ensureFolder(path: string): Promise<void>;
	remove(path: string, expectedFingerprint?: string): Promise<void>;
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

	async ensureFolder(path: string): Promise<void> {
		const parts = path.split('/').filter((part) => part.length > 0);
		if (parts.length === 0) return;
		const paths = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
		for (const candidatePath of paths) {
			const candidate = this.vault.getAbstractFileByPath(candidatePath);
			if (candidate !== null && !isFolder(candidate)) throw new VaultFolderError('TARGET_FOLDER_CONFLICT', `Vault path is a file, not a folder: ${candidatePath}.`);
		}
		for (const candidatePath of paths) {
			if (this.vault.getAbstractFileByPath(candidatePath) !== null) continue;
			try {
				await this.vault.createFolder(candidatePath);
			} catch {
				const candidate = this.vault.getAbstractFileByPath(candidatePath);
				if (candidate !== null && isFolder(candidate)) continue;
				if (candidate !== null) throw new VaultFolderError('TARGET_FOLDER_CONFLICT', `Vault path is a file, not a folder: ${candidatePath}.`);
				throw new VaultFolderError('TARGET_FOLDER_CREATE_FAILED', `Unable to create vault folder: ${candidatePath}.`);
			}
		}
	}

	async remove(path: string, expectedFingerprint?: string): Promise<void> {
		const file = this.file(path);
		if (expectedFingerprint !== undefined && noteFingerprint(await this.vault.read(file)) !== expectedFingerprint) {
			throw new VaultConflictError(`Refusing to remove a changed note ${path}.`);
		}
		await this.fileManager.trashFile(file);
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
