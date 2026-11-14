import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';

const bundlePath = process.argv[2] ?? 'main.js';
const nodeBuiltins = new Set(
	builtinModules.map((name) => (name.startsWith('node:') ? name.slice(5) : name)),
);
const nodeBuiltinRoots = new Set([...nodeBuiltins].map((name) => name.split('/')[0]));
const dependencyPattern = /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)|\b(?:from|import)\s+["']([^"']+)["']/g;
const errors = [];

let bundle;
try {
	bundle = await readFile(bundlePath, 'utf8');
} catch (error) {
	console.error(`Mobile bundle check failed: unable to read ${bundlePath}.`);
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}

if (bundle !== undefined) {
	if (/\bBuffer\b/.test(bundle)) {
		errors.push('Buffer is not available on mobile.');
	}

	for (const match of bundle.matchAll(dependencyPattern)) {
		const dependency = match[1] ?? match[2];
		const normalizedDependency = dependency.startsWith('node:')
			? dependency.slice(5)
			: dependency;

		if (normalizedDependency === 'electron' || normalizedDependency.startsWith('electron/')) {
			errors.push(`Forbidden dependency: ${dependency}.`);
		} else if (
			nodeBuiltins.has(normalizedDependency) ||
			[...nodeBuiltinRoots].some((root) => normalizedDependency.startsWith(`${root}/`))
		) {
			errors.push(`Node built-in dependency: ${dependency}.`);
		}
	}
}

if (errors.length > 0) {
	console.error(`Mobile bundle check failed for ${bundlePath}:`);
	for (const error of [...new Set(errors)]) {
		console.error(`- ${error}`);
	}
	process.exitCode = 1;
} else if (bundle !== undefined) {
	console.log(`Mobile bundle verified: ${bundlePath}.`);
}
