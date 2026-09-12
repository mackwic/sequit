import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { mdsvex } from 'mdsvex';
import { defineConfig } from 'vite';

import { productionBoundaries } from './config/production-boundaries.ts';

const collaborationPort = process.env['COLLABORATION_PORT'] ?? '8787';

export default defineConfig({
	// The catalogue is loaded on demand. Discover its dependency before a user opens it,
	// so Vite does not reload the page and discard the workshop's local document.
	optimizeDeps: { include: ['@phosphor-icons/core'] },
	plugins: [
		productionBoundaries(),
		tailwindcss(),
		sveltekit({
			extensions: ['.svelte', '.svx'],
			preprocess: [mdsvex({ extensions: ['.svx'], highlight: false })],
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => {
					if (filename.split(/[/\\]/).includes('node_modules')) return undefined;
					return true;
				},
			},
			adapter: adapter(),
		}),
	],
	server: {
		host: '127.0.0.1',
		fs: { allow: ['tests/support', 'tests/scenarios'] },
		proxy: {
			'/collab': {
				target: `http://127.0.0.1:${collaborationPort}`,
				ws: true,
			},
		},
	},
});
