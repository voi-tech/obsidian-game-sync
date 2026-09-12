import { readFile, writeFile } from 'node:fs/promises';

const version = process.env.npm_package_version;

if (!version || !/^\d{2}\.(?:[1-9]|1[0-2])\.\d+$/.test(version)) {
	throw new Error('The package version must follow YY.M.PATCH.');
}

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));

manifest.version = version;
versions[version] = manifest.minAppVersion;

await writeFile('manifest.json', `${JSON.stringify(manifest, null, '\t')}\n`);
await writeFile('versions.json', `${JSON.stringify(versions, null, '\t')}\n`);
