import { EndpointKind, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { LayoutElement, LayoutResult } from '../../../src/lib/core/layout/layout-types';
import { type BoxGeometry, validateBox } from './box-geometry';

export interface VisualNode extends LayoutElement {
	/** Human-facing ordinal; the first logical rank is 1. */
	readonly rank: number;
}

/** A queryable result for the harness; coordinates and routes come directly from the engine. */
export class VisualLayout implements LayoutResult {
	readonly width: LayoutResult['width'];
	readonly height: LayoutResult['height'];
	readonly elements: LayoutResult['elements'];
	readonly relations: LayoutResult['relations'];
	readonly routingInspection: LayoutResult['routingInspection'];

	constructor(
		result: LayoutResult,
		private readonly ranks: ReadonlyMap<string, number> = new Map(),
		readonly direction: LayoutDirection = LayoutDirection.TopToBottom,
		readonly reference?: { readonly label: string; readonly layout: VisualLayout },
	) {
		this.width = result.width;
		this.height = result.height;
		this.elements = result.elements;
		this.relations = result.relations;
		this.routingInspection = result.routingInspection;
	}

	getNodeById(id: string): VisualNode {
		const element = this.getById(id);
		if (element.kind !== EndpointKind.Node) throw new Error(`Expected a node: ${id}`);
		const rank = this.ranks.get(id);
		if (rank === undefined) throw new Error(`Missing logical rank: ${id}`);
		return { ...element, rank: rank + 1 };
	}

	withElements(elements: LayoutResult['elements']): VisualLayout {
		return new VisualLayout(
			{ width: this.width, height: this.height, elements, relations: this.relations },
			this.ranks,
			this.direction,
			this.reference,
		);
	}

	withReference(label: string, layout: VisualLayout): VisualLayout {
		return new VisualLayout(this, this.ranks, this.direction, { label, layout });
	}

	get frame(): BoxGeometry {
		return {
			id: 'layout',
			identity: { kind: 'frame', ids: [] },
			bounds: { x: 0, y: 0, width: this.width, height: this.height },
		};
	}

	envelopeOf(ids: readonly string[]): BoxGeometry {
		if (ids.length === 0) throw new Error('Cannot measure an empty envelope.');
		if (new Set(ids).size !== ids.length) throw new Error('Envelope identifiers must be unique.');
		const bounds = ids.map((id) => {
			const box = this.getById(id);
			validateBox(box);
			return box.bounds;
		});
		const x = Math.min(...bounds.map((box) => box.x));
		const y = Math.min(...bounds.map((box) => box.y));
		return {
			id: `envelope(${ids.join(',')})`,
			identity: { kind: 'envelope', ids: [...ids] },
			bounds: {
				x,
				y,
				width: Math.max(...bounds.map((box) => box.x + box.width)) - x,
				height: Math.max(...bounds.map((box) => box.y + box.height)) - y,
			},
		};
	}

	/** Exact ID lookup among visual elements (boxes and junctions), independent of the DOM. */
	getById(id: string): LayoutElement {
		const element = this.elements.find((candidate) => candidate.id === id);
		if (element === undefined)
			throw new Error(`Missing layout element: *[id=${JSON.stringify(id)}]`);
		return element;
	}
}
