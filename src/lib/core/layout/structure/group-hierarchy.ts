import { compareCanonicalStrings } from '../../canonical-string';
import { defined, type LogicDocument, type LogicGroup } from '../../document/logic-document';

export interface GroupHierarchy {
	readonly byId: ReadonlyMap<string, LogicGroup>;
	readonly membersById: ReadonlyMap<string, readonly string[]>;
	readonly rootById: ReadonlyMap<string, string>;
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

export function prepareGroupHierarchy(document: LogicDocument): GroupHierarchy | undefined {
	if (document.groups.length === 0) return undefined;
	const byId = new Map(document.groups.map((group) => [group.id, group]));
	const membersById = new Map<string, string[]>();
	// Match the existing containment traversal order; no descendant expansion is needed.
	for (const member of [...document.nodes, ...document.junctions, ...document.groups]) {
		if (member.groupId === undefined) continue;
		const members = membersById.get(member.groupId) ?? [];
		members.push(member.id);
		membersById.set(member.groupId, members);
	}
	const ancestors = indexAncestors(byId);
	const deepestFirst = [...document.groups].sort((left, right) => {
		const depth = defined(ancestors.get(right.id)).depth - defined(ancestors.get(left.id)).depth;
		return depth || compareCanonicalStrings(left.id, right.id);
	});
	return {
		byId,
		membersById,
		deepestFirst,
		rootById: new Map([...ancestors].map(([id, entry]) => [id, entry.root])),
	};
}
