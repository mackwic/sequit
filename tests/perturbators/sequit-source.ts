export function withUnknownNature(source: string): string {
	return source.replace('nature = "need"', 'nature = "missing-nature"');
}

export function withDuplicateEndpoint(source: string): string {
	return `${source}\n[groups.traceable-edits]\nlabel = "Duplicate endpoint"\n`;
}

export function withReorderedTables(source: string): string {
	const firstTable = source.search(/^\[/m);
	if (firstTable < 0) return source;

	const preamble = source.slice(0, firstTable);
	const blocks = source
		.slice(firstTable)
		.split(/(?=^\[)/m)
		.filter(Boolean);
	return preamble + blocks.reverse().join('');
}
