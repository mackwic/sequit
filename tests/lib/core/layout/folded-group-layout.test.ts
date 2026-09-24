import { describe, expect, it } from 'vitest';

import { validateFoldedRouteGeometry } from '../../../../src/app/workshop/visual-tests/solver-prototype/folded-route-validator';
import {
	FoldedAttachmentRole as WitnessAttachmentRole,
	type FoldedRouteGeometry,
	foldedRouteWitnessDocument,
	FoldedSideFace as WitnessSideFace,
} from '../../../../src/app/workshop/visual-tests/solver-prototype/folded-route-witness';
import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	defined,
	EndpointKind,
	GroupState,
	JunctionOperator,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import {
	FoldedAttachmentRole,
	type FoldedGroupLayoutAttempt,
	FoldedGroupLayoutKind,
	FoldedGroupUnknownReason,
	FoldedSideFace,
	tryLayoutFoldedGroup,
} from '../../../../src/lib/core/layout/folded-group-layout';
import type { LayoutMeasurements } from '../../../../src/lib/core/layout/layout-types';
import { normalizeVisibleOwnership } from '../../../../src/lib/core/layout/visible-ownership';

const directions = [
	LayoutDirection.TopToBottom,
	LayoutDirection.BottomToTop,
	LayoutDirection.LeftToRight,
	LayoutDirection.RightToLeft,
] as const;

function sourceGraph(document: LogicDocument): LogicGraph {
	const result = createGraph(document);
	if (!result.ok) throw new Error(`Invalid test source: ${JSON.stringify(result.diagnostics)}`);
	return result.value;
}

function measurements(
	groupWidth = 260,
	groupHeight = 240,
	externalWidth = 120,
	externalHeight = 80,
): LayoutMeasurements {
	return {
		groups: new Map([
			[
				'G',
				{
					minimumWidth: groupWidth,
					minimumHeight: groupHeight,
					headerHeight: 36,
					padding: 20,
				},
			],
		]),
		nodes: new Map([['x', { width: externalWidth, height: externalHeight }]]),
		junctions: new Map(),
	};
}

function attempt(
	document: LogicDocument,
	visibleMeasurements = measurements(),
	groupIds: readonly string[] = ['G'],
): FoldedGroupLayoutAttempt {
	const graph = sourceGraph(document);
	return tryLayoutFoldedGroup(graph, topologicallyRank(graph), visibleMeasurements, groupIds);
}

function independentGeometry(
	document: LogicDocument,
	result: Extract<FoldedGroupLayoutAttempt, { kind: FoldedGroupLayoutKind.Supported }>,
): FoldedRouteGeometry {
	const graph = sourceGraph(document);
	const provenance = new Map(
		result.relationProvenance.map(({ relationId, sourceRelationIds }) => [
			relationId,
			sourceRelationIds,
		]),
	);
	return {
		direction: document.layout.direction,
		normalized: result.ownership,
		sourceRanks: [...topologicallyRank(graph).byEndpointId]
			.map(([endpointId, rank]) => ({ endpointId, rank }))
			.sort((a, b) => compareCanonicalStrings(a.endpointId, b.endpointId)),
		boxes: result.layout.elements.map(({ id, bounds }) => ({ id, bounds })),
		attachments: result.attachments.map((attachment) => {
			let role = WitnessAttachmentRole.Target;
			if (attachment.role === FoldedAttachmentRole.Source) role = WitnessAttachmentRole.Source;
			let face = WitnessSideFace.Bottom;
			if (attachment.face === FoldedSideFace.Left) face = WitnessSideFace.Left;
			if (attachment.face === FoldedSideFace.Right) face = WitnessSideFace.Right;
			if (attachment.face === FoldedSideFace.Top) face = WitnessSideFace.Top;
			return { ...attachment, role, face };
		}),
		routes: result.layout.relations.map(({ id, points }) => ({
			relationId: id,
			sourceRelationIds: provenance.get(id) ?? [],
			points,
		})),
	};
}

