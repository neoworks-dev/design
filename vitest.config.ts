import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Compiles .svelte / .svelte.ts so rune registries and components run under test. Not the
// SvelteKit plugin: tests exercise kernel, registries and pure libraries, not routes.
//
// Svelte must resolve to its client runtime (the server build turns effects and mount into
// no-ops), hence the `browser` condition for both the client and the ssr-transformed graph that
// vitest uses. happy-dom as the global environment makes vitest transform for the client.
export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: {
		dedupe: ['svelte'],
		conditions: ['browser']
	},
	ssr: {
		resolve: { conditions: ['browser'], externalConditions: ['browser'] }
	},
	test: {
		include: [
			'src/**/*.test.ts',
			'electron/**/*.test.ts',
			'scripts/**/*.test.ts',
			'tests/**/*.test.ts'
		],
		environment: 'happy-dom',
		server: { deps: { inline: [/svelte/, /@neoworks/] } }
	}
});
