import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentProjection } from '../../../../src/app/web/projection/document-projection';
import {
	LayoutFailureReasonCode,
	LayoutProjectionError,
} from '../../../../src/app/web/projection/layout-diagnostic';
import * as layout from '../../../../src/app/web/projection/layout-graph';
import { createSharedCanvasProjection } from '../../../../src/app/web/projection/open-document';
import { renderRelationPaths } from '../../../../src/app/web/ui/canvas/render-relations';
import {
	defined,
	GRID_REGION_PRESENTATION_SCHEMA,
	GroupState,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
	type RootLayoutPresentation,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import * as graph from '../../../../src/lib/core/graph/create-graph';
import { unbridgedContacts } from '../../../../src/lib/core/layout/bridges/bridge-contact';
import { validatedBridges } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { persistedGridDocument } from '../../../lib/core/layout/grid-cell-fixture';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import { validLogicDocument } from '../../../support/builders/logic-document';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

afterEach(() => vi.restoreAllMocks());

describe('live document projection', () => {
	it('invalidates persisted grid track edits and matches a cold projection', async () => {
		const source = persistedGridDocument();
		const presentation = defined(source.regionPresentation);
		if (presentation.schemaVersion !== GRID_REGION_PRESENTATION_SCHEMA)
			throw new Error('Expected a grid presentation');
		const grid = defined(presentation.grid);
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const initial = await projection.createCanvasModel(sizes);
		expect(initial.regions?.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
		const permuted: LogicDocument = {
			...source,
			regionPresentation: {
				...presentation,
				grid: { ...grid, cells: [...grid.cells].reverse() },
			},
		};
		expect(projection.update(permuted)).toBe(false);
		const changed: LogicDocument = {
			...permuted,
			regionPresentation: {
				...presentation,
				grid: { ...grid, minimumColumnWidths: [1000, 100] },
			},
		};
		expect(projection.update(changed)).toBe(true);
		const incremental = await projection.createCanvasModel(sizes);
		const cold = new DocumentProjection(changed);
		expect(incremental).toEqual(
			await cold.createCanvasModel(layoutMeasurementsForCanvas(cold.measurementModel)),
		);
		expect(incremental.regions).not.toEqual(initial.regions);
		const swapped: LogicDocument = {
			...changed,
			regionPresentation: {
				...presentation,
				grid: {
					...grid,
					cells: grid.cells.map((cell) => {
						if (cell.regionId === 'a') return { ...cell, row: 1 as const };
						if (cell.regionId === 'c') return { ...cell, row: 0 as const };
						return cell;
					}),
				},
			},
		};
		expect(projection.update(swapped)).toBe(true);
	});

	it('invalidates region ownership and order but reuses a permuted region definition', () => {
		const prepare = vi.spyOn(graph, 'createGraph');
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const document: LogicDocument = {
			...source,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_PRESENTATION_SCHEMA,
				regions: [
					{ id: 'left', layoutOrder: orderKey('a0'), policy: LayoutPolicy.Layered },
					{ id: 'right', layoutOrder: orderKey('a1'), policy: LayoutPolicy.Layered },
				],
			},
			nodes: source.nodes.map((node) => {
				if (node.id === 'A') return { ...node, regionId: 'left' };
				return { ...node, regionId: 'right' };
			}),
		};
		const projection = new DocumentProjection(document);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(
			projection.update({
				...document,
				regionPresentation: {
					...defined(document.regionPresentation),
					regions: [...defined(document.regionPresentation).regions].reverse(),
				},
			}),
		).toBe(false);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(
			projection.update({
				...document,
				nodes: document.nodes.map((node) => {
					if (node.id === 'A') return { ...node, regionId: 'right' };
					return node;
				}),
			}),
		).toBe(true);
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(
			projection.update({
				...document,
				regionPresentation: {
					...defined(document.regionPresentation),
					regions: defined(document.regionPresentation).regions.map((region) => {
						if (region.id === 'left') return { ...region, layoutOrder: orderKey('a2') };
						return region;
					}),
				},
			}),
		).toBe(true);
		expect(prepare).toHaveBeenCalledTimes(3);
	});

	it('invalidates lane presentation and assignment edits but reuses a permuted lane collection', async () => {
		const prepare = vi.spyOn(graph, 'createGraph');
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		const presentation = {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'sales', label: 'Sales', layoutOrder: orderKey('a0') },
				{ id: 'customer', label: 'Customer', layoutOrder: orderKey('a1') },
			],
		} satisfies RootLayoutPresentation;
		const document: LogicDocument = {
			...source,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation,
			nodes: source.nodes.map((node) => {
				if (node.id === 'A') return { ...node, laneId: 'sales' };
				return { ...node, laneId: 'customer' };
			}),
		};
		expect(validateLogicDocument(document).ok).toBe(true);
		const projection = new DocumentProjection(document);
		const shared = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		expect(shared.lanes?.map(({ id }) => id)).toEqual(['sales', 'customer']);
		expect(shared.relations.map(({ id }) => id)).toEqual(['R']);
		const permuted: LogicDocument = {
			...document,
			presentation: {
				...presentation,
				lanes: [...presentation.lanes].reverse(),
			},
		};
		expect(projection.update(permuted)).toBe(false);
		expect(prepare).toHaveBeenCalledTimes(1);
		const incremental = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		expect(incremental).toEqual(shared);

		const reoriented: LogicDocument = {
			...permuted,
			presentation: {
				...defined(permuted.presentation),
				laneOrientation: LaneOrientation.Transverse,
			},
		};
		expect(projection.update(reoriented)).toBe(true);
		expect(prepare).toHaveBeenCalledTimes(2);

		const reordered: LogicDocument = {
			...reoriented,
			presentation: {
				...defined(reoriented.presentation),
				lanes: defined(reoriented.presentation).lanes.map((lane) => {
					if (lane.id === 'sales') return { ...lane, layoutOrder: orderKey('a2') };
					return lane;
				}),
			},
		};
		expect(projection.update(reordered)).toBe(true);
		expect(prepare).toHaveBeenCalledTimes(3);

		const reassigned: LogicDocument = {
			...reordered,
			nodes: reordered.nodes.map((node) => {
				if (node.id === 'A') return { ...node, laneId: 'customer' };
				return node;
			}),
		};
		expect(validateLogicDocument(reassigned).ok).toBe(true);
		expect(projection.update(reassigned)).toBe(true);
		expect(prepare).toHaveBeenCalledTimes(4);
		const transverse = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		expect(transverse.lanes?.map(({ id }) => id)).toEqual(['customer', 'sales']);
		const unsupported: LogicDocument = {
			...reassigned,
			presentation: {
				...defined(reassigned.presentation),
				lanes: [
					...defined(reassigned.presentation).lanes,
					{ id: 'legal', label: 'Legal', layoutOrder: orderKey('a3') },
					{ id: 'finance', label: 'Finance', layoutOrder: orderKey('a4') },
				],
			},
		};
		expect(validateLogicDocument(unsupported).ok).toBe(true);
		expect(projection.update(unsupported)).toBe(true);
		expect(prepare).toHaveBeenCalledTimes(5);
		await expect(
			projection.createCanvasModel(layoutMeasurementsForCanvas(projection.measurementModel)),
		).rejects.toThrow(/Shared lane layout is unsupported/);
		expect(projection.update(document)).toBe(true);
		expect(
			await projection.createCanvasModel(layoutMeasurementsForCanvas(projection.measurementModel)),
		).toEqual(shared);
	});

	it('keeps inherited documents cache-equivalent without an explicit presentation', async () => {
		const calculate = vi.spyOn(layout, 'layoutGraphForProjection');
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		expect(source.persistenceFormat).toBe(PERSISTENCE_FORMAT);
		expect(source.presentation).toBeUndefined();
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const before = await projection.createCanvasModel(sizes);
		expect(
			projection.update({
				...source,
				nodes: source.nodes.map((node) => ({ ...node })),
			}),
		).toBe(false);
		const after = await projection.createCanvasModel(sizes);
		expect(after).toEqual(before);
		expect(after.relations).toBe(before.relations);
		expect(calculate).toHaveBeenCalledTimes(1);
	});

	it('reuses geometry across collection permutations and invalidates topology and document order edits', async () => {
		const calculate = vi.spyOn(layout, 'layoutGraphForProjection');
		const original = validLogicDocument();
		const source = {
			...original,
			junctions: [
				...original.junctions,
				{
					...defined(original.junctions[0]),
					id: 'choice-b',
					layoutOrder: orderKey('a8'),
				},
			],
		};
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const before = await projection.createCanvasModel(sizes);
		const permuted = {
			...source,
			groups: [...source.groups].reverse(),
			nodes: [...source.nodes].reverse(),
			junctions: [...source.junctions].reverse(),
			relations: [...source.relations].reverse(),
		};
		projection.update(permuted);
		const reused = await projection.createCanvasModel(sizes);
		expect(calculate).toHaveBeenCalledTimes(1);
		expect(reused.relations).toBe(before.relations);
		expect(new Map(reused.nodes.map(({ id, bounds }) => [id, bounds]))).toEqual(
			new Map(before.nodes.map(({ id, bounds }) => [id, bounds])),
		);

		const changedRelation = {
			...permuted,
			relations: permuted.relations.map((relation) => {
				if (relation.id === 'group-to-target') return { ...relation, to: 'isolated' };
				return relation;
			}),
		};
		expect(projection.update(changedRelation)).toBe(true);
		await projection.createCanvasModel(sizes);
		expect(calculate).toHaveBeenCalledTimes(2);

		expect(
			projection.update({
				...changedRelation,
				nodes: changedRelation.nodes.map((node) => {
					if (node.id === 'source-a') return { ...node, layoutOrder: orderKey('a9') };
					return node;
				}),
			}),
		).toBe(true);
		await projection.createCanvasModel(sizes);
		expect(calculate).toHaveBeenCalledTimes(3);
	});

	it('keeps a source-valid group folded across a visible false cycle', async () => {
		const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'room');
		const first = defined(source.nodes[0]);
		const document = {
			...source,
			groups: source.groups.map((group) => ({
				...group,
				state: GroupState.Closed,
			})),
			nodes: [
				...source.nodes,
				{
					kind: first.kind,
					id: 'C',
					natureId: 'N',
					markdown: 'Outside',
					layoutOrder: orderKey('a3'),
				},
			],
			relations: [
				{ id: 'one', from: 'B', to: 'C' },
				{ id: 'two', from: 'C', to: 'A' },
			],
		};
		const projection = createSharedCanvasProjection(document);
		expect(projection.warning).toBeUndefined();
		expect(projection.visible.hiddenEndpointIds).toEqual(new Set(['A', 'B']));
		const canvas = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		expect(canvas.groups.map(({ id }) => id)).toEqual(['G']);
		expect(canvas.nodes.map(({ id }) => id)).toEqual(['C']);
		expect(canvas.relations.map(({ id, from, to }) => ({ id, from, to }))).toEqual([
			{ id: 'one', from: 'G', to: 'C' },
			{ id: 'two', from: 'C', to: 'G' },
		]);
		expect(canvas.relations.map(({ sourceRelationIds }) => sourceRelationIds)).toEqual([
			['one'],
			['two'],
		]);
		const subscriber = vi.fn();
		projection.subscribe(subscriber);
		projection.update(document);
		expect(subscriber).not.toHaveBeenCalled();
		const changed = {
			...document,
			nodes: document.nodes.map((node) => {
				if (node.id === 'C') return { ...node, markdown: 'Changed outside' };
				return node;
			}),
		};
		projection.update(changed);
		expect(subscriber).toHaveBeenCalledOnce();
		const incremental = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		const cold = createSharedCanvasProjection(changed);
		expect(incremental).toEqual(
			await cold.createCanvasModel(layoutMeasurementsForCanvas(cold.measurementModel)),
		);
		projection.update(source);
		expect(projection.warning).toBeUndefined();
		expect(projection.visible.hiddenEndpointIds.size).toBe(0);
	});

	it('reports an unresolved folded shape without exposing its hidden members', async () => {
		const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'room');
		const outside = defined(collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room').nodes[0]);
		const document: LogicDocument = {
			...source,
			groups: source.groups.map((group) => ({
				...group,
				state: GroupState.Closed,
			})),
			nodes: [
				...source.nodes,
				{ ...outside, id: 'C', layoutOrder: orderKey('a3') },
				{ ...outside, id: 'D', layoutOrder: orderKey('a4') },
			],
			relations: [
				{ id: 'one', from: 'B', to: 'C' },
				{ id: 'two', from: 'C', to: 'A' },
			],
		};
		const projection = createSharedCanvasProjection(document);
		expect(projection.visible.hiddenEndpointIds).toEqual(new Set(['A', 'B']));
		await expect(
			projection.createCanvasModel(layoutMeasurementsForCanvas(projection.measurementModel)),
		).rejects.toMatchObject({
			name: LayoutProjectionError.name,
			diagnostic: {
				reason: { code: LayoutFailureReasonCode.UnknownFoldedGroupLayout },
			},
		});
	});

	it('keeps an accepted folded snapshot when a malformed source update fails projection', async () => {
		const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'room');
		const outside = defined(collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room').nodes[0]);
		const folded: LogicDocument = {
			...source,
			groups: source.groups.map((group) => ({ ...group, state: GroupState.Closed })),
			nodes: [...source.nodes, { ...outside, id: 'C', layoutOrder: orderKey('a3') }],
			relations: [
				{ id: 'outward', from: 'B', to: 'C' },
				{ id: 'inward', from: 'C', to: 'A' },
			],
		};
		const projection = createSharedCanvasProjection(folded);
		const before = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		const missingEndpoint = {
			...folded,
			relations: [...folded.relations, { id: 'missing', from: 'C', to: 'absent' }],
		};
		expect(() => {
			projection.update(missingEndpoint);
		}).toThrow();
		const sourceCycle = {
			...folded,
			relations: [...folded.relations, { id: 'cycle', from: 'A', to: 'B' }],
		};
		expect(() => {
			projection.update(sourceCycle);
		}).toThrow();
		expect(
			await projection.createCanvasModel(layoutMeasurementsForCanvas(projection.measurementModel)),
		).toEqual(before);
	});

	it('projects a long lane crossing and a neighboring relation together', async () => {
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const first = defined(source.nodes[0]);
		const document: LogicDocument = {
			...source,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation: LaneOrientation.Parallel,
				growth: LaneGrowth.Auto,
				lanes: [
					{ id: 'left', label: 'Left', layoutOrder: orderKey('a0') },
					{ id: 'middle', label: 'Middle', layoutOrder: orderKey('a1') },
					{ id: 'right', label: 'Right', layoutOrder: orderKey('a2') },
				],
			},
			nodes: [
				...source.nodes.map((node) => {
					let laneId = 'middle';
					if (node.id === 'A') laneId = 'left';
					return { ...node, laneId };
				}),
				{ ...first, id: 'C', laneId: 'right', layoutOrder: orderKey('a3') },
			],
			relations: [
				{ id: 'a-to-c', from: 'A', to: 'C' },
				{ id: 'b-to-c', from: 'B', to: 'C' },
			],
		};
		const projection = createSharedCanvasProjection(document);
		const canvas = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		expect(canvas.lanes?.map(({ id }) => id)).toEqual(['left', 'middle', 'right']);
		expect(canvas.relations.map(({ id }) => id)).toEqual(['a-to-c', 'b-to-c']);
	});
	it('resolves the same-lane and inter-lane crossing through validated bridges from the real projection', async () => {
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const first = defined(source.nodes[0]);
		const document: LogicDocument = {
			...source,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation: LaneOrientation.Parallel,
				growth: LaneGrowth.Auto,
				lanes: [
					{ id: 'A', label: 'A', layoutOrder: orderKey('a0') },
					{ id: 'B', label: 'B', layoutOrder: orderKey('a1') },
				],
			},
			nodes: [
				...source.nodes.map((node) => ({ ...node, laneId: 'A' })),
				{ ...first, id: 'C', laneId: 'B', layoutOrder: orderKey('a3') },
			],
			relations: [
				{ id: 'internal', from: 'A', to: 'B' },
				{ id: 'first-cross', from: 'A', to: 'C' },
				{ id: 'second-cross', from: 'B', to: 'C' },
			],
		};
		const projection = createSharedCanvasProjection(document);
		const canvas = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		expect(canvas.relations.map(({ id }) => id).sort()).toEqual([
			'first-cross',
			'internal',
			'second-cross',
		]);
		// The root lane solver accepts the crossing in its second pass, carried by a validated bridge.
		const bridges = validatedBridges(canvas.relations);
		expect(bridges.length).toBeGreaterThan(0);
		for (const [index, route] of canvas.relations.entries())
			for (const other of canvas.relations.slice(index + 1))
				expect(unbridgedContacts(route, other, bridges)).toEqual([]);
	});
	it('reuses geometry for text/style changes of equal measured size and keeps each result immutable', async () => {
		const calculate = vi.spyOn(layout, 'layoutGraphForProjection');
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const before = await projection.createCanvasModel(sizes);
		expect(
			projection.update({
				...source,
				nodes: source.nodes.map((node) => ({
					...node,
					markdown: 'Changed',
					color: '#abcdef',
				})),
			}),
		).toBe(true);
		const after = await projection.createCanvasModel(sizes);
		expect(after.nodes[0]?.markdown).toBe('Changed');
		expect(after.nodes[0]?.color).toBe('#abcdef');
		expect(before.nodes[0]?.markdown).toBe('Alpha');
		expect(after.nodes.map(({ bounds }) => bounds)).toEqual(
			before.nodes.map(({ bounds }) => bounds),
		);
		expect(after.relations).toBe(before.relations);
		expect(renderRelationPaths(after.relations)).toEqual(renderRelationPaths(before.relations));
		expect(calculate).toHaveBeenCalledTimes(1);
	});

	it('retains relation identity through shared text snapshots with equivalent provenance', async () => {
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		const projection = createSharedCanvasProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const before = await projection.createCanvasModel(sizes);
		projection.update({
			...source,
			nodes: source.nodes.map((node) => ({
				...node,
				markdown: 'New text',
				color: '#abcdef',
			})),
		});
		const after = await projection.createCanvasModel(sizes);
		expect(after.nodes[0]).toMatchObject({
			markdown: 'New text',
			color: '#abcdef',
		});
		expect(after.relations).toBe(before.relations);
		expect(after.relations[0]?.sourceRelationIds).toEqual(['R']);
	});

	it('refreshes aggregate source relations and editing capabilities without recalculating geometry', async () => {
		const calculate = vi.spyOn(layout, 'layoutGraphForProjection');
		const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'room');
		const outside = defined(collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room').nodes[0]);
		const document = {
			...source,
			groups: source.groups.map((group) => ({
				...group,
				state: GroupState.Closed,
			})),
			nodes: [...source.nodes, { ...outside, id: 'C', layoutOrder: orderKey('a3') }],
			relations: [
				{ id: 'R1', from: 'A', to: 'C' },
				{ id: 'R2', from: 'B', to: 'C' },
			],
		};
		const projection = createSharedCanvasProjection(document);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const before = await projection.createCanvasModel(sizes);
		const changedSources = {
			...document,
			relations: document.relations.map((relation) => {
				if (relation.id === 'R2') return { ...relation, id: 'R3' };
				return relation;
			}),
		};
		projection.update(changedSources);
		const changed = await projection.createCanvasModel(sizes);
		expect(changed.relations).not.toBe(before.relations);
		expect(changed.relations[0]?.points).toBe(before.relations[0]?.points);
		expect(changed.relations[0]?.sourceRelationIds).toEqual(['R1', 'R3']);
		expect(before.relations[0]?.sourceRelationIds).toEqual(['R1', 'R2']);
		projection.update({
			...changedSources,
			relations: [...changedSources.relations, { id: 'R4', from: 'A', to: 'C' }],
		});
		const threeSources = await projection.createCanvasModel(sizes);
		expect(threeSources.relations).not.toBe(changed.relations);
		expect(threeSources.relations[0]?.points).toBe(changed.relations[0]?.points);
		expect(threeSources.relations[0]).toMatchObject({
			sourceRelationIds: ['R1', 'R3', 'R4'],
			canChangeFrom: false,
			canChangeTo: false,
		});
		projection.update({
			...changedSources,
			relations: changedSources.relations.filter(({ id }) => id === 'R1'),
		});
		const single = await projection.createCanvasModel(sizes);
		expect(single.relations).not.toBe(changed.relations);
		expect(single.relations[0]).toMatchObject({
			sourceRelationIds: ['R1'],
			canChangeFrom: false,
			canChangeTo: true,
		});
		expect(changed.relations[0]?.canChangeTo).toBe(false);
		projection.update({
			...document,
			relations: [{ id: 'R1', from: 'G', to: 'C' }],
		});
		const direct = await projection.createCanvasModel(sizes);
		expect(direct.relations).not.toBe(single.relations);
		expect(direct.relations[0]?.points).toBe(single.relations[0]?.points);
		expect(direct.relations[0]).toMatchObject({
			sourceRelationIds: ['R1'],
			canChangeFrom: true,
			canChangeTo: true,
		});
		expect(single.relations[0]?.canChangeFrom).toBe(false);
		expect(calculate).toHaveBeenCalledTimes(1);
	});

	it('invalidates geometry for topology, direction and measured-size changes', async () => {
		const calculate = vi.spyOn(layout, 'layoutGraphForProjection');
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		await projection.createCanvasModel(sizes);
		const linked = {
			...source,
			relations: [{ id: 'link', from: 'B', to: 'A' }],
		};
		expect(projection.update(linked)).toBe(true);
		const connected = await projection.createCanvasModel(sizes);
		expect(connected.relations).toHaveLength(1);
		projection.update({
			...linked,
			layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		});
		const rotated = await projection.createCanvasModel(sizes);
		expect(rotated.direction).toBe(LayoutDirection.LeftToRight);
		expect(rotated.relations).not.toBe(connected.relations);
		const larger = { ...sizes, nodes: new Map(sizes.nodes) };
		larger.nodes.set('A', { width: 400, height: 200 });
		const resized = await projection.createCanvasModel(larger);
		expect(resized.nodes.find(({ id }) => id === 'A')?.bounds.width).toBe(400);
		expect(resized.relations).not.toBe(rotated.relations);
		expect(renderRelationPaths(resized.relations)).not.toEqual(
			renderRelationPaths(rotated.relations),
		);
		expect(calculate).toHaveBeenCalledTimes(4);
	});

	it('keeps relation caches local to each opened document', async () => {
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		const first = new DocumentProjection(source);
		const second = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(first.measurementModel);
		const original = await first.createCanvasModel(sizes);
		const independent = await second.createCanvasModel(sizes);
		expect(independent.relations).toEqual(original.relations);
		expect(independent.relations).not.toBe(original.relations);
		expect((await first.createCanvasModel(sizes)).relations).toBe(original.relations);
	});

	it('publishes visible changes only, retaining geometry and the current scene on invalid snapshots', () => {
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const projection = createSharedCanvasProjection(source);
		const measurement = projection.measurementModel;
		const changed = vi.fn();
		projection.subscribe(() => {
			throw new Error('Broken view');
		});
		const stop = projection.subscribe(changed);
		projection.update({
			...source,
			title: 'New title',
			nodes: source.nodes.map((node) => ({
				...node,
				description: '# Details',
			})),
		});
		expect(projection.measurementModel).toBe(measurement);
		expect(changed).not.toHaveBeenCalled();
		expect(() => {
			projection.update({
				...source,
				relations: [{ id: 'bad', from: 'A', to: 'missing' }],
			});
		}).toThrow();
		expect(projection.measurementModel).toBe(measurement);
		projection.update({
			...source,
			nodes: source.nodes.map((node) => ({ ...node, markdown: 'Visible' })),
		});
		expect(changed).toHaveBeenCalledOnce();
		stop();
		projection.update(source);
		expect(changed).toHaveBeenCalledOnce();
	});

	it('captures the requested snapshot even when a newer update arrives before layout resolves', async () => {
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const pending = projection.createCanvasModel(sizes);
		projection.update({
			...source,
			nodes: source.nodes.map((node) => ({ ...node, markdown: 'Later' })),
		});
		expect((await pending).nodes[0]?.markdown).toBe('Alpha');
		expect((await projection.createCanvasModel(sizes)).nodes[0]?.markdown).toBe('Later');
	});

	it('retries a failed calculation instead of retaining a rejected promise', async () => {
		const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		vi.spyOn(layout, 'layoutGraphForProjection').mockRejectedValueOnce(
			new Error('Temporary layout failure'),
		);
		await expect(projection.createCanvasModel(sizes)).rejects.toThrow('Temporary');
		await expect(projection.createCanvasModel(sizes)).resolves.toMatchObject({
			nodes: [{ id: 'A' }, { id: 'B' }],
		});
	});

	it('keeps a newer geometry and its relations cached when an earlier calculation fails late', async () => {
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
		const projection = new DocumentProjection(source);
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		const delayed = Promise.withResolvers<layout.LayoutResult>();
		const calculate = vi
			.spyOn(layout, 'layoutGraphForProjection')
			.mockReturnValueOnce(delayed.promise);
		const obsolete = projection.createCanvasModel(sizes);
		const larger = { ...sizes, nodes: new Map(sizes.nodes) };
		larger.nodes.set('A', { width: 400, height: 200 });
		const current = await projection.createCanvasModel(larger);
		const rejection = expect(obsolete).rejects.toThrow('Obsolete failure');
		delayed.reject(new Error('Obsolete failure'));
		await rejection;
		const retained = await projection.createCanvasModel(larger);
		expect(retained.nodes.find(({ id }) => id === 'A')?.bounds.width).toBe(400);
		expect(retained.relations).toBe(current.relations);
		expect(calculate).toHaveBeenCalledTimes(2);
	});
});
