import { compile as compileMarkdown } from 'mdsvex';
import { compile as compileSvelte } from 'svelte/compiler';

/** @type {import('knip').KnipConfig} */
export default {
	entry: ['src/workers/collaboration-worker/index.ts', 'tests/**/*.type-test.ts'],
	// Loaded by the inlang project (project.inlang/settings.json), not imported.
	ignoreDependencies: ['cloudflare', '@inlang/plugin-message-format'],
	wrangler: { config: ['src/workers/collaboration-worker/wrangler.jsonc'] },
	// Follow imports in executable Markdown, including its Svelte components.
	compilers: {
		svx: async (source, filename) => {
			const compiled = await compileMarkdown(source, { filename, highlight: false });
			if (!compiled) throw new Error(`Could not compile ${filename}`);
			return compileSvelte(compiled.code, { filename }).js.code;
		},
	},
};
