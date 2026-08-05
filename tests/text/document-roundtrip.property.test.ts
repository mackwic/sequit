import fc from 'fast-check';
import { stringify, type TomlTable } from 'smol-toml';
import { describe, expect, it } from 'vitest';

import type { LogicDocument } from '../../src/lib/document/logic-document';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { PERSISTENCE_FORMAT } from '../../src/lib/text/persistence-format';
import { acyclicLogicDocumentArbitrary } from '../builders/logic-document-arbitrary';

function entityTable<T extends { readonly id: string }>(
	entities: readonly T[],
	project: (entity: T) => TomlTable,
): TomlTable {
	const table: TomlTable = {};
	for (const entity of entities) table[entity.id] = project(entity);
	return table;
}

function persistedDocument(document: LogicDocument): TomlTable {
	return {
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
	};
}

describe('generated persistent documents', () => {
	it('preserves every generated document through TOML serialization and parsing', () => {
		fc.assert(
			fc.property(acyclicLogicDocumentArbitrary(), (document) => {
				const source = stringify(persistedDocument(document));
				const parsed = parseSequitToml(source);
				expect(parsed).toEqual({ ok: true, value: document });
			}),
			{ numRuns: 200 },
		);
	});
});
