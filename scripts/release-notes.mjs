import { readFile } from 'node:fs/promises';

// Prints the CHANGELOG.md section of one version, for the GitHub release notes.
// Usage: node scripts/release-notes.mjs <version> [CHANGELOG.md]
const [version, changelogPath = 'CHANGELOG.md'] = process.argv.slice(2);

function fail(message) {
	console.error(message);
	process.exit(1);
}

if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) fail('Usage: node scripts/release-notes.mjs <version> [CHANGELOG.md]');

const lines = (await readFile(changelogPath, 'utf8')).split(/\r?\n/);
const heading = (line) => line.startsWith('## ');
const start = lines.findIndex((line) => heading(line) && line.slice(3).split(/\s/)[0] === version);
if (start === -1) fail(`CHANGELOG.md has no entries for ${version}.`);
const next = lines.findIndex((line, index) => index > start && heading(line));
const body = lines.slice(start + 1, next === -1 ? undefined : next).join('\n').trim();
if (body.length === 0) fail(`CHANGELOG.md has no entries for ${version}.`);
process.stdout.write(`${body}\n`);
