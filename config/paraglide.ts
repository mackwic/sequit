import type { CompilerOptions } from '@inlang/paraglide-js';

/**
 * One configuration for the Vite plugin and the standalone compile that type checks and
 * lint need. Without a locale in the URL, an explicit choice is kept in a cookie; otherwise
 * the browser language decides, then French.
 */
export const paraglideOptions = {
	project: './project.inlang',
	outdir: './src/app/web/i18n/paraglide',
	strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
	emitTsDeclarations: true,
	emitReadme: false,
} satisfies CompilerOptions;
