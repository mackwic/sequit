import { stringify, type TomlTable } from 'smol-toml';

import {
	assertUniqueRelationIds,
	contentStyleFields,
	type GridLayoutPresentation,
	type LayoutRegionDefinition,
	type LogicDocument,
	natureFamilyField,
	nodeDescriptionFields,
} from '../../core/document/logic-document';

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

function gridPresentationTable(grid: GridLayoutPresentation): TomlTable {
	return {
		minimumColumnWidths: [...grid.minimumColumnWidths],
		minimumRowHeights: [...grid.minimumRowHeights],
		cells: entityTable(
			grid.cells.map((cell) => ({ ...cell, id: cell.regionId })),
			({ row, column }) => ({ row, column }),
		),
	};
}

function regionTable({
	parentId,
	layoutOrder,
	policy,
	lanePresentation,
	grid,
}: LayoutRegionDefinition): TomlTable {
	const region: TomlTable = { layoutOrder, policy };
	if (parentId !== undefined) region['parentId'] = parentId;
	if (lanePresentation !== undefined)
		region['lanePresentation'] = {
			laneOrientation: lanePresentation.laneOrientation,
			growth: lanePresentation.growth,
			lanes: entityTable(lanePresentation.lanes, ({ label, layoutOrder: laneOrder }) => ({
				label,
				layoutOrder: laneOrder,
			})),
		};
	if (grid !== undefined) region['grid'] = gridPresentationTable(grid);
	return region;
}

export function serializeSequitToml(document: LogicDocument): string {
	assertUniqueRelationIds(document.relations);
	const presentation = document.presentation;
	const presentationTable: { presentation?: TomlTable } = {};
	if (presentation !== undefined)
		presentationTable.presentation = {
			schemaVersion: presentation.schemaVersion,
			policy: presentation.policy,
			laneOrientation: presentation.laneOrientation,
			growth: presentation.growth,
			lanes: entityTable(presentation.lanes, ({ label, layoutOrder }) => ({
				label,
				layoutOrder,
			})),
		};
	const regionPresentation = document.regionPresentation;
	const regionPresentationTable: { regionPresentation?: TomlTable } = {};
	if (regionPresentation !== undefined) {
		const grid = regionPresentation.grid;
		const gridTable: { grid?: TomlTable } = {};
		if (grid !== undefined) gridTable.grid = gridPresentationTable(grid);
		regionPresentationTable.regionPresentation = {
			schemaVersion: regionPresentation.schemaVersion,
			regions: entityTable(regionPresentation.regions, regionTable),
			...gridTable,
		};
	}
	return stringify({
		persistenceFormat: document.persistenceFormat,
		document: { id: document.id, title: document.title },
		layout: { direction: document.layout.direction, bias: document.layout.bias },
		...presentationTable,
		...regionPresentationTable,
		natures: entityTable(document.natures, ({ label, color, icon, family }) => ({
			label,
			...contentStyleFields(color, icon),
			...natureFamilyField(family),
		})),
		groups: entityTable(
			document.groups,
			({ label, color, groupId, laneId, regionId, layoutOrder, state }) => {
				const group: TomlTable = { label, ...contentStyleFields(color, undefined), layoutOrder };
				if (groupId !== undefined) group['group'] = groupId;
				if (laneId !== undefined) group['lane'] = laneId;
				if (regionId !== undefined) group['regionId'] = regionId;
				if (state !== undefined) group['state'] = state;
				return group;
			},
		),
		nodes: entityTable(
			document.nodes,
			({
				natureId,
				groupId,
				laneId,
				regionId,
				markdown,
				description,
				layoutOrder,
				color,
				icon,
			}) => {
				const node: TomlTable = {
					nature: natureId,
					markdown,
					...nodeDescriptionFields(description),
					layoutOrder,
					...contentStyleFields(color, icon),
				};
				if (groupId !== undefined) node['group'] = groupId;
				if (laneId !== undefined) node['lane'] = laneId;
				if (regionId !== undefined) node['regionId'] = regionId;
				return node;
			},
		),
		junctions: entityTable(
			document.junctions,
			({ operator, groupId, laneId, regionId, layoutOrder }) => {
				const junction: TomlTable = { operator, layoutOrder };
				if (groupId !== undefined) junction['group'] = groupId;
				if (laneId !== undefined) junction['lane'] = laneId;
				if (regionId !== undefined) junction['regionId'] = regionId;
				return junction;
			},
		),
		relations: entityTable(document.relations, ({ from, to }) => ({ from, to })),
	});
}