describe('folded group layout policy', () => {
	it.each(directions)('lays out the source-valid folded witness in %s', (direction) => {
		const document = foldedRouteWitnessDocument(direction);
		const result = attempt(document);
		expect(result.kind).toBe(FoldedGroupLayoutKind.Supported);
		if (result.kind !== FoldedGroupLayoutKind.Supported) return;
		expect(result.layout.elements.map(({ id }) => id)).toEqual(['G', 'x']);
		expect(result.layout.relations.map(({ id, from, to }) => ({ id, from, to }))).toEqual([
			{ id: 'B-to-x', from: 'G', to: 'x' },
			{ id: 'x-to-A', from: 'x', to: 'G' },
		]);
		expect(
			validateFoldedRouteGeometry(document, 'G', independentGeometry(document, result)),
		).toEqual({
			ok: true,
			diagnostics: [],
		});
	});

	it.each(directions)('uses measured dimensions and stays deterministic in %s', (direction) => {
		const document = foldedRouteWitnessDocument(direction);
		const small = attempt(document, measurements(180, 120, 42, 30));
		const large = attempt(document, measurements(530, 420, 260, 180));
		expect(small.kind).toBe(FoldedGroupLayoutKind.Supported);
		expect(large.kind).toBe(FoldedGroupLayoutKind.Supported);
		if (
			small.kind !== FoldedGroupLayoutKind.Supported ||
			large.kind !== FoldedGroupLayoutKind.Supported
		)
			return;
		expect(large.layout.width).toBeGreaterThan(small.layout.width);
		expect(large.layout.height).toBeGreaterThan(small.layout.height);
		for (const { result, minimumGroupWidth, minimumNodeHeight } of [
			{ result: small, minimumGroupWidth: 180, minimumNodeHeight: 30 },
			{ result: large, minimumGroupWidth: 530, minimumNodeHeight: 180 },
		]) {
			expect(
				validateFoldedRouteGeometry(document, 'G', independentGeometry(document, result)).ok,
			).toBe(true);
			const group = result.layout.elements.find(({ id }) => id === 'G');
			const node = result.layout.elements.find(({ id }) => id === 'x');
			expect(group?.bounds.width).toBeGreaterThanOrEqual(minimumGroupWidth);
			expect(node?.bounds.height).toBeGreaterThanOrEqual(minimumNodeHeight);
		}
		const shuffled: LogicDocument = {
			...document,
			groups: [...document.groups].reverse(),
			nodes: [...document.nodes].reverse(),
			relations: [...document.relations].reverse(),
		};
		expect(attempt(shuffled, measurements(530, 420, 260, 180))).toEqual(large);
		const tallHeader: LayoutMeasurements = {
			groups: new Map([
				[
					'G',
					{
						minimumWidth: 157.5,
						minimumHeight: 110.25,
						headerHeight: 180,
						padding: 50,
					},
				],
			]),
			nodes: new Map([['x', { width: 19.5, height: 12.75 }]]),
			junctions: new Map(),
		};
		const tall = attempt(document, tallHeader);
		expect(tall.kind).toBe(FoldedGroupLayoutKind.Supported);
		if (tall.kind === FoldedGroupLayoutKind.Supported)
			expect(
				validateFoldedRouteGeometry(document, 'G', independentGeometry(document, tall)).ok,
			).toBe(true);
	});

	it('keeps arbitrary source identifiers and both distinct incidences', () => {
		const document = foldedRouteWitnessDocument(LayoutDirection.TopToBottom);
		const ids = new Map([
			['G', 'group-17'],
			['A', 'node-alpha'],
			['B', 'node-beta'],
			['x', 'node-external'],
			['B-to-x', 'link-zz'],
			['x-to-A', 'link-aa'],
		]);
		const rename = (id: string) => ids.get(id) ?? id;
		const renamed: LogicDocument = {
			...document,
			groups: document.groups.map((group) => ({
				...group,
				id: rename(group.id),
			})),
			nodes: document.nodes.map((node) => {
				if (node.groupId === undefined) return { ...node, id: rename(node.id) };
				return { ...node, id: rename(node.id), groupId: rename(node.groupId) };
			}),
			relations: document.relations.map((relation) => ({
				id: rename(relation.id),
				from: rename(relation.from),
				to: rename(relation.to),
			})),
		};
		const result = attempt(
			renamed,
			{
				groups: new Map([
					[
						'group-17',
						{
							minimumWidth: 260,
							minimumHeight: 240,
							headerHeight: 36,
							padding: 20,
						},
					],
				]),
				nodes: new Map([['node-external', { width: 120, height: 80 }]]),
				junctions: new Map(),
			},
			['group-17'],
		);
		expect(result.kind).toBe(FoldedGroupLayoutKind.Supported);
		if (result.kind !== FoldedGroupLayoutKind.Supported) return;
		expect(result.layout.relations.map(({ id }) => id)).toEqual(['link-aa', 'link-zz']);
		expect(
			validateFoldedRouteGeometry(renamed, 'group-17', independentGeometry(renamed, result)),
		).toEqual({ ok: true, diagnostics: [] });
	});

	it('retains outermost visible ownership and source endpoints under nested folding', () => {
		const base = foldedRouteWitnessDocument(LayoutDirection.TopToBottom);
		const document: LogicDocument = {
			...base,
			groups: [
				...base.groups,
				{
					id: 'inner',
					kind: EndpointKind.Group,
					label: 'Inner',
					groupId: 'G',
					state: GroupState.Closed,
					layoutOrder: defined(base.groups[0]).layoutOrder,
				},
			],
			nodes: base.nodes.map((node) => {
				if (node.id === 'A') return { ...node, groupId: 'inner' };
				return node;
			}),
		};
		const normalized = normalizeVisibleOwnership(sourceGraph(document), ['inner', 'G']);
		expect(normalized.visibleOwners.map(({ id }) => id)).toEqual(['G', 'x']);
		expect(normalized.relations.find(({ id }) => id === 'x-to-A')?.to).toEqual({
			endpointId: 'A',
			visibleOwnerId: 'G',
		});
		expect(attempt(document).kind).toBe(FoldedGroupLayoutKind.Unknown);
	});

	it('reports unsupported source shapes instead of routing a false visible cycle', () => {
		const base = foldedRouteWitnessDocument(LayoutDirection.TopToBottom);
		const extraNode: LogicDocument = {
			...base,
			nodes: [...base.nodes, { ...defined(base.nodes.find(({ id }) => id === 'x')), id: 'y' }],
		};
		const missingReturn: LogicDocument = {
			...base,
			relations: [defined(base.relations[0])],
		};
		const expanded: LogicDocument = {
			...base,
			groups: base.groups.map((group) => ({
				...group,
				state: GroupState.Expanded,
			})),
		};
		const laneAssigned: LogicDocument = {
			...base,
			nodes: base.nodes.map((node) => {
				if (node.id === 'x') return { ...node, laneId: 'lane-1' };
				return node;
			}),
		};
		const groupLaneAssigned: LogicDocument = {
			...base,
			groups: base.groups.map((group) => ({ ...group, laneId: 'lane-1' })),
		};
		const independentJunction: LogicDocument = {
			...base,
			junctions: [
				{
					id: 'j',
					kind: EndpointKind.Junction,
					operator: JunctionOperator.Xor,
					layoutOrder: defined(base.nodes[0]).layoutOrder,
				},
			],
		};
		const twoOutwardRelations: LogicDocument = {
			...base,
			relations: [defined(base.relations[0]), { id: 'A-to-x', from: 'A', to: 'x' }],
		};
		const twoInwardRelations: LogicDocument = {
			...base,
			relations: [{ id: 'x-to-B', from: 'x', to: 'B' }, defined(base.relations[1])],
		};
		for (const document of [
			extraNode,
			missingReturn,
			expanded,
			laneAssigned,
			groupLaneAssigned,
			independentJunction,
			twoOutwardRelations,
			twoInwardRelations,
		]) {
			expect(attempt(document)).toMatchObject({
				kind: FoldedGroupLayoutKind.Unknown,
				reason: FoldedGroupUnknownReason.UnsupportedSourceShape,
			});
		}
		expect(attempt(base, measurements(), [])).toMatchObject({
			kind: FoldedGroupLayoutKind.Unknown,
			reason: FoldedGroupUnknownReason.UnsupportedSourceShape,
		});
		const actualSourceCycle: LogicDocument = {
			...base,
			relations: [defined(base.relations[0]), { ...defined(base.relations[1]), to: 'B' }],
		};
		expect(createGraph(actualSourceCycle).ok).toBe(false);
	});

	it('reports unsupported ranks, presentation and visible measurements', () => {
		const base = foldedRouteWitnessDocument(LayoutDirection.TopToBottom);
		const graph = sourceGraph(base);
		const ranks = topologicallyRank(graph);
		for (const endpointId of ['A', 'x', 'B']) {
			expect(
				tryLayoutFoldedGroup(
					graph,
					{
						...ranks,
						byEndpointId: new Map([...ranks.byEndpointId, [endpointId, 8]]),
					},
					measurements(),
					['G'],
				),
			).toMatchObject({
				kind: FoldedGroupLayoutKind.Unknown,
				reason: FoldedGroupUnknownReason.UnsupportedRanks,
			});
		}
		const withPresentation: LogicDocument = {
			...base,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation: LaneOrientation.Parallel,
				growth: LaneGrowth.Auto,
				lanes: [],
			},
		};
		expect(attempt(withPresentation)).toMatchObject({
			kind: FoldedGroupLayoutKind.Unknown,
			reason: FoldedGroupUnknownReason.UnsupportedPresentation,
		});
		expect(
			attempt(base, {
				groups: new Map(),
				nodes: new Map(),
				junctions: new Map(),
			}),
		).toMatchObject({
			kind: FoldedGroupLayoutKind.Unknown,
			reason: FoldedGroupUnknownReason.MissingVisibleMeasurements,
		});
		expect(attempt(base, measurements(Number.NaN))).toMatchObject({
			kind: FoldedGroupLayoutKind.Unknown,
			reason: FoldedGroupUnknownReason.InvalidVisibleMeasurements,
		});
		for (const bad of [
			measurements(260, 0),
			measurements(260, 240, 0),
			{
				...measurements(),
				groups: new Map([
					[
						'G',
						{
							minimumWidth: 260,
							minimumHeight: 240,
							headerHeight: -1,
							padding: 20,
						},
					],
				]),
			},
			{
				...measurements(),
				groups: new Map([
					[
						'G',
						{
							minimumWidth: 260,
							minimumHeight: 240,
							headerHeight: 36,
							padding: -1,
						},
					],
				]),
			},
		]) {
			expect(attempt(base, bad)).toMatchObject({
				kind: FoldedGroupLayoutKind.Unknown,
				reason: FoldedGroupUnknownReason.InvalidVisibleMeasurements,
			});
		}
		expect(attempt(base, measurements(Number.MAX_VALUE, 240, Number.MAX_VALUE))).toMatchObject({
			kind: FoldedGroupLayoutKind.Unknown,
			reason: FoldedGroupUnknownReason.InvalidVisibleMeasurements,
		});
	});
});
