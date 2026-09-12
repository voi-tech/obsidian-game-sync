import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'coverage',
		'dist',
		'esbuild.config.mjs',
		'scripts/*.mjs',
		'main.js',
		'package.json',
		'package-lock.json',
		'versions.json',
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mjs', 'manifest.json', 'vitest.config.ts'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['tests/**/*.ts', 'vitest.config.ts'],
		languageOptions: {
			globals: { ...globals.node },
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/no-tfile-tfolder-cast': 'off',
			'obsidianmd/prefer-create-el': 'off',
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
);
