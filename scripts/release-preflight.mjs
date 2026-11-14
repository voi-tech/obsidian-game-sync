import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Repeats the release CI on a clean copy of HEAD before the tag is pushed:
// clean tree, unused tag, CHANGELOG section, `npm ci` with the committed lock file,
// `npm run check` and committed release assets equal to the build.
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });
const step = (message) => console.log(`- ${message}`);

function fail(message) {
	console.error(`Release preflight failed: ${message}`);
	process.exit(1);
}

if (run('git', ['status', '--porcelain', '--untracked-files=no']).trim() !== '') fail('the working tree has uncommitted changes.');
step('working tree is clean');

const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
if (run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${version}`]).trim() !== '') fail(`tag ${version} already exists on origin.`);
step(`tag ${version} is not on origin`);

run(process.execPath, ['scripts/release-notes.mjs', version]);
step(`CHANGELOG.md has a section for ${version}`);

const directory = await mkdtemp(join(tmpdir(), 'game-sync-preflight-'));
try {
	execFileSync('sh', ['-c', `git archive HEAD | tar -x -C "${directory}"`], { stdio: 'inherit' });
	const assets = ['main.js', 'styles.css', 'manifest.json'];
	const committed = await Promise.all(assets.map((asset) => readFile(join(directory, asset))));
	execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: directory, stdio: 'inherit' });
	step('npm ci accepts the committed package-lock.json');
	execFileSync('npm', ['run', 'check'], { cwd: directory, stdio: 'inherit' });
	step('npm run check passes on a clean copy');
	for (const [index, asset] of assets.entries()) {
		if (!committed[index].equals(await readFile(join(directory, asset)))) fail(`${asset} differs from the build; run npm run build and commit it.`);
	}
	step('committed release assets match the build');
} finally {
	await rm(directory, { recursive: true, force: true });
}
console.log(`Release preflight passed for ${version}.`);
