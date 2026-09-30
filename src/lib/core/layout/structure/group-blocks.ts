import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';

/**
 * Groups enclosing a ranked ordinary endpoint. In layout each one is a rigid block: in every
 * row it spans, it occupies one contiguous slot of its container at one transverse position.
 * Nesting is exposed through parent links only, so deep hierarchies stay linear.
 */
export interface GroupBlocks {
	readonly ids: ReadonlySet<string>;
	/** The innermost block enclosing an endpoint or a block; undefined at the root. */
	readonly parentOf: (id: string) => string | undefined;
	/** Number of blocks enclosing an endpoint or a block. */
	readonly depthOf: (id: string) => number;
	/** The outermost block enclosing an endpoint, or the block itself at the root. */
	readonly outermostOf: (id: string) => string | undefined;
}

const cache = new WeakMap<LogicGraph, GroupBlocks>();

function groupOf(graph: LogicGraph, id: string): string | undefined {
	return graph.endpointsById.get(id)?.entity.groupId;
}

function blockIds(graph: LogicGraph): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const id of graph.rankableEndpointIds) {
		if (graph.endpointsById.get(id)?.kind === EndpointKind.Junction) continue;
		for (let group = groupOf(graph, id); group !== undefined; group = groupOf(graph, group)) {
			if (ids.has(group)) break;
			ids.add(group);
		}
	}
	return ids;
}

/** Memoize a value that follows from the parent's value, without recursion. */
function inherited<T>(
	parentOf: (id: string) => string | undefined,
	root: (id: string) => T,
	child: (parent: T) => T,
): (id: string) => T {
	const known = new Map<string, { readonly value: T }>();
	return (id) => {
		const pending: string[] = [];
		let current: string | undefined = id;
		while (current !== undefined && !known.has(current)) {
			pending.push(current);
			current = parentOf(current);
		}
		for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
			const parent = parentOf(next);
			let value = root(next);
			if (parent !== undefined) value = child(defined(known.get(parent)).value);
			known.set(next, { value });
		}
		return defined(known.get(id)).value;
	};
}

/** Blocks and their nesting for a graph; rows, rank orders and placement share one instance. */
export function groupBlocks(graph: LogicGraph): GroupBlocks {
	const cached = cache.get(graph);
	if (cached !== undefined) return cached;
	const ids = blockIds(graph);
	const parents = new Map<string, string | undefined>();
	const parentOf = (id: string): string | undefined => {
		if (parents.has(id)) return parents.get(id);
		let group = groupOf(graph, id);
		while (group !== undefined && !ids.has(group)) group = groupOf(graph, group);
		parents.set(id, group);
		return group;
	};
	const blocks: GroupBlocks = {
		ids,
		parentOf,
		depthOf: inherited(
			parentOf,
			() => 0,
			(parent) => parent + 1,
		),
		outermostOf: inherited<string | undefined>(
			parentOf,
			(id) => {
				if (ids.has(id)) return id;
				return undefined;
			},
			(parent) => parent,
		),
	};
	cache.set(graph, blocks);
	return blocks;
}

/** The innermost container holding two endpoints, and the item standing for each there. */
export interface CommonContainer {
	readonly container: string | undefined;
	readonly left: string;
	readonly right: string;
}

/** Undefined when one endpoint is a block enclosing the other. */
export function commonContainer(
	blocks: GroupBlocks,
	left: string,
	right: string,
): CommonContainer | undefined {
	let leftItem = left;
	let rightItem = right;
	let leftDepth = blocks.depthOf(left);
	let rightDepth = blocks.depthOf(right);
	for (; leftDepth > rightDepth; leftDepth -= 1) leftItem = blocks.parentOf(leftItem) ?? leftItem;
	for (; rightDepth > leftDepth; rightDepth -= 1)
		rightItem = blocks.parentOf(rightItem) ?? rightItem;
	if (leftItem === rightItem) return undefined;
	while (blocks.parentOf(leftItem) !== blocks.parentOf(rightItem)) {
		leftItem = blocks.parentOf(leftItem) ?? leftItem;
		rightItem = blocks.parentOf(rightItem) ?? rightItem;
	}
	return { container: blocks.parentOf(leftItem), left: leftItem, right: rightItem };
}

/** The slots of every container a row passes through, from the innermost one holding it all. */
export interface RowContainers {
	/** The innermost container holding the whole row; undefined for the root. */
	readonly top: string | undefined;
	/** Direct items of each container in row order, top first, then in preorder. */
	readonly slots: Map<string | undefined, string[]>;
}

/** A block met for the first time below the row's top: its slots start here. */
function opens(
	anchor: string | undefined,
	top: string | undefined,
	seen: ReadonlySet<string>,
): anchor is string {
	if (anchor === undefined || anchor === top) return false;
	return !seen.has(anchor);
}

/**
 * Group a row by container: a block appears once in its container, where its first item is.
 * Only containers from the row's top down are visited, whatever the depth above it.
 */
export function rowContainers(row: readonly string[], blocks: GroupBlocks): RowContainers {
	let top: string | undefined;
	for (const [index, id] of row.entries()) {
		if (index === 0) top = blocks.parentOf(id);
		else if (top !== undefined) {
			// Undefined when the current top already encloses this endpoint.
			const common = commonContainer(blocks, id, top);
			if (common !== undefined) top = common.container;
		}
		if (top === undefined) break;
	}
	const slots = new Map<string | undefined, string[]>();
	const seen = new Set<string>();
	for (const id of row) {
		const path = [id];
		let anchor = blocks.parentOf(id);
		while (opens(anchor, top, seen)) {
			seen.add(anchor);
			path.push(anchor);
			anchor = blocks.parentOf(anchor);
		}
		for (let index = path.length - 1; index >= 0; index -= 1) {
			const list = slots.get(anchor) ?? [];
			slots.set(anchor, list);
			const item = defined(path[index]);
			list.push(item);
			anchor = item;
		}
	}
	return { top, slots };
}

/** The row again, each container's slots replaced by their items, from the top container. */
export function expandSlots(
	slots: ReadonlyMap<string | undefined, readonly string[]>,
	top: string | undefined,
): string[] {
	const row: string[] = [];
	const pending = [...(slots.get(top) ?? [])].reverse();
	for (let slot = pending.pop(); slot !== undefined; slot = pending.pop()) {
		const inner = slots.get(slot);
		if (inner === undefined) row.push(slot);
		else
			for (let index = inner.length - 1; index >= 0; index -= 1)
				pending.push(defined(inner[index]));
	}
	return row;
}
