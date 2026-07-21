/** @type {import('prettier').Config} */
export default {
	plugins: ['prettier-plugin-svelte', 'prettier-plugin-tailwindcss'],
	printWidth: 100,
	singleQuote: true,
	trailingComma: 'all',
	useTabs: true,
	overrides: [{ files: '*.svelte', options: { parser: 'svelte' } }],
};
