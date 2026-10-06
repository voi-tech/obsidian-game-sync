import { readFile, readdir, writeFile } from 'node:fs/promises';

/** Include the licenses of packages actually bundled, not every development dependency. */
export async function writeBundleNotices(metafile, bundlePath) {
	const roots = new Set();
	for (const input of Object.keys(metafile.inputs)) {
		const match = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//u);
		if (match !== null) roots.add(match[1]);
	}
	const sections = [];
	for (const root of [...roots].sort()) {
		const metadata = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
		const licenses = (await readdir(root)).filter((name) => /^(?:licen[sc]e|copying|notice)(?:\.|$)/iu.test(name)).sort();
		if (licenses.length === 0) throw new Error(`Missing bundled license: ${metadata.name}`);
		const texts = await Promise.all(licenses.map((name) => readFile(`${root}/${name}`, 'utf8')));
		sections.push(`## ${metadata.name} ${metadata.version} (${metadata.license})\n\n${texts.map((text) => text.trim()).join('\n\n')}`);
	}
	const notices = `# Game Sync third-party notices\n\nGenerated from the production bundle inputs. These packages retain their original licenses.\n\n${sections.join('\n\n')}\n`;
	await writeFile('THIRD_PARTY_NOTICES.md', notices);
	const bundle = await readFile(bundlePath, 'utf8');
	await writeFile(bundlePath, `/*!\n${notices.replaceAll('*/', '* /')}*/\n${bundle}`);
}
