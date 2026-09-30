import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { mdsvex } from 'mdsvex';
import { defineConfig } from 'vite';

import { productionBoundaries } from './config/production-boundaries.ts';

const collaborationPort = process.env['COLLABORATION_PORT'] ?? '8787';

export default defineConfig({
	// These UI modules are loaded on demand. Prebundle them before opening a room so
	// dependency discovery cannot invalidate already loaded chunks (HTTP 504) mid-edit.
	optimizeDeps: {
		include: [
			'@phosphor-icons/core',
			'@floating-ui/dom',
			'quill',
			'quill-delta',
			'marked',
			'fast-diff',
		],
	},
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
			// Without this path the adapter finds no Wrangler config and targets Cloudflare Pages.
			adapter: adapter({ config: 'config/wrangler.jsonc' }),
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
