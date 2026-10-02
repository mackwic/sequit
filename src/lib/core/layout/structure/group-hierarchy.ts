import { defined, type LogicDocument, type LogicGroup } from '../../document/logic-document';
import { orderEndpoints } from '../../ordering/endpoint-order';

export interface GroupHierarchy {
	readonly byId: ReadonlyMap<string, LogicGroup>;
	readonly membersById: ReadonlyMap<string, readonly string[]>;
	readonly rootById: ReadonlyMap<string, string>;
	readonly preorderIndexById: ReadonlyMap<string, number>;
	readonly subtreeEndById: ReadonlyMap<string, number>;
	readonly deepestFirst: readonly LogicGroup[];
}

interface Ancestry {
	readonly depth: number;
	readonly root: string;
}

/** Iterative path unwinding visits each group once, including deeply nested hierarchies. */
function indexAncestors(groups: ReadonlyMap<string, LogicGroup>): ReadonlyMap<string, Ancestry> {
	const ancestors = new Map<string, Ancestry>();
	for (const group of groups.values()) {
		const path: LogicGroup[] = [];
		let current: LogicGroup | undefined = group;
		while (current !== undefined && !ancestors.has(current.id)) {
			path.push(current);
			current = groups.get(current.groupId ?? '');
		}
		while (path.length > 0) {
			const next = defined(path.pop());
			const parent = ancestors.get(next.groupId ?? '');
			let entry: Ancestry = { depth: 0, root: next.id };
			if (parent !== undefined) entry = { depth: parent.depth + 1, root: parent.root };
			ancestors.set(next.id, entry);
		}
	}
	return ancestors;
}

function indexGroupSubtrees(
	groups: ReadonlyMap<string, LogicGroup>,
	orderById: ReadonlyMap<string, number>,
): {
	readonly preorderIndexById: ReadonlyMap<string, number>;
	readonly subtreeEndById: ReadonlyMap<string, number>;
} {
	const childrenById = new Map<string, string[]>();
	const roots: string[] = [];
	for (const group of groups.values()) {
		if (group.groupId === undefined) {
			roots.push(group.id);
			continue;
		}
		const children = childrenById.get(group.groupId) ?? [];
		children.push(group.id);
		childrenById.set(group.groupId, children);
	}
	const compareGroups = (left: string, right: string) =>
		defined(orderById.get(left)) - defined(orderById.get(right));
	roots.sort(compareGroups);
	for (const children of childrenById.values()) children.sort(compareGroups);

	const preorderIndexById = new Map<string, number>();
	const subtreeEndById = new Map<string, number>();
	const pending: { readonly id: string; readonly exiting: boolean }[] = [];
	let nextIndex = 0;
	for (const root of roots.toReversed()) pending.push({ id: root, exiting: false });
	while (pending.length > 0) {
		const current = defined(pending.pop());
		if (current.exiting) {
			subtreeEndById.set(current.id, nextIndex - 1);
			continue;
		}
		preorderIndexById.set(current.id, nextIndex++);
		pending.push({ id: current.id, exiting: true });
		const children = childrenById.get(current.id) ?? [];
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const childId = children[index];
			pending.push({ id: defined(childId), exiting: false });
		}
	}
	return { preorderIndexById, subtreeEndById };
}

export function prepareGroupHierarchy(document: LogicDocument): GroupHierarchy | undefined {
	if (document.groups.length === 0) return undefined;
	const byId = new Map(document.groups.map((group) => [group.id, group]));
	const orderById = new Map(orderEndpoints(document.groups).map((id, index) => [id, index]));
	const membersById = new Map<string, string[]>();
	// Match the existing containment traversal order; no descendant expansion is needed.
	for (const member of [...document.nodes, ...document.junctions, ...document.groups]) {
		if (member.groupId === undefined) continue;
		const members = membersById.get(member.groupId) ?? [];
		members.push(member.id);
		membersById.set(member.groupId, members);
	}
	const ancestors = indexAncestors(byId);
	const subtreeIndices = indexGroupSubtrees(byId, orderById);
	const deepestFirst = [...document.groups].sort((left, right) => {
		const depth = defined(ancestors.get(right.id)).depth - defined(ancestors.get(left.id)).depth;
		return depth || defined(orderById.get(left.id)) - defined(orderById.get(right.id));
	});
	return {
		byId,
		membersById,
		deepestFirst,
		rootById: new Map([...ancestors].map(([id, entry]) => [id, entry.root])),
		...subtreeIndices,
	};
}
