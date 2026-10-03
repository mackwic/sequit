import fc from 'fast-check';
import { expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import { rankOrderComparisonCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { DedicatedCandidateRejectionCode } from '../../../../src/lib/core/layout/dedicated-candidate-validation/types';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import { clearGroupEndpointRoutes } from '../../../../src/lib/core/layout/group-endpoint-routing';
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngineAndRankOrderWitness,
} from '../../../../src/lib/core/layout/layout-engine';
import { OUTER_MARGIN } from '../../../../src/lib/core/layout/layout-settings';
import {
	type DedicatedLayoutEvaluation,
	GroupRouteFailure,
	type LayoutResult,
	RelationBoundsOverlap,
} from '../../../../src/lib/core/layout/layout-types';
import { groupJunctionInsets } from '../../../../src/lib/core/layout/placement/group-junction-channels';
import {
	placeElements,
	type PlacementInput,
} from '../../../../src/lib/core/layout/placement/place-elements';
import { prepareMeasurements } from '../../../../src/lib/core/layout/placement/prepare-measurements';
import type { DedicatedLayoutEvaluator } from '../../../../src/lib/core/layout/rank/rank-order-search';
import { selectDedicatedRankLayout } from '../../../../src/lib/core/layout/rank/rank-order-selection';
import type { RankOrderSearchWitness } from '../../../../src/lib/core/layout/rank/rank-order-witness';
import { collectRankOrderDomain } from '../../../../src/lib/core/layout/rank/rank-ordering';
import { routePoints } from '../../../../src/lib/core/layout/routing/endpoint-routes';
import { allocateLayerPorts } from '../../../../src/lib/core/layout/routing/layered-port-reservation';
import { relationPortOffset } from '../../../../src/lib/core/layout/routing/relation-port-offsets';
import {
	directRouteRail,
	directRoutingSpace,
} from '../../../../src/lib/core/layout/routing/routing-space';
import { relationComponentIndex } from '../../../../src/lib/core/layout/structure/layout-components';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { routingLayers } from '../../../../src/lib/core/layout/structure/routing-layers';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { junctionObstacle } from '../../../support/fixtures/routing-obstacles';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

it('publishes only independently valid layouts for rich acyclic documents', async () => {
	for (const [index, document] of fc
		.sample(richAcyclicLogicDocumentArbitrary(), { seed: 1_592_915_777, numRuns: 50 })
		.entries()) {
		const prepared = prepareLayoutDocument(document);
		const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
		const result = validateDedicatedCandidate({ ...prepared, layout });
		expect(
			result,
			`sample ${index}: ${JSON.stringify(result)}; document ${JSON.stringify(document)}`,
		).toMatchObject({ valid: true });
	}
}, 120_000);

it.each(Object.values(LayoutDirection))(
	'validates shared group/member targets (%s)',
	async (direction) => {
		for (const withJunction of [true, false]) {
			let edges = [
				['n0', 'g0'],
				['n2', 'n1'],
				['n0', 'n1'],
				['n3', 'g0'],
				['n0', 'n2'],
				['n3', 'n1'],
			];
			let nodeCount = 4;
			let memberIndex = 1;
			const junctions: LogicDocument['junctions'][number][] = [];
			if (withJunction) {
				edges = [
					['n1', 'j0'],
					['n0', 'n1'],
					['n0', 'n2'],
					['j0', 'n2'],
					['g0', 'n2'],
				];
				nodeCount = 3;
				memberIndex = 0;
				junctions.push({
					kind: EndpointKind.Junction,
					id: 'j0',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a0'),
				});
			}
			const document: LogicDocument = {
				...validLogicDocument(),
				layout: defined(
					layoutConfiguration(direction, LayoutBias.Top) ??
						layoutConfiguration(direction, LayoutBias.Left),
				),
				groups: [
					{ kind: EndpointKind.Group, id: 'g0', label: 'Group', layoutOrder: orderKey('a0') },
				],
				nodes: Array.from({ length: nodeCount }, (_, index) => {
					const node = {
						kind: EndpointKind.Node,
						id: `n${index}`,
						markdown: '',
						natureId: 'goal',
						layoutOrder: orderKey(`a${index}`),
					} as const;
					if (index === memberIndex) return { ...node, groupId: 'g0' };
					return node;
				}),
				junctions,
				relations: edges.map(([from, to], index) => ({
					id: `r${index}-${from}-${to}`,
					from: defined(from),
					to: defined(to),
				})),
			};
			const prepared = prepareLayoutDocument(document);
			const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
			const validation = validateDedicatedCandidate({ ...prepared, layout });
			expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
		}
	},
);

const GENERATED_GROUPS: LogicDocument['groups'] = [
	{
		kind: EndpointKind.Group,
		id: 'group-00',
		label: 'Root group',
		layoutOrder: orderKey('aH00001'),
	},
	{
		kind: EndpointKind.Group,
		id: 'group-01',
		label: 'Nested group 1',
		groupId: 'group-00',
		layoutOrder: orderKey('aH00011'),
	},
	{
		kind: EndpointKind.Group,
		id: 'group-02',
		label: 'Empty endpoint group',
		layoutOrder: orderKey('aG00021'),
	},
	{
		kind: EndpointKind.Group,
		id: 'group-03',
		label: 'Empty group root',
		layoutOrder: orderKey('aG00031'),
	},
	{
		kind: EndpointKind.Group,
		id: 'empty-group-00',
		label: 'Nested empty group 1',
		groupId: 'group-03',
		layoutOrder: orderKey('aE00001'),
	},
];

interface GeneratedWitness {
	readonly name: string;
	readonly direction: LayoutDirection;
	readonly groups?: LogicDocument['groups'];
	readonly nodeGroups: readonly (string | undefined)[];
	readonly junctions: number;
	readonly edges: readonly (readonly string[])[];
}

// Reduced from the expanded generator; junctions are members of `group-00`.
it.each(
	Object.values(LayoutDirection).flatMap((direction): GeneratedWitness[] => [
		{
			// Two outgoing central ports diverged after repair.
			name: 'keeps a shared junction stem beside nested frames',
			direction,
			nodeGroups: [
				'group-00',
				undefined,
				'group-01',
				undefined,
				'group-00',
				'group-00',
				'group-00',
				'group-00',
				'group-00',
				'group-01',
			],
			junctions: 3,
			edges: [
				['node-00', 'junction-00'],
				['junction-00', 'group-02'],
				['junction-00', 'node-09'],
				['group-02', 'node-01'],
				['group-00', 'node-01'],
			],
		},
		{
			// The last repaired route took the bridge carrier of a crossing between two others.
			name: 'keeps the bridges of crossings between other repaired routes',
			direction,
			nodeGroups: ['group-00', 'group-00', 'group-01'],
			junctions: 2,
			edges: [
				['node-00', 'group-02'],
				['node-00', 'junction-00'],
				['junction-00', 'group-02'],
				['group-02', 'group-03'],
				['group-02', 'node-01'],
				['empty-group-00', 'group-01'],
				['empty-group-00', 'junction-01'],
				['node-02', 'junction-01'],
			],
		},
		{
			// Generator 8 nodes, seed 1592915777, sample 50: node-02→node-01 was repaired first and
			// ran through the pending group-05→node-01 attachment, a distinct port of their target.
			name: 'keeps a distinct port of a shared target free for its pending route',
			direction,
			groups: [
				defined(GENERATED_GROUPS[0]),
				{
					kind: EndpointKind.Group,
					id: 'group-05',
					label: 'Nested group 3',
					groupId: 'group-00',
					layoutOrder: orderKey('aH00031'),
				},
				defined(GENERATED_GROUPS[2]),
				{
					kind: EndpointKind.Group,
					id: 'empty-group-00',
					label: 'Nested empty group 1',
					layoutOrder: orderKey('aE00001'),
				},
			],
			nodeGroups: ['group-05', 'group-00', 'group-05'],
			junctions: 2,
			edges: [
				['node-00', 'junction-00'],
				['junction-00', 'group-02'],
				['group-02', 'node-01'],
				['empty-group-00', 'node-01'],
				['group-05', 'node-01'],
				['node-02', 'node-01'],
			],
		},
	]),
)('$name ($direction)', async ({ direction, groups, nodeGroups, junctions, edges }) => {
	const padded = (index: number): string => index.toString().padStart(2, '0');
	const document: LogicDocument = {
		...validLogicDocument(),
		layout: defined(
			layoutConfiguration(direction, LayoutBias.Top) ??
				layoutConfiguration(direction, LayoutBias.Left),
		),
		groups: groups ?? GENERATED_GROUPS,
		nodes: nodeGroups.map((groupId, index) => {
			const node = {
				kind: EndpointKind.Node,
				id: `node-${padded(index)}`,
				natureId: 'goal',
				markdown: '',
				layoutOrder: orderKey(`aN${index.toString().padStart(4, '0')}1`),
			} as const;
			if (groupId === undefined) return node;
			return { ...node, groupId };
		}),
		junctions: Array.from({ length: junctions }, (_, index) => ({
			kind: EndpointKind.Junction,
			id: `junction-${padded(index)}`,
			groupId: 'group-00',
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey(`aJ${index.toString().padStart(4, '0')}1`),
		})),
		relations: edges.map(([from, to], index) => ({
			id: `relation-${index.toString().padStart(3, '0')}`,
			from: defined(from),
			to: defined(to),
		})),
	};
	const prepared = prepareLayoutDocument(document);
	const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
	const validation = validateDedicatedCandidate({ ...prepared, layout });
	expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
});

// Rich corpus, seed 1592915777, sample 183: `g0` holds only an empty subgroup, so it keeps a row
// slot as an endpoint while its membership makes it a frame. Alone in its row, that row had no
// atomic box and its rails were placed from an infinite extent before the group repair. Each
// direction keeps the generator's bias, the one under which it failed.
it.each([
	[LayoutDirection.TopToBottom, LayoutBias.Top],
	[LayoutDirection.BottomToTop, LayoutBias.Bottom],
	[LayoutDirection.LeftToRight, LayoutBias.Left],
	[LayoutDirection.RightToLeft, LayoutBias.Right],
])(
	'routes from a row holding only a frame around an empty subgroup (%s, %s bias)',
	async (direction, bias) => {
		const document: LogicDocument = {
			...validLogicDocument(),
			layout: defined(layoutConfiguration(direction, bias)),
			groups: [
				{ kind: EndpointKind.Group, id: 'g0', label: 'Frame', layoutOrder: orderKey('a0') },
				{
					kind: EndpointKind.Group,
					id: 'g1',
					label: 'Empty',
					groupId: 'g0',
					layoutOrder: orderKey('a1'),
				},
			],
			nodes: ['n0', 'n1'].map((id, index) => ({
				kind: EndpointKind.Node,
				id,
				natureId: 'goal',
				markdown: id,
				layoutOrder: orderKey(`a${index + 2}`),
			})),
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'j0',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a4'),
				},
			],
			relations: [
				['j0', 'g0'],
				['g0', 'n0'],
				['g0', 'n1'],
				['n1', 'n0'],
			].map(([from, to], index) => ({ id: `r${index}`, from: defined(from), to: defined(to) })),
		};
		const prepared = prepareLayoutDocument(document);
		const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
		const validation = validateDedicatedCandidate({ ...prepared, layout });
		expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
	},
);

