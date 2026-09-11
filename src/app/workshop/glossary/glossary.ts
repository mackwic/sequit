export const GLOSSARY_STATUSES = ['todo', 'to update', 'ok', '???'] as const;

export interface GlossaryEntry {
	id: string;
	section: string;
	fr: string;
	en: string;
	definition: string;
	status: string;
	notes: string;
}

function decode(value: string): string {
	return value
		.replaceAll('<br>', '\n')
		.replaceAll('&#124;', '|')
		.replaceAll('&lt;', '<')
		.replaceAll('&amp;', '&');
}

function encode(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('|', '&#124;')
		.replaceAll('\r\n', '\n')
		.replaceAll('\n', '<br>');
}

export function readGlossary(markdown: string): GlossaryEntry[] {
	let section = '';
	const entries: GlossaryEntry[] = [];
	for (const line of markdown.split('\n')) {
		if (line.startsWith('## ')) section = line.slice(3);
		const cells = line
			.split('|')
			.slice(1, -1)
			.map((cell) => decode(cell.trim()));
		const [id, fr, en, definition, status, notes] = cells;
		if (id?.startsWith('VL-') !== true) continue;
		if (
			cells.length !== 6 ||
			fr === undefined ||
			en === undefined ||
			definition === undefined ||
			status === undefined ||
			notes === undefined
		)
			throw new Error('Ligne de glossaire invalide.');
		if (entries.some((entry) => entry.id === id)) throw new Error('Identifiant de terme dupliqué.');
		entries.push({ id, section, fr, en, definition, status, notes });
	}
	if (entries.length === 0 && !markdown.includes('| ID '))
		throw new Error('Aucun tableau de termes trouvé.');
	return entries;
}

export function glossarySections(markdown: string): string[] {
	const sections = new Set(readGlossary(markdown).map((entry) => entry.section));
	let section = '';
	for (const line of markdown.split('\n')) {
		if (line.startsWith('## ')) section = line.slice(3);
		if (line.startsWith('| ID ')) sections.add(section);
	}
	return [...sections];
}

export function writeGlossary(markdown: string, entries: readonly GlossaryEntry[]): string {
	const sections = glossarySections(markdown);
	if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
		throw new Error('Identifiant de terme dupliqué.');
	if (entries.some((entry) => !sections.includes(entry.section)))
		throw new Error('Famille inconnue.');
	const output: string[] = [];
	const inserted = new Set<string>();
	let section = '';
	let header = false;
	function insert() {
		if (inserted.has(section)) return;
		inserted.add(section);
		for (const entry of entries.filter((item) => item.section === section)) {
			output.push(
				`| ${[entry.id, entry.fr, entry.en, entry.definition, entry.status, entry.notes].map(encode).join(' | ')} |`,
			);
		}
	}
	for (const line of markdown.split('\n')) {
		if (line.startsWith('## ')) section = line.slice(3);
		if (line.split('|')[1]?.trim().startsWith('VL-') === true) {
			insert();
			continue;
		}
		output.push(line);
		if (header && /^\|[ :|-]+$/.test(line)) insert();
		header = line.startsWith('| ID ');
	}
	return output.join('\n');
}
