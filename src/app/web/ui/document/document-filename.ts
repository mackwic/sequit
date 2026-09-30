const EXTENSION = '.sequit.toml';

/** A portable file name derived from the document title, falling back to its identifier. */
export function documentFilename(title: string, id: string): string {
	const slug = title
		.normalize('NFD')
		.replaceAll(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');
	if (slug === '') return `${id}${EXTENSION}`;
	return `${slug}${EXTENSION}`;
}