interface FrameRowWitness {
	readonly name: string;
	/** Identifier, documentary order, label and optional parent group. */
	readonly groups: readonly (readonly [string, string, string, string?])[];
	readonly nodes: readonly (readonly [string, string, string?])[];
	readonly junctions: readonly (readonly [string, string, string?])[];
	readonly relations: readonly (readonly [string, string, string])[];
}

// Group-passage census (seed 1592915777, 300 documents), draws 282 and 229. A group holding only
// an empty subgroup keeps a row slot, yet its frame lies around that subgroup, far from the row.
// Measured as the row's edge, it hid the shell of a sibling frame opening beside a junction rail:
// that frame overlapped the junction and its route had no passage.
it.each(
	Object.values(LayoutDirection).flatMap((direction) =>
		(
			[
				{
					name: 'reserves the shell of a sibling frame beside a junction rail',
					groups: [
						['group-04', 'aH00021', 'Nested group 2'],
						['group-05', 'aH00031', 'Nested group 3', 'group-04'],
						['group-02', 'aG00021', 'Empty endpoint group'],
						['group-03', 'aG00031', 'Empty group root'],
						['empty-group-02', 'aE00021', 'Nested empty group 3', 'group-03'],
					],
					nodes: [
						['node-00', 'aN00001'],
						['node-05', 'aN00051', 'group-05'],
						['node-10', 'aN00101'],
					],
					junctions: [
						['junction-00', 'aJ00001', 'group-04'],
						['junction-01', 'aJ00011'],
					],
					relations: [
						['relation-000', 'node-00', 'junction-00'],
						['relation-001', 'junction-00', 'group-02'],
						['relation-003', 'group-02', 'node-10'],
						['relation-005', 'group-03', 'junction-01'],
						['relation-008', 'node-05', 'junction-01'],
					],
				},
				{
					name: 'reserves the shells of nested frames beside a member junction rail',
					groups: [
						['group-00', 'aH00001', 'Root group'],
						['group-01', 'aH00011', 'Nested group 1', 'group-00'],
						['group-04', 'aH00021', 'Nested group 2', 'group-01'],
						['group-05', 'aH00031', 'Nested group 3', 'group-04'],
						['group-06', 'aH00041', 'Nested group 4', 'group-05'],
						['group-02', 'aG00021', 'Empty endpoint group'],
						['empty-group-00', 'aE00001', 'Nested empty group 1'],
						['empty-group-03', 'aE00031', 'Nested empty group 4', 'empty-group-00'],
					],
					nodes: [
						['node-00', 'aN00001'],
						['node-06', 'aN00061', 'group-06'],
						['node-07', 'aN00071'],
						['node-09', 'aN00091'],
						['node-10', 'aN00101', 'group-04'],
					],
					junctions: [['junction-00', 'aJ00001', 'group-01']],
					relations: [
						['relation-000', 'node-00', 'junction-00'],
						['relation-001', 'junction-00', 'group-02'],
						['relation-002', 'junction-00', 'node-09'],
						['relation-005', 'group-02', 'node-07'],
						['relation-007', 'empty-group-00', 'node-09'],
						['relation-010', 'node-06', 'node-10'],
					],
				},
			] satisfies FrameRowWitness[]
		).map((witness) => ({ ...witness, direction })),
	),
)('$name ($direction)', async ({ direction, groups, nodes, junctions, relations }) => {
	const parent = (groupId: string | undefined) => {
		if (groupId === undefined) return {};
		return { groupId };
	};
	const document: LogicDocument = {
		...validLogicDocument(),
		layout: defined(
			layoutConfiguration(direction, LayoutBias.Top) ??
				layoutConfiguration(direction, LayoutBias.Left),
		),
		groups: groups.map(([id, order, label, groupId]) => ({
			kind: EndpointKind.Group,
			id,
			label,
			layoutOrder: orderKey(order),
			...parent(groupId),
		})),
		nodes: nodes.map(([id, order, groupId]) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: '',
			layoutOrder: orderKey(order),
			...parent(groupId),
		})),
		junctions: junctions.map(([id, order, groupId]) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey(order),
			...parent(groupId),
		})),
		relations: relations.map(([id, from, to]) => ({ id, from, to })),
	};
	const prepared = prepareLayoutDocument(document);
	const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
	const validation = validateDedicatedCandidate({ ...prepared, layout });
	expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
});

