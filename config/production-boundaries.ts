import type { Plugin } from 'vite';

/** Check emitted chunks, after dead-code elimination, for development-only modules. */
export function productionBoundaries(): Plugin {
	return {
		name: 'sequit-production-boundaries',
		apply: 'build',
		generateBundle(_options, bundle) {
			for (const output of Object.values(bundle)) {
				if (output.type !== 'chunk') continue;
				for (const id of Object.keys(output.modules)) {
					if (id.replaceAll('\\', '/').includes('/src/app/workshop/')) {
						this.error(`Development workshop module included in production: ${id}`);
					}
				}
			}
		},
	};
}
