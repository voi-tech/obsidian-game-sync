import esbuild from 'esbuild';
import builtins from 'builtin-modules';

const watch = process.argv.includes('--watch');

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: ['obsidian', 'electron', ...builtins],
	format: 'cjs',
	target: 'es2022',
	logLevel: 'info',
	sourcemap: watch ? 'inline' : false,
	treeShaking: true,
	minify: !watch,
	outfile: 'main.js',
	define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
});

if (watch) {
	await context.watch();
} else {
	await context.rebuild();
	await context.dispose();
}
