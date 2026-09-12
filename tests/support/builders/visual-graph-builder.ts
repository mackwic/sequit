import type { LogicDocument } from '../../../src/lib/core/document/logic-document';
import type { Size } from '../../../src/lib/core/layout/layout-types';

/** Input data only: ranks, geometry and expectations belong to the real pipeline and scenarios. */
export interface VisualGraphData {
	readonly nodes: Readonly<Record<string, Size>>;
	readonly relations: LogicDocument['relations'];
}

/** Each build returns independent data; explicit IDs are preserved. */
export class VisualGraphBuilder {
	private readonly sizes = new Map<string, Size>();
	private readonly links = new Map<string, LogicDocument['relations'][number]>();
	private readonly defaultSize: Size;

	constructor(size: Size) {
		this.defaultSize = { ...size };
	}

	nodes(ids: readonly string[], size: Size = this.defaultSize): this {
		if (![size.width, size.height].every((value) => Number.isFinite(value) && value > 0)) {
			throw new Error('Visual nodes must have finite positive dimensions.');
		}
		for (const id of ids) {
			if (id.trim() === '' || this.sizes.has(id) || this.links.has(id)) {
				throw new Error(`Invalid or duplicate visual node ID: ${id}`);
			}
			this.sizes.set(id, { ...size });
		}
		return this;
	}

	withIsolatedNode(id: string, size: Size = this.defaultSize): this {
		if ([...this.links.values()].some(({ from, to }) => from === id || to === id)) {
			throw new Error(`Visual node is not isolated: ${id}`);
		}
		return this.nodes([id], size);
	}

	/** Document arrow direction, independent of logical succession. */
	relation(relation: LogicDocument['relations'][number]): this {
		if (relation.id.trim() === '' || this.links.has(relation.id) || this.sizes.has(relation.id)) {
			throw new Error(`Invalid or duplicate visual relation ID: ${relation.id}`);
		}
		this.links.set(relation.id, { ...relation });
		return this;
	}

	/** Explicit document arrows, with IDs following their direction. */
	arrowsFrom(from: string, targets: readonly string[]): this {
		for (const to of targets) {
			this.relation({ id: `${from}-to-${to}`, from, to });
		}
		return this;
	}

	/** A successor points toward its parent; retain the workshop's historical parent-to-child IDs. */
	successorsOf(parent: string, successors: readonly string[]): this {
		for (const child of successors) {
			this.relation({ id: `${parent}-to-${child}`, from: child, to: parent });
		}
		return this;
	}

	build(): VisualGraphData {
		for (const { id, from, to } of this.links.values()) {
			if (!this.sizes.has(from) || !this.sizes.has(to)) {
				throw new Error(`Visual relation ${id} references a missing node: ${from} → ${to}`);
			}
		}
		return {
			nodes: Object.fromEntries([...this.sizes].map(([id, size]) => [id, { ...size }])),
			relations: [...this.links.values()].map((relation) => ({ ...relation })),
		};
	}
}
