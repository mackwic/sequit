import { EndpointKind, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { BoxGeometry } from '../harnesses/box-geometry';
import { axesFor } from '../harnesses/visual-directions';
import type { VisualLayout } from '../harnesses/visual-layout';
import { AssertBox } from './assert-box';
import { layoutRoutingAssertions } from './assert-layout-routing';
import { AssertNode } from './assert-node';
import { AssertQuaySize, type QuaySizeOptions, usedQuayCount } from './assert-quays';

type BoxReference = string | BoxGeometry;
interface OrderOptions {
	readonly direction?: LayoutDirection | 'transverse-positive';
}
interface CenterOptions {
	readonly axis: 'x' | 'y' | 'both' | 'transverse';
}
interface AlignmentOptions {
	readonly by: 'top' | 'centerX' | 'centerY' | 'row' | 'chain';
	readonly tolerance?: number;
}
interface BoxCheck {
	isAlignedWith(reference: BoxReference, options: AlignmentOptions): BoxCheck;
	isAfter(reference: BoxReference, options?: OrderOptions): BoxCheck;
	isCenteredOn(reference: BoxReference, options: CenterOptions): BoxCheck;
}
interface NodeCheck {
	isAlignedWith(reference: BoxReference, options: AlignmentOptions): NodeCheck;
	hasSizeForUsedQuays(options: Omit<QuaySizeOptions, 'incoming' | 'outgoing'>): NodeCheck;
	hasSizeForQuays(options: QuaySizeOptions): NodeCheck;
	hasRank(expected: number): NodeCheck;
	isAfter(reference: BoxReference, options?: OrderOptions): NodeCheck;
	isCenteredOn(reference: BoxReference, options: CenterOptions): NodeCheck;
}
interface NodesCheck {
	haveSizeForQuays(options: QuaySizeOptions): NodesCheck;
	haveRank(expected: number): NodesCheck;
	areAfter(reference: BoxReference, options?: OrderOptions): NodesCheck;
}
interface LayoutAssertions extends ReturnType<typeof layoutRoutingAssertions> {
	node(id: string): NodeCheck;
	nodes(ids: readonly string[]): NodesCheck;
	envelope(ids: readonly string[]): BoxCheck;
}

function referenceBox(layout: VisualLayout, reference: BoxReference): BoxGeometry {
	if (typeof reference === 'string') return layout.getById(reference);
	return reference;
}

function orderDirection(layout: VisualLayout, options: OrderOptions): LayoutDirection {
	const direction = options.direction ?? layout.direction;
	if (direction !== 'transverse-positive') return direction;
	if (axesFor(layout.direction).transverse === 'x') return LayoutDirection.LeftToRight;
	return LayoutDirection.TopToBottom;
}

function boxCheck(layout: VisualLayout, subject: BoxGeometry): BoxCheck {
	const check: BoxCheck = {
		isAlignedWith(reference, { by, ...options }) {
			let physical = by;
			if (physical === 'row') physical = axesFor(layout.direction).rowAlignment;
			if (physical === 'chain') physical = axesFor(layout.direction).chainAlignment;
			AssertBox(subject).isAlignedWith(referenceBox(layout, reference), {
				...options,
				by: physical,
			});
			return check;
		},
		isAfter(reference, options = {}) {
			AssertBox(subject).isAfter(referenceBox(layout, reference), {
				direction: orderDirection(layout, options),
			});
			return check;
		},
		isCenteredOn(reference, { axis }) {
			let physicalAxis = axis;
			if (physicalAxis === 'transverse') physicalAxis = axesFor(layout.direction).transverse;
			AssertBox(subject).isCenteredIn(referenceBox(layout, reference), { axis: physicalAxis });
			return check;
		},
	};
	return check;
}

function nodeCheck(layout: VisualLayout, id: string): NodeCheck {
	const node = layout.getById(id);
	if (node.kind !== EndpointKind.Node) throw new Error(`Expected a node: ${id}`);
	const box = boxCheck(layout, node);
	const check: NodeCheck = {
		isAlignedWith(reference, options) {
			box.isAlignedWith(reference, options);
			return check;
		},
		hasSizeForUsedQuays(options) {
			AssertQuaySize(layout, node.id).matchesContentAndQuays({
				...options,
				incoming: usedQuayCount(layout, node.id, 'incoming'),
				outgoing: usedQuayCount(layout, node.id, 'outgoing'),
			});
			return check;
		},
		hasSizeForQuays(options) {
			AssertQuaySize(layout, node.id).matchesContentAndQuays(options);
			return check;
		},
		hasRank(expected) {
			AssertNode(layout.getNodeById(id)).hasRank(expected);
			return check;
		},
		isAfter(reference, options) {
			box.isAfter(reference, options);
			return check;
		},
		isCenteredOn(reference, options) {
			box.isCenteredOn(reference, options);
			return check;
		},
	};
	return check;
}

function nodesCheck(layout: VisualLayout, ids: readonly string[]): NodesCheck {
	if (ids.length === 0) throw new Error('Expected at least one node.');
	if (new Set(ids).size !== ids.length) throw new Error('Node identifiers must be unique.');
	const nodes = ids.map((id) => nodeCheck(layout, id));
	const check: NodesCheck = {
		haveSizeForQuays(options) {
			for (const node of nodes) node.hasSizeForQuays(options);
			return check;
		},
		haveRank(expected) {
			for (const node of nodes) node.hasRank(expected);
			return check;
		},
		areAfter(reference, options) {
			for (const node of nodes) node.isAfter(reference, options);
			return check;
		},
	};
	return check;
}

/** Selections are explicit; assertions execute immediately and retain their original subject. */
export function AssertLayout(layout: VisualLayout): LayoutAssertions {
	return {
		...layoutRoutingAssertions(layout),
		node(id) {
			return nodeCheck(layout, id);
		},
		nodes(ids) {
			return nodesCheck(layout, ids);
		},
		envelope(ids) {
			return boxCheck(layout, layout.envelopeOf(ids));
		},
	};
}
