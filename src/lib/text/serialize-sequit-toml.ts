import { stringify, type TomlTable } from 'smol-toml';

import {
	contentStyleFields,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../document/logic-document';

function entityTable<T extends { readonly id: string }>(
	entities: readonly T[],
	project: (entity: T) => TomlTable,
): TomlTable {
	const table: TomlTable = {};
	for (const entity of [...entities].sort((left, right) => left.id.localeCompare(right.id))) {
		table[entity.id] = project(entity);
	}
	return table;
}

export function serializeSequitToml(document: LogicDocument): string {
	return stringify({
		persistenceFormat: PERSISTENCE_FORMAT,
		document: { id: document.id, title: document.title },
		layout: { direction: document.layout.direction, bias: document.layout.bias },
		natures: entityTable(document.natures, ({ label, color, icon }) => ({
			label,
			...contentStyleFields(color, icon),
		})),
		groups: entityTable(document.groups, ({ label, groupId, layoutOrder }) => {
			const group: TomlTable = { label, layoutOrder };
			if (groupId !== undefined) group['group'] = groupId;
			return group;
		}),
		nodes: entityTable(
			document.nodes,
			({ natureId, groupId, markdown, layoutOrder, color, icon }) => {
				const node: TomlTable = {
					nature: natureId,
					markdown,
					layoutOrder,
					...contentStyleFields(color, icon),
				};
				if (groupId !== undefined) node['group'] = groupId;
				return node;
			},
		),
		junctions: entityTable(document.junctions, ({ operator, groupId, layoutOrder }) => {
			const junction: TomlTable = { operator, layoutOrder };
			if (groupId !== undefined) junction['group'] = groupId;
			return junction;
		}),
		relations: entityTable(document.relations, ({ from, to }) => ({ from, to })),
	});
}
