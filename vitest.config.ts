import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Compiles .svelte / .svelte.ts so rune registries run under test. Not the SvelteKit plugin:
// tests exercise kernel, registries and pure libraries, not routes.
export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: {
		dedupe: ['svelte'],
		conditions: ['browser']
	},
	test: {
		include: [
			'src/**/*.test.ts',
			'electron/**/*.test.ts',
			'scripts/**/*.test.ts',
			'tests/**/*.test.ts'
		],
		environment: 'node'
	}
});
