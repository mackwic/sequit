/** Bundled SVG URLs only: document references never become remote URLs or markup. */
const assets = import.meta.glob<string>(
	'../../../../../node_modules/@phosphor-icons/core/assets/regular/*.svg',
	{ query: '?url&no-inline', import: 'default' },
);
const loaders = new Map(
	Object.entries(assets).map(([path, load]) => {
		const name = path.slice(path.lastIndexOf('/') + 1, -4);
		return [`phosphor:${name}`, load];
	}),
);
const urls = new Map<string, Promise<string>>();

export function isIconAvailable(reference: string): boolean {
	return loaders.has(reference);
}

/** Resolves an icon URL on first use so the full icon set never loads up front. */
export function loadIconUrl(reference: string): Promise<string | undefined> {
	const cached = urls.get(reference);
	if (cached !== undefined) return cached;
	const load = loaders.get(reference);
	if (load === undefined) return Promise.resolve(undefined);
	const url = load();
	urls.set(reference, url);
	return url;
}