// G2 seed 629 witnesses deferred repair before the rigid-block placement merge.
// Validate the repaired geometry, not which group attachment moved along the way.
it('validates first-placement repair beside pending group attachments in bottom-to-top', async () => {
	const direction = LayoutDirection.BottomToTop;
	const bias = LayoutBias.Top;
	const members: Readonly<Record<string, string>> = { n2: 'g0', j0: 'g0' };
	const endpoint = (id: string) => {
		const groupId = members[id];
		if (groupId === undefined) return { id };
		return { id, groupId };
	};
	let order = 0;
	const key = () => orderKey(`a${(order++).toString().padStart(3, '0')}1`);
	const groups = ['g0', 'g1'].map((id): LogicDocument['groups'][number] => ({
		kind: EndpointKind.Group,
		label: id,
		layoutOrder: key(),
		...endpoint(id),
	}));
	const nodes = ['n0', 'n1', 'n2'].map((id): LogicDocument['nodes'][number] => ({
		kind: EndpointKind.Node,
		natureId: 'goal',
		markdown: id,
		layoutOrder: key(),
		...endpoint(id),
	}));
	const junctions = ['j0', 'j1'].map((id): LogicDocument['junctions'][number] => ({
		kind: EndpointKind.Junction,
		operator: JunctionOperator.Xor,
		layoutOrder: key(),
		...endpoint(id),
	}));
	const document: LogicDocument = {
		...validLogicDocument(),
		layout: defined(layoutConfiguration(direction, bias)),
		groups,
		nodes,
		junctions,
		relations: [
			['g0', 'g1'],
			['j0', 'n1'],
			['n1', 'g1'],
			['n2', 'n0'],
			['n2', 'j1'],
			['g0', 'n0'],
			['j0', 'g1'],
		].map(([from, to], index) => ({
			id: `r${index}`,
			from: defined(from),
			to: defined(to),
		})),
	};
	const prepared = prepareLayoutDocument(document);
	const structure = prepareLayout(prepared.graph, prepared.ranks);
	const frame = createLayoutFrame(direction, document.layout.bias);
	const measurements = prepareMeasurements(structure, prepared.measurements, frame);
	const workspace: PlacementInput = {
		structure,
		measurements,
		frame,
		placement: {
			bounds: new Map(),
			components: [],
			groupChannelInsets: new Map(),
		},
	};
	placeElements(workspace, new Map());
	workspace.placement.groupChannelInsets = groupJunctionInsets(
		structure,
		workspace.placement.bounds,
		frame,
	);
	if (workspace.placement.groupChannelInsets.size > 0) {
		placeElements(workspace, new Map());
	}
	const bounds = new Map(workspace.placement.bounds);
	const layers = routingLayers(structure);
	const space = directRoutingSpace({
		layers,
		bounds,
		frame,
		junctionIds: structure.junctionIds,
		enclosingGroups: new Set(structure.hierarchy?.membersById.keys()),
	});
	const ports = allocateLayerPorts({
		graph: prepared.graph,
		layers,
		bounds,
		frame,
		junctionIds: structure.junctionIds,
		ranks: prepared.ranks.byEndpointId,
		sizes: measurements.sizes,
		componentByEndpointId: relationComponentIndex(prepared.graph),
		space,
	});
	const routes = prepared.graph.relations.map(({ relation }, index) => ({
		id: relation.id,
		from: relation.from,
		to: relation.to,
		points: routePoints({
			source: defined(bounds.get(relation.from)),
			target: defined(bounds.get(relation.to)),
			direction,
			rail: directRouteRail(space, relation.from, relation.to),
			sourceOffset: relationPortOffset(ports?.sourceOffsets, prepared.graph, index),
			targetOffset: relationPortOffset(ports?.targetOffsets, prepared.graph, index),
		}),
	}));
	clearGroupEndpointRoutes(prepared.graph, bounds, frame, routes);
	const right = Math.max(
		...Array.from(bounds.values(), ({ x, width }) => x + width),
		...routes.flatMap(({ points }) => points.map(({ x }) => x)),
	);
	const bottom = Math.max(
		...Array.from(bounds.values(), ({ y, height }) => y + height),
		...routes.flatMap(({ points }) => points.map(({ y }) => y)),
	);
	const directLayout: LayoutResult = {
		width: right + OUTER_MARGIN,
		height: bottom + OUTER_MARGIN,
		elements: [...bounds].map(([id, elementBounds]) => ({
			id,
			kind: defined(prepared.graph.endpointsById.get(id)).kind,
			bounds: elementBounds,
		})),
		relations: routes,
	};
	const directValidation = validateDedicatedCandidate({ ...prepared, layout: directLayout });
	expect(directValidation, JSON.stringify(directValidation)).toMatchObject({ valid: true });
	const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
	const validation = validateDedicatedCandidate({ ...prepared, layout });
	expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
});

