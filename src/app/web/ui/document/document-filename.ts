const EXTENSION = '.sequit.toml';

/** A portable file stem derived from the document title, falling back to its identifier. */
export function documentFileStem(title: string, id: string): string {
	const slug = title
		.normalize('NFD')
		.replaceAll(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');
	if (slug === '') return id;
	return slug;
}

/** The Sequit file name of a document. */
export function documentFilename(title: string, id: string): string {
	return `${documentFileStem(title, id)}${EXTENSION}`;
}
