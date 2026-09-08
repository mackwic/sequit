/** Bundled SVG URLs only: document references never become remote URLs or markup. */
const assets = import.meta.glob<string>(
	'../../../../../node_modules/@phosphor-icons/core/assets/regular/*.svg',
	{ eager: true, query: '?url&no-inline', import: 'default' },
);
const urls = new Map(
	Object.entries(assets).map(([path, url]) => {
		const name = path.slice(path.lastIndexOf('/') + 1, -4);
		return [`phosphor:${name}`, url];
	}),
);

export function iconUrl(reference: string): string | undefined {
	return urls.get(reference);
}
