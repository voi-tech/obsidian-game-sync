import { access, readFile, stat } from 'node:fs/promises';

const packageData = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
const errors = [];

const PLUGIN_ID = 'game-sync';
const PLUGIN_NAME = 'Game Sync';
const versionPattern = /^\d{2}\.(?:[1-9]|1[0-2])\.\d+$/;

if (packageData.version !== manifest.version) {
	errors.push('package.json and manifest.json versions do not match.');
}

if (!versionPattern.test(packageData.version) || !versionPattern.test(manifest.version)) {
	errors.push('The version must follow YY.M.PATCH and remain valid SemVer.');
}

if (versions[manifest.version] !== manifest.minAppVersion) {
	errors.push('versions.json does not map the current version to minAppVersion.');
}

if (manifest.isDesktopOnly !== false) {
	errors.push('manifest.json must declare isDesktopOnly as false; the plugin supports mobile.');
}

if (manifest.id !== PLUGIN_ID) {
	errors.push(`manifest.json must declare the id "${PLUGIN_ID}".`);
}

if (manifest.name !== PLUGIN_NAME) {
	errors.push(`manifest.json must declare the name "${PLUGIN_NAME}".`);
}

if (packageData.description !== manifest.description) {
	errors.push('package.json and manifest.json descriptions do not match.');
}

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
	try {
		await access(file);
		if ((await stat(file)).size === 0) {
			errors.push(`${file} is empty.`);
		}
	} catch {
		errors.push(`${file} is missing.`);
	}
}

try {
	await access('main.js.map');
	errors.push('main.js.map must not be included in production artifacts.');
} catch {
	// Expected: production builds do not include source maps.
}

if (errors.length > 0) {
	for (const error of errors) {
		console.error(`- ${error}`);
	}
	process.exitCode = 1;
} else {
	console.log(`Release assets verified for ${manifest.version}.`);
}
