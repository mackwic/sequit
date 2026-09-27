import {
	defined,
	EndpointKind,
	LayoutPolicy,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import type { GridCellInput } from '../../../src/lib/core/layout/grids/grid-cell-types';
import type { RegionInput } from '../../../src/lib/core/layout/regions/model/region-composition-types';

export function independentNodes(count: number): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'resource-calibration',
		title: 'Resource calibration',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes: Array.from({ length: count }, (_, index) => ({
			kind: EndpointKind.Node as const,
			id: `node-${index}`,
			natureId: 'task',
			markdown: `Node ${index}\n`,
			layoutOrder: orderKey(`a${index.toString().padStart(3, '0')}1`),
		})),
		relations: [],
	};
}

export function gridOf(
	columns: number,
	rows: number,
): { document: LogicDocument; input: GridCellInput } {
	const document = independentNodes(columns * rows);
	const cells = document.nodes.map((_, index) => ({
		id: `cell-${index}`,
		parentId: '@root',
		row: Math.floor(index / columns),
		column: index % columns,
	}));
	return {
		document,
		input: {
			rootId: '@root',
			cells,
			cellByEndpointId: new Map(document.nodes.map((node, index) => [node.id, `cell-${index}`])),
			minimumColumnWidths: Array.from({ length: columns }, () => 100),
			minimumRowHeights: Array.from({ length: rows }, () => 80),
		},
	};
}

/** Seven ordinary local nodes yield 21 distinct acyclic relations inside one grid cell. */
export function gridWithLocalRelations(): { document: LogicDocument; input: GridCellInput } {
	const base = gridOf(2, 2);
	const localNodes = independentNodes(7).nodes;
	const firstCell = base.input.cells[0];
	if (firstCell === undefined) throw new Error('Expected a grid cell');
	return {
		document: {
			...base.document,
			nodes: [
				...base.document.nodes,
				...localNodes.map((node) => ({ ...node, id: `local-${node.id}` })),
			],
			relations: localNodes.flatMap((source, index) =>
				localNodes.slice(index + 1).map((target) => ({
					id: `local-${source.id}-${target.id}`,
					from: `local-${source.id}`,
					to: `local-${target.id}`,
				})),
			),
		},
		input: {
			...base.input,
			cellByEndpointId: new Map([
				...base.input.cellByEndpointId,
				...localNodes.map((node) => [`local-${node.id}`, firstCell.id] as const),
			]),
		},
	};
}

export function rowOf(count: number): { document: LogicDocument; input: RegionInput } {
	const document = independentNodes(count);
	return {
		document,
		input: {
			regions: [
				{ id: '@root', layoutOrder: '0' },
				...document.nodes.map((_, index) => ({
					id: `child-${index}`,
					parentId: '@root',
					layoutOrder: orderKey(`a${index.toString().padStart(3, '0')}1`),
				})),
			],
			regionByEndpointId: new Map(document.nodes.map((node, index) => [node.id, `child-${index}`])),
		},
	};
}

/** The same row presented through the persisted document/product entry. */
export function persistedRowOf(count: number): LogicDocument {
	const { document, input } = rowOf(count);
	return {
		...document,
		persistenceFormat: REGION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_PRESENTATION_SCHEMA,
			regions: input.regions
				.filter(({ parentId }) => parentId !== undefined)
				.map(({ id, parentId, layoutOrder }) => ({
					id,
					parentId: defined(parentId),
					layoutOrder: orderKey(layoutOrder),
					policy: LayoutPolicy.Layered,
				})),
		},
		nodes: document.nodes.map((node) => ({
			...node,
			regionId: defined(input.regionByEndpointId.get(node.id)),
		})),
	};
}

export function forestOf(
	arms: number,
	armLength: number,
): { document: LogicDocument; input: RegionInput } {
	const document = independentNodes(arms);
	const regions: RegionInput['regions'][number][] = [{ id: '@root', layoutOrder: '0' }];
	const assignments = new Map<string, string>();
	for (let arm = 0; arm < arms; arm += 1) {
		for (let depth = 0; depth < armLength; depth += 1) {
			const id = `arm-${arm}-depth-${depth}`;
			let parentId = '@root';
			if (depth > 0) parentId = `arm-${arm}-depth-${depth - 1}`;
			regions.push({
				id,
				parentId,
				layoutOrder: orderKey(`a${arm}`),
			});
		}
		assignments.set(`node-${arm}`, `arm-${arm}-depth-${armLength - 1}`);
	}
	return { document, input: { regions, regionByEndpointId: assignments } };
}

/** 1 root + 8 arms + 64 branches + 192 populated leaves: 265 regions at depth four. */
export function shallowForestOf(leafCount: number): {
	document: LogicDocument;
	input: RegionInput;
} {
	const document = independentNodes(leafCount);
	const regions: RegionInput['regions'][number][] = [{ id: '@root', layoutOrder: '0' }];
	const assignments = new Map<string, string>();
	for (let arm = 0; arm < 8; arm += 1) {
		regions.push({ id: `arm-${arm}`, parentId: '@root', layoutOrder: orderKey(`a${arm}1`) });
		for (let branch = 0; branch < 8; branch += 1) {
			const parentId = `arm-${arm}-branch-${branch}`;
			regions.push({ id: parentId, parentId: `arm-${arm}`, layoutOrder: orderKey(`a${branch}1`) });
			for (let child = 0; child < 3; child += 1) {
				const index = (arm * 8 + branch) * 3 + child;
				if (index >= leafCount) continue;
				const id = `leaf-${index}`;
				regions.push({ id, parentId, layoutOrder: orderKey(`a${child}1`) });
				assignments.set(`node-${index}`, id);
			}
		}
	}
	return { document, input: { regions, regionByEndpointId: assignments } };
}

/** Common normalization accepts 21 cells; the root grid proof still rejects its own envelope. */
export function gridRegionInput(input: GridCellInput): RegionInput {
	return {
		regions: [
			{ id: input.rootId, layoutOrder: '0' },
			...input.cells.map((cell) => ({
				id: cell.id,
				parentId: input.rootId,
				layoutOrder: orderKey(`a${cell.row}1${cell.column}1`),
			})),
		],
		regionByEndpointId: input.cellByEndpointId,
	};
}
