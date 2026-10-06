import esbuild from 'esbuild';
import builtins from 'builtin-modules';
import { writeBundleNotices } from './scripts/bundle-notices.mjs';

const watch = process.argv.includes('--watch');

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	metafile: true,
	plugins: [{
		name: 'bundled-license-notices',
		setup(build) {
			build.onEnd(async (result) => {
				if (result.errors.length === 0) await writeBundleNotices(result.metafile, 'main.js');
			});
		},
	}],
	external: ['obsidian', 'electron', ...builtins],
	format: 'cjs',
	target: 'es2022',
	logLevel: 'info',
	sourcemap: watch ? 'inline' : false,
	treeShaking: true,
	minify: !watch,
	outfile: 'main.js',
	define: {
		'process.env.NODE_ENV': watch ? '"development"' : '"production"',
		'window.__GAME_SYNC_DEV__': watch ? 'true' : 'false',
	},
});

if (watch) {
	await context.watch();
} else {
	await context.rebuild();
	await context.dispose();
}
