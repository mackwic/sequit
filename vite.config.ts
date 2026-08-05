import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const collaborationPort = process.env.COLLABORATION_PORT ?? '8787';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
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
		proxy: {
			'/collab': {
				target: `http://127.0.0.1:${collaborationPort}`,
				ws: true,
			},
		},
	},
});