// Rich seed 1592915777, sample 22: on merged rigid-block placement, node-00→junction-00
// must wait for the pending node-00→group-01 attachment to be repaired.
it('retries a pending nested-group attachment on merged right-to-left placement', async () => {
	const parent = (groupId: string | undefined) => {
		if (groupId === undefined) return {};
		return { groupId };
	};
	const document: LogicDocument = {
		...validLogicDocument(),
		layout: { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
		groups: [
			['group-00', 'aH00001'],
			['group-01', 'aH00011', 'group-00'],
			['group-02', 'aG00021'],
			['group-03', 'aG00031'],
			['empty-group-00', 'aE00001', 'group-03'],
		].map(([id, key, groupId]) => ({
			kind: EndpointKind.Group,
			id: defined(id),
			label: defined(id),
			layoutOrder: orderKey(defined(key)),
			...parent(groupId),
		})),
		nodes: [
			['node-00', 'aN00001', 'group-00'],
			['node-01', 'aN00011', 'group-00'],
			['node-02', 'aN00021', 'group-01'],
			['node-03', 'aN00031'],
			['node-04', 'aN00041', 'group-00'],
		].map(([id, key, groupId]) => ({
			kind: EndpointKind.Node,
			id: defined(id),
			natureId: 'goal',
			markdown: '',
			layoutOrder: orderKey(defined(key)),
			...parent(groupId),
		})),
		junctions: [
			['junction-00', 'aJ00001', 'group-01'],
			['junction-01', 'aJ00011', 'group-00'],
			['junction-02', 'aJ00021', 'group-00'],
		].map(([id, key, groupId]) => ({
			kind: EndpointKind.Junction,
			id: defined(id),
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey(defined(key)),
			...parent(groupId),
		})),
		relations: [
			['node-00', 'group-01'],
			['node-00', 'junction-00'],
			['junction-00', 'group-02'],
			['group-02', 'node-01'],
			['node-04', 'node-01'],
			['junction-01', 'node-01'],
		].map(([from, to], index) => ({
			id: `relation-${index.toString().padStart(3, '0')}`,
			from: defined(from),
			to: defined(to),
		})),
	};
	const prepared = prepareLayoutDocument(document, {
		groups: Object.fromEntries(
			document.groups.map(({ id }) => [
				id,
				{ minimumWidth: 64, minimumHeight: 48, headerHeight: 24, padding: 8 },
			]),
		),
	});
	const documentary = evaluateDedicatedLayout(
		prepareLayout(prepared.graph, prepared.ranks),
		prepared.measurements,
	);
	const documentaryValidation = validateDedicatedCandidate({ ...prepared, layout: documentary });
	expect(documentaryValidation, JSON.stringify(documentaryValidation)).toMatchObject({
		valid: true,
	});
	const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
	const validation = validateDedicatedCandidate({ ...prepared, layout });
	expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
});

// Reduced from 11 nodes, five groups and six routes: junction→node-01 touches node-04→node-10.
it('publishes only validated routes beside an independent junction-group branch', async () => {
	const document: LogicDocument = {
		...validLogicDocument(),
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top } as const,
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'group-02',
				label: 'Empty endpoint',
				layoutOrder: 'aG00021',
			},
		],
		junctions: [
			{
				kind: EndpointKind.Junction as const,
				id: 'junction-00',
				layoutOrder: 'aJ00001',
				operator: JunctionOperator.Xor,
			},
			{
				kind: EndpointKind.Junction as const,
				id: 'junction-01',
				layoutOrder: 'aJ00011',
				operator: JunctionOperator.Xor,
			},
		],
		nodes: ['01', '04', '10'].map((suffix) => ({
			kind: EndpointKind.Node as const,
			id: `node-${suffix}`,
			natureId: 'goal',
			markdown: '',
			layoutOrder: `aN00${suffix}1`,
		})),
		relations: [
			{ id: 'relation-001', from: 'junction-00', to: 'group-02' },
			{ id: 'relation-002', from: 'junction-00', to: 'node-01' },
			{ id: 'relation-003', from: 'group-02', to: 'node-01' },
			{ id: 'relation-004', from: 'node-04', to: 'node-10' },
		],
	};
	const prepared = prepareLayoutDocument(document);
	const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
	const validation = validateDedicatedCandidate({ ...prepared, layout });
	expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
});

