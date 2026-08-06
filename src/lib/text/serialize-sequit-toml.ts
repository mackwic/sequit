import { stringify, type TomlTable } from 'smol-toml';

import type { LogicDocument } from '../document/logic-document';
import { PERSISTENCE_FORMAT } from './persistence-format';

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
		natures: entityTable(document.natures, ({ label, color }) => ({ label, color })),
		groups: entityTable(document.groups, ({ label, groupId }) => {
			const group: TomlTable = { label };
			if (groupId !== undefined) group['group'] = groupId;
			return group;
		}),
		nodes: entityTable(document.nodes, ({ natureId, groupId, markdown }) => {
			const node: TomlTable = { nature: natureId, markdown };
			if (groupId !== undefined) node['group'] = groupId;
			return node;
		}),
		junctions: entityTable(document.junctions, ({ operator, groupId }) => {
			const junction: TomlTable = { operator };
			if (groupId !== undefined) junction['group'] = groupId;
			return junction;
		}),
		relations: entityTable(document.relations, ({ from, to }) => ({ from, to })),
	});
}
