import type { LogicDocument } from './logic-document';

/** Collapse is a view: IDs and source content remain intact in WorkshopDocument. */
export function collapsedDocument(
	model: LogicDocument,
	collapsed: readonly string[],
): LogicDocument {
	const parents = new Map(
		[...model.groups, ...model.nodes, ...model.junctions].map((item) => [item.id, item.groupId]),
	);
	function visibleId(id: string): string {
		let result = id;
		let parent = parents.get(id);
		while (parent !== undefined) {
			if (collapsed.includes(parent)) result = parent;
			parent = parents.get(parent);
		}
		return result;
	}
	const seen = new Set<string>();
	return {
		...model,
		nodes: model.nodes.filter((item) => visibleId(item.id) === item.id),
		groups: model.groups.filter((item) => visibleId(item.id) === item.id),
		junctions: model.junctions.filter((item) => visibleId(item.id) === item.id),
		relations: model.relations.flatMap((item) => {
			const from = visibleId(item.from),
				to = visibleId(item.to);
			const key = JSON.stringify([from, to]);
			if (from === to || seen.has(key)) return [];
			seen.add(key);
			return [{ ...item, from, to }];
		}),
	};
}