/** Every evaluated order is counted once: valid, rejected, or published unverified. */
function expectCountedOnce(witness: RankOrderSearchWitness): void {
	expect(witness.valid + witness.rejected.length + witness.unverified).toBe(witness.evaluated);
}

/**
 * Two disconnected copies of a corpus entry. Each local search keeps the documentary order of
 * `two-successors` and reorders `geometric-2+2`.
 */
function twinForks(corpusId = 'two-successors') {
	const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === corpusId));
	const document: LogicDocument = {
		...entry.document,
		nodes: [
			...entry.document.nodes,
			...entry.document.nodes.map((node) => ({ ...node, id: `x-${node.id}` })),
		],
		relations: [
			...entry.document.relations,
			...entry.document.relations.map((relation) => ({
				id: `x-${relation.id}`,
				from: `x-${relation.from}`,
				to: `x-${relation.to}`,
			})),
		],
	};
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid twin forks');
	const measurements = {
		...entry.measurements,
		nodes: new Map([
			...entry.measurements.nodes,
			...[...entry.measurements.nodes].map(([id, size]) => [`x-${id}`, size] as const),
		]),
	};
	return { graph: created.value, ranks: topologicallyRank(created.value), measurements };
}

/** Damage complete documents the predicate selects, numbered from 1 in evaluation order. */
function damagingEvaluator(
	graph: ReturnType<typeof twinForks>['graph'],
	damaged: (pipeline: number) => boolean,
): DedicatedLayoutEvaluator {
	let pipelines = 0;
	return (structure, measurements, options): DedicatedLayoutEvaluation => {
		const actual = evaluateDedicatedLayout(structure, measurements, options, true);
		if (structure.graph !== graph) return actual;
		pipelines += 1;
		if (!damaged(pipelines)) return actual;
		const result: LayoutResult = { ...actual.result, relations: [] };
		return { result, complete: () => result };
	};
}

