import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: new URL('./tests/obsidian-runtime.ts', import.meta.url).pathname,
		},
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
	},
});
