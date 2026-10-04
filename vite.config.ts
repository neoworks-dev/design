import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Force runes everywhere, including the linked @neoworks-dev/ui sources.
function runesFor({ filename }: { filename: string }): boolean | undefined {
	if (filename.includes('@neoworks-dev') || filename.includes('packages/ui/src')) return true;
	if (filename.split(/[/\\]/).includes('node_modules')) return undefined;
	return true;
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: { runes: runesFor },
			// SPA build: electron serves 200.html as fallback for every route via app://.
			adapter: adapter({ fallback: '200.html' }),
			paths: { relative: true }
		})
	],
	resolve: {
		// Linked packages live outside this tree; force one svelte runtime.
		dedupe: ['svelte', 'phosphor-svelte']
	},
	server: {
		fs: { allow: ['..'] }
	},
	build: {
		target: 'esnext'
	}
});