it('replaces a rejected documentary assembly by an order validated on the whole document', () => {
	const { graph, ranks, measurements } = twinForks();
	const selected = selectDedicatedRankLayout(graph, ranks, measurements, {
		options: {},
		evaluate: damagingEvaluator(graph, (pipeline) => pipeline === 1),
	});
	expect(
		validateDedicatedCandidate({ graph, ranks, measurements, layout: selected.layout }),
	).toMatchObject({ valid: true });
	const { witness } = selected;
	const documentary = collectRankOrderDomain(prepareLayout(graph, ranks)).bands;
	expect(witness.components).toHaveLength(2);
	expect(witness.rejected).toContainEqual({
		order: documentary,
		reason: { valid: false, code: DedicatedCandidateRejectionCode.RelationInventory },
	});
	expect(witness.selectedOrder).not.toEqual(documentary);
	expect(witness.finalValidation).toEqual({ valid: true });
	expect(witness.work.globalCompletePipelines).toBeGreaterThan(1);
	expect(witness.work.globalValidations).toBeGreaterThan(1);
	expectCountedOnce(witness);
});

it('witnesses the rejection when no order of the whole document passes validation', () => {
	const { graph, ranks, measurements } = twinForks();
	const selected = selectDedicatedRankLayout(graph, ranks, measurements, {
		options: {},
		evaluate: damagingEvaluator(graph, () => true),
	});
	expect(selected.witness.finalValidation).toEqual({
		valid: false,
		code: DedicatedCandidateRejectionCode.RelationInventory,
	});
	expect(selected.witness.unverified).toBe(1);
	expect(selected.witness.work.globalCompletePipelines).toBeGreaterThan(1);
	// The published documentary order is unverified, no longer among the rejected orders.
	expect(selected.witness.rejected.map(({ reason }) => reason)).not.toContain(
		selected.witness.finalValidation,
	);
	expectCountedOnce(selected.witness);
});

