import { readdir, readFile, stat } from 'node:fs/promises';

const errors = [];
const versionPattern = /^\d{2}\.(?:[1-9]|1[0-2])\.\d+$/;
const PLUGIN_ID = 'game-sync';
const PLUGIN_NAME = 'Game Sync';

async function readJson(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		errors.push(`${path} is missing or invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
}

async function requireNonEmptyFile(path) {
	try {
		const details = await stat(path);
		if (!details.isFile() || details.size === 0) errors.push(`${path} is missing or empty.`);
	} catch {
		errors.push(`${path} is missing or empty.`);
	}
}

const packageData = await readJson('package.json');
const packageLock = await readJson('package-lock.json');
const manifest = await readJson('manifest.json');
const versions = await readJson('versions.json');

if (packageData !== undefined && manifest !== undefined) {
	if (packageData.version !== manifest.version) errors.push('package.json and manifest.json versions do not match.');
	if (packageData.description !== manifest.description) errors.push('package.json and manifest.json descriptions do not match.');
}

for (const [path, version] of [['package.json', packageData?.version], ['manifest.json', manifest?.version]]) {
	if (typeof version !== 'string' || !versionPattern.test(version)) errors.push(`${path} version must follow YY.M.PATCH.`);
}

const description = manifest?.description;
if (typeof description !== 'string' || description.length === 0) {
	errors.push('manifest.json description must not be empty.');
} else {
	if (description.length > 250) errors.push('manifest.json description must be at most 250 characters.');
	if (!description.endsWith('.')) errors.push('manifest.json description must end with a period.');
}

if (packageLock !== undefined && packageData !== undefined) {
	if (packageLock.version !== packageData.version) errors.push('package-lock.json root version does not match package.json.');
	if (packageLock.packages?.['']?.version !== packageData.version) errors.push('package-lock.json packages[""].version does not match package.json.');
}

if (versions !== undefined && manifest !== undefined) {
	if (versions[manifest.version] !== manifest.minAppVersion) errors.push('versions.json does not map the current version to minAppVersion.');
	for (const [version, minAppVersion] of Object.entries(versions)) {
		if (!versionPattern.test(version)) errors.push(`versions.json contains an invalid version key: ${version}.`);
		if (typeof minAppVersion !== 'string' || minAppVersion.trim().length === 0) errors.push(`versions.json has an empty minAppVersion for ${version}.`);
	}
}

if (manifest !== undefined) {
	if (manifest.minAppVersion !== '1.13.7') errors.push('manifest.json minAppVersion must remain 1.13.7.');
	if (manifest.isDesktopOnly !== true) errors.push('manifest.json must declare isDesktopOnly as true while the export picker uses Node and Electron APIs.');
	if (manifest.id !== PLUGIN_ID) errors.push(`manifest.json must declare the id "${PLUGIN_ID}".`);
	if (manifest.name !== PLUGIN_NAME) errors.push(`manifest.json must declare the name "${PLUGIN_NAME}".`);
	if (typeof manifest.styles !== 'string' || manifest.styles.trim().length === 0) errors.push('manifest.json must declare a non-empty styles asset path.');
}

const requiredFiles = [
	'package.json', 'package-lock.json', 'manifest.json', 'versions.json', 'CHANGELOG.md',
	'README.md', 'README.pl.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'main.js',
	...(typeof manifest?.styles === 'string' && manifest.styles.trim().length > 0 ? [manifest.styles] : []),
];
for (const path of new Set(requiredFiles)) await requireNonEmptyFile(path);

try {
	const rootEntries = await readdir('.');
	for (const entry of rootEntries.filter((value) => value.endsWith('.map'))) errors.push(`${entry} must not be included in production artifacts.`);
} catch (error) {
	errors.push(`Unable to inspect production artifacts: ${error instanceof Error ? error.message : String(error)}`);
}

if (errors.length > 0) {
	for (const error of [...new Set(errors)]) console.error(`- ${error}`);
	process.exitCode = 1;
} else {
	console.log(`Release assets verified for ${manifest.version}.`);
}
