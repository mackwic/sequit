import {
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	type LogicNode,
	PERSISTENCE_FORMAT,
} from '../../../../lib/core/document/logic-document';
import { orderKey } from '../../../../lib/core/document/order-key';
import { createGraph } from '../../../../lib/core/graph/create-graph';
import { solveGridCellLayout } from '../../../../lib/core/layout/grid-cell-layout';
import {
	type GridCellInput,
	type GridCellLayoutAttempt,
	GridCellLayoutStatus,
} from '../../../../lib/core/layout/grid-cell-types';
import { validateGridCellGeometry } from '../../../../lib/core/layout/grid-cell-validation';
import type { LayoutMeasurements } from '../../../../lib/core/layout/layout-types';

function node(id: string, order: string, groupId?: string): LogicNode {
	const source: LogicNode = {
		kind: EndpointKind.Node,
		id,
		natureId: 'task',
		markdown: `${id}\n`,
		layoutOrder: orderKey(order),
	};
	if (groupId === undefined) return source;
	return { ...source, groupId };
}

function document(): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'grid-cell-witness',
		title: 'Grille 2×2 · rangs locaux 4 → 1',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'oversized',
				label: 'Groupe indivisible',
				layoutOrder: orderKey('a9'),
			},
		],
		junctions: [],
		nodes: [
			node('a0', 'a0'),
			node('a1', 'a1'),
			node('a2', 'a2'),
			node('a3', 'a3'),
			node('source4', 'a4'),
			node('b', 'a5', 'oversized'),
			node('c', 'a6'),
			node('target1', 'a7'),
			node('d0', 'a8'),
		],
		relations: [
			{ id: 'a-1-0', from: 'a1', to: 'a0' },
			{ id: 'a-2-1', from: 'a2', to: 'a1' },
			{ id: 'a-3-2', from: 'a3', to: 'a2' },
			{ id: 'a-4-3', from: 'source4', to: 'a3' },
			{ id: 'd-1-0', from: 'target1', to: 'd0' },
			{ id: 'across-grid', from: 'source4', to: 'target1' },
		],
	};
}

function gridInput(): GridCellInput {
	return {
		rootId: '@root',
		cells: [
			{ id: 'a', parentId: '@root', row: 0, column: 0 },
			{
				id: 'b',
				parentId: '@root',
				row: 0,
				column: 1,
				layout: { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
			},
			{ id: 'c', parentId: '@root', row: 1, column: 0 },
			{ id: 'd', parentId: '@root', row: 1, column: 1 },
		],
		cellByEndpointId: new Map([
			['a0', 'a'],
			['a1', 'a'],
			['a2', 'a'],
			['a3', 'a'],
			['source4', 'a'],
			['oversized', 'b'],
			['b', 'b'],
			['c', 'c'],
			['target1', 'd'],
			['d0', 'd'],
		]),
		minimumColumnWidths: [700, 100],
		minimumRowHeights: [50, 300],
	};
}

function measurements(source: LogicDocument): LayoutMeasurements {
	const nodes = new Map<string, { readonly width: number; readonly height: number }>();
	for (const { id } of source.nodes) nodes.set(id, { width: 120, height: 64 });
	return {
		nodes,
		groups: new Map([
			['oversized', { minimumWidth: 620, minimumHeight: 320, headerHeight: 36, padding: 24 }],
		]),
		junctions: new Map(),
	};
}

export interface GridCellWitness {
	readonly attempt: GridCellLayoutAttempt;
	readonly validation: string | undefined;
	readonly localRanks: ReadonlyMap<string, number>;
}

/** Runs the same graph, ranks, dedicated child layouts, and geometric oracle as the core proof. */
export function runGridCellWitness(): GridCellWitness {
	const source = document();
	const prepared = createGraph(source);
	if (!prepared.ok) throw new Error('The grid witness document must form a valid source graph.');
	const input = gridInput();
	const attempt = solveGridCellLayout(prepared.value, measurements(source), input);
	const localRanks = new Map<string, number>();
	let validation: string | undefined;
	if (attempt.status === GridCellLayoutStatus.Selected) {
		validation = validateGridCellGeometry(attempt, prepared.value, input);
		for (const cell of attempt.cells) {
			for (const [id, rank] of cell.localRanks.byEndpointId) localRanks.set(id, rank);
		}
	}
	return { attempt, validation, localRanks };
}
