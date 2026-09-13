import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../scripts/check-mobile-bundle.mjs', import.meta.url));

async function runScan(bundle: string): Promise<{ code: number | null; output: string }> {
	const directory = await mkdtemp(`${tmpdir()}/game-sync-mobile-bundle-`);
	const bundlePath = `${directory}/main.js`;

	try {
		await writeFile(bundlePath, bundle, 'utf8');
		try {
			const result = await execFileAsync(process.execPath, [scriptPath, bundlePath], {
				encoding: 'utf8',
			});
			return { code: 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
		} catch (error) {
			const result = error as { code?: number; stdout?: string; stderr?: string };
			return {
				code: typeof result.code === 'number' ? result.code : null,
				output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
			};
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

describe('check-mobile-bundle', () => {
	test.each([
		['electron package', 'require("electron");'],
		['electron subpath', 'require("electron/main");'],
		['Node builtin', 'require("fs");'],
		['Node builtin subpath', 'import "node:fs/promises";'],
		['bare builtin subpath', 'require("fs/promises");'],
	])('rejects %s in the production bundle', async (_name, bundle) => {
		const result = await runScan(bundle);

		expect(result.code).not.toBe(0);
		expect(result.output).toContain('Mobile bundle check failed');
	});

	test('allows the Obsidian external', async () => {
		const result = await runScan('require("obsidian"); "game-sync-vault-runtime" "template-context" "filename" "property-mapping" "achievement-renderer" "managed-block" "gateway" "note-index" "writer" "cache" "executor" "planner" "sync-service" "history";');

		expect(result.code).toBe(0);
		expect(result.output).toContain('Mobile bundle verified');
	});

	test('rejects a bundle that omits the retained Game Sync runtime graph', async () => {
		const result = await runScan('require("obsidian");');

		expect(result.code).not.toBe(0);
		expect(result.output).toContain('Missing retained Game Sync runtime marker');
	});
});