it('rejects with a typed reason a candidate whose relation endpoints overlap', () => {
	const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === 'geometric-2+2'));
	const created = createGraph(entry.document);
	if (!created.ok) throw new Error('Invalid geometric order witness');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	let pipelines = 0;
	const selected = selectDedicatedRankLayout(graph, ranks, entry.measurements, {
		options: {},
		evaluate: (structure, measurements, options) => {
			pipelines += 1;
			if (pipelines > 1) throw new RelationBoundsOverlap('a-d', 'a', 'd');
			return evaluateDedicatedLayout(structure, measurements, options, true);
		},
	});
	expect(selected.layout).toEqual(
		evaluateDedicatedLayout(prepareLayout(graph, ranks), entry.measurements),
	);
	expect(selected.witness.rejected.length).toBeGreaterThan(0);
	for (const { reason } of selected.witness.rejected)
		expect(reason).toEqual({
			valid: false,
			code: DedicatedCandidateRejectionCode.ElementOverlap,
			endpointId: 'a',
			otherEndpointId: 'd',
			relationId: 'a-d',
		});
	expectCountedOnce(selected.witness);
});

// Witness of the open junction-port point: with these sizes, every order of this single
// component is rejected (ports at j), so the documentary layout stays published.
it('counts a rejected published layout once, as unverified, after a whole-document search', () => {
	const fixture = junctionObstacle(LayoutDirection.LeftToRight, {
		nodes: {
			p: { width: 80, height: 177 },
			q: { width: 278, height: 54 },
			s: { width: 97, height: 91 },
			u: { width: 279, height: 176 },
			v: { width: 83, height: 176 },
			w: { width: 87, height: 127 },
			g: { width: 236, height: 40 },
			x: { width: 276, height: 43 },
		},
		junction: { width: 56, height: 14 },
	});
	const junctions = fixture.junctions ?? {};
	const ids = [...Object.keys(fixture.nodes), ...Object.keys(junctions)];
	const order = (id: string) => orderKey(`a${ids.indexOf(id).toString().padStart(2, '0')}1`);
	const created = createGraph({
		...validLogicDocument(),
		layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		groups: [],
		nodes: Object.keys(fixture.nodes).map((id) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: id,
			layoutOrder: order(id),
		})),
		junctions: Object.keys(junctions).map((id) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: order(id),
		})),
		relations: fixture.relations,
	});
	if (!created.ok) throw new Error('Invalid junction-port witness');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const measurements = {
		nodes: new Map(Object.entries(fixture.nodes)),
		groups: new Map(),
		junctions: new Map(Object.entries(junctions)),
	};
	const { layout, witness } = layoutWithDedicatedEngineAndRankOrderWitness(
		graph,
		ranks,
		measurements,
	);
	const verdict = validateDedicatedCandidate({ graph, ranks, measurements, layout });
	expect(verdict).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Ports });
	expect(witness.finalValidation).toEqual(verdict);
	expect(witness.unverified).toBe(1);
	expect(witness.valid).toBe(0);
	// The local search over the whole document already judged it: no global validation again.
	expect(witness.work.globalValidations).toBe(0);
	expectCountedOnce(witness);
});

it('validates the published geometry, never a discarded trial, and counts real validations', () => {
	const { graph, ranks, measurements } = twinForks('geometric-2+2');
	let globalPipelines = 0;
	const selected = selectDedicatedRankLayout(graph, ranks, measurements, {
		options: {},
		evaluate: (structure, sizes, options) => {
			if (structure.graph === graph) globalPipelines += 1;
			// Every reordered assembly fails before routing; the documentary one routes.
			if (structure.graph === graph && globalPipelines > 1) throw new GroupRouteFailure('a-d');
			return evaluateDedicatedLayout(structure, sizes, options, true);
		},
	});
	expect(selected.layout).toEqual(
		evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements),
	);
	expect(
		validateDedicatedCandidate({ graph, ranks, measurements, layout: selected.layout }).valid,
	).toBe(true);
	expect(selected.witness.fallbackComponents).toHaveLength(2);
	expect(selected.witness.finalValidation).toEqual({ valid: true });
	expect(selected.witness.unverified).toBe(0);
	// Two trials failed to build and were never validated: only the documentary one was.
	expect(selected.witness.work.globalCompletePipelines).toBe(3);
	expect(selected.witness.work.globalValidations).toBe(1);
});
