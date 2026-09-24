import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import type { RegionDefinition } from './region-composition-types';

export interface RegionCompositionNode {
	readonly definition: RegionDefinition;
	readonly id: string;
	readonly parentId?: string;
	readonly childIds: readonly string[];
	readonly depth: number;
}

export function parentCycle(
	definitions: ReadonlyMap<string, RegionDefinition>,
): readonly string[] | undefined {
	const done = new Set<string>();
	for (const start of [...definitions.keys()].sort(compareCanonicalStrings)) {
		if (done.has(start)) continue;
		const path: string[] = [];
		const indexById = new Map<string, number>();
		let current: string | undefined = start;
		while (current !== undefined && !done.has(current)) {
			const repeated = indexById.get(current);
			if (repeated !== undefined) return [...path.slice(repeated), current];
			indexById.set(current, path.length);
			path.push(current);
			current = definitions.get(current)?.parentId;
		}
		for (const id of path) done.add(id);
	}
	return undefined;
}

function orderedChildren(
	definitions: ReadonlyMap<string, RegionDefinition>,
): ReadonlyMap<string, readonly string[]> {
	const children = new Map([...definitions.keys()].map((id) => [id, [] as string[]]));
	for (const definition of definitions.values())
		if (definition.parentId !== undefined)
			defined(children.get(definition.parentId), 'Unvalidated region parent.').push(definition.id);
	for (const siblings of children.values())
		siblings.sort((leftId, rightId) => {
			const left = defined(definitions.get(leftId), 'Unvalidated region parent.');
			const right = defined(definitions.get(rightId), 'Unvalidated region parent.');
			return (
				compareCanonicalStrings(left.layoutOrder, right.layoutOrder) ||
				compareCanonicalStrings(leftId, rightId)
			);
		});
	return children;
}

export function normalizedRegions(
	rootId: string,
	definitions: ReadonlyMap<string, RegionDefinition>,
): {
	readonly preorderIds: readonly string[];
	readonly byId: ReadonlyMap<string, RegionCompositionNode>;
} {
	const children = orderedChildren(definitions);
	const preorderIds: string[] = [];
	const byId = new Map<string, RegionCompositionNode>();
	const pending: { readonly id: string; readonly depth: number }[] = [{ id: rootId, depth: 0 }];
	while (pending.length > 0) {
		const next = defined(pending.pop(), 'Unvalidated region traversal.');
		const { id, depth } = next;
		const definition = defined(definitions.get(id), 'Unvalidated region identity.');
		const childIds = defined(children.get(id), 'Unvalidated region identity.');
		preorderIds.push(id);
		let node: RegionCompositionNode = { definition, id, childIds, depth };
		if (definition.parentId !== undefined) node = { ...node, parentId: definition.parentId };
		byId.set(id, node);
		for (const childId of [...childIds].reverse()) pending.push({ id: childId, depth: depth + 1 });
	}
	return { preorderIds, byId };
}
