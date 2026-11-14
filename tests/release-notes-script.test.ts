import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../scripts/release-notes.mjs', import.meta.url));

const changelog = `# Changelog

## Unreleased

- Not released yet.

## 26.11.2 (BRAT prerelease)

- Second fix.
- Third fix.

## 26.11.1 (BRAT prerelease)

- First fix.
`;

async function run(version: string, content = changelog): Promise<{ code: number; stdout: string; stderr: string }> {
	const directory = await mkdtemp(`${tmpdir()}/game-sync-release-notes-`);
	try {
		await writeFile(`${directory}/CHANGELOG.md`, content, 'utf8');
		try {
			const result = await execFileAsync(process.execPath, [scriptPath, version, `${directory}/CHANGELOG.md`], { encoding: 'utf8' });
			return { code: 0, stdout: result.stdout, stderr: result.stderr };
		} catch (error) {
			const result = error as { code?: number; stdout?: string; stderr?: string };
			return { code: result.code ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

describe('release-notes', () => {
	test('prints only the section of the requested version', async () => {
		const result = await run('26.11.2');

		expect(result.code).toBe(0);
		expect(result.stdout).toBe('- Second fix.\n- Third fix.\n');
	});

	test('does not match a version that only shares a prefix', async () => {
		const result = await run('26.11.1');

		expect(result.stdout).toBe('- First fix.\n');
		expect((await run('26.11')).code).not.toBe(0);
	});

	test('fails when the version has no section or an empty one', async () => {
		expect((await run('26.12.0')).stderr).toContain('CHANGELOG.md has no entries for 26.12.0');
		expect((await run('26.11.2', '# Changelog\n\n## 26.11.2\n\n## 26.11.1\n\n- x\n')).code).not.toBe(0);
	});
});
