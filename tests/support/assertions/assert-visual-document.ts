import { defined } from '../../../src/lib/core/document/logic-document';
import type { VisualLayout } from '../harnesses/visual-layout';
import { VisualAssertionError } from './assertion-error';

function sameIds(label: string, actual: readonly string[], expected: readonly string[]): void {
	const a = [...actual].sort().join(',');
	const b = [...expected].sort().join(',');
	if (a !== b) throw new VisualAssertionError(label, b, a, { boxes: actual });
}

/** Check the edited source of truth AND the projection, including cascading relation removal. */
export class VisualDocumentAssertions {
	constructor(private readonly layout: VisualLayout) {}
	hasEndpoints(ids: readonly string[]): this {
		const document = defined(this.layout.document, 'The source document must be observable.');
		sameIds(
			'Extrémités du document',
			[...document.nodes, ...document.junctions, ...document.groups].map(({ id }) => id),
			ids,
		);
		sameIds(
			'Extrémités du layout',
			this.layout.elements.map(({ id }) => id),
			ids,
		);
		return this;
	}
	hasRelations(ids: readonly string[]): this {
		const document = defined(this.layout.document, 'The source document must be observable.');
		sameIds(
			'Relations du document',
			document.relations.map(({ id }) => id),
			ids,
		);
		sameIds(
			'Routes du layout',
			this.layout.relations.map(({ id }) => id),
			ids,
		);
		return this;
	}
}
