import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { contactFailure } from '../../../../src/lib/core/layout/dedicated-candidate-validation/route-contacts';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import { clearGroupEndpointRoutes } from '../../../../src/lib/core/layout/group-endpoint-routing';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { GroupRouteFailure, type Point } from '../../../../src/lib/core/layout/layout-types';
import { groupJunctionInsets } from '../../../../src/lib/core/layout/placement/group-junction-channels';
import {
	placeElements,
	type PlacementInput,
} from '../../../../src/lib/core/layout/placement/place-elements';
import { prepareMeasurements } from '../../../../src/lib/core/layout/placement/prepare-measurements';
import { allocateLayerPorts } from '../../../../src/lib/core/layout/routing/layered-port-reservation';
import {
	prepareRouteObstacles,
	routeHitsObstacles,
} from '../../../../src/lib/core/layout/routing/route-obstacles';
import { directRoutingSpace } from '../../../../src/lib/core/layout/routing/routing-space';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { routingLayers } from '../../../../src/lib/core/layout/structure/routing-layers';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import {
	type PreparedLayoutDocument,
	prepareLayoutDocument,
} from '../../../support/harnesses/layout';

const witnesses = {
	A: {
		nodeIds: ['node-00'],
		junctionIds: ['junction-00'],
		relations: [
			{ id: 'node-group', from: 'node-00', to: 'group-02' },
			{ id: 'node-junction', from: 'node-00', to: 'junction-00' },
			{ id: 'junction-group', from: 'junction-00', to: 'group-02' },
		],
	},
	B: {
		nodeIds: ['node-05', 'node-01'],
		junctionIds: [],
		relations: [
			{ id: 'group-first', from: 'group-02', to: 'node-05' },
			{ id: 'first-last', from: 'node-05', to: 'node-01' },
			{ id: 'group-last', from: 'group-02', to: 'node-01' },
		],
	},
	C: {
		nodeIds: ['node-00', 'node-03', 'node-04'],
		junctionIds: ['junction-00'],
		relations: [
			{ id: 'node-junction', from: 'node-00', to: 'junction-00' },
			{ id: 'node-node', from: 'node-00', to: 'node-03' },
			{ id: 'junction-group', from: 'junction-00', to: 'group-02' },
			{ id: 'node-node-last', from: 'node-03', to: 'node-04' },
		],
	},
} as const;

function reducedDocument(
	scenario: keyof typeof witnesses,
	layout: LayoutConfiguration,
): LogicDocument {
	const seed = validLogicDocument();
	const { nodeIds, junctionIds, relations } = witnesses[scenario];
	return {
		...seed,
		layout,
		groups: [
			{ kind: EndpointKind.Group, id: 'group-02', label: 'Group', layoutOrder: orderKey('a9') },
		],
		nodes: nodeIds.map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: id,
			layoutOrder: orderKey(`a${index + 1}`),
		})),
		junctions: junctionIds.map((id) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey('a8'),
		})),
		relations,
	};
}

const directions = [
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Left },
] as const satisfies readonly LayoutConfiguration[];

function initialLayerPortReservation(prepared: PreparedLayoutDocument) {
	const structure = prepareLayout(prepared.graph, prepared.ranks);
	const frame = createLayoutFrame(
		prepared.document.layout.direction,
		prepared.document.layout.bias,
	);
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
		delete workspace.placement.groupWindows;
		placeElements(workspace, new Map());
	}
	const layers = routingLayers(structure);
	const bounds = workspace.placement.bounds;
	const componentByEndpointId = new Map(
		structure.components.flatMap((component, index) =>
			component.ids.map((id) => [id, index] as const),
		),
	);
	const space = directRoutingSpace({
		layers,
		bounds,
		frame,
		junctionIds: structure.junctionIds,
		enclosingGroups: new Set(structure.hierarchy?.membersById.keys()),
	});
	return allocateLayerPorts({
		graph: prepared.graph,
		layers,
		bounds,
		frame,
		junctionIds: structure.junctionIds,
		ranks: prepared.ranks.byEndpointId,
		sizes: measurements.sizes,
		componentByEndpointId,
		space,
	});
}

describe.each(['A', 'B', 'C'] as const)('group endpoint obstacle %s', (scenario) => {
	it.each(directions)('routes around foreign boxes in $direction', (configuration) => {
		const document = reducedDocument(scenario, configuration);
		const prepared = prepareLayoutDocument(document);
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
		const reversed = prepareLayoutDocument({
			...document,
			groups: document.groups.toReversed(),
			nodes: document.nodes.toReversed(),
			junctions: document.junctions.toReversed(),
			relations: document.relations.toReversed(),
		});
		expect(
			layoutWithDedicatedEngine(reversed.graph, reversed.ranks, reversed.measurements),
		).toEqual(layout);
	});
});

it.each(directions)(
	'avoids an intermediate node when a populated group shares its target’s logical rank ($direction)',
	(configuration) => {
		const seed = validLogicDocument();
		const document: LogicDocument = {
			...seed,
			layout: configuration,
			groups: [{ kind: EndpointKind.Group, id: 'G', label: 'G', layoutOrder: orderKey('a0') }],
			nodes: ['m', 'u', 't'].map((id, index) => {
				const node = {
					kind: EndpointKind.Node as const,
					id,
					natureId: 'goal',
					markdown: id,
					layoutOrder: orderKey(`a${index + 1}`),
				};
				if (id === 'm') return { ...node, groupId: 'G' };
				return node;
			}),
			junctions: [],
			relations: [
				{ id: 'm-u', from: 'm', to: 'u' },
				{ id: 'u-t', from: 'u', to: 't' },
				{ id: 'G-t', from: 'G', to: 't' },
			],
		};
		const prepared = prepareLayoutDocument(document, {
			groups: { G: { minimumWidth: 160, minimumHeight: 72, headerHeight: 4, padding: 4 } },
		});
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
	},
);

it.each(directions)(
	'keeps an independent fork’s ports, order and route topology under unrelated group-channel loads ($direction)',
	(configuration) => {
		const seed = validLogicDocument();
		const fork: LogicDocument = {
			...seed,
			layout: configuration,
			groups: [],
			nodes: ['a', 'b', 'c'].map((id, index) => ({
				kind: EndpointKind.Node,
				id,
				natureId: 'goal',
				markdown: id,
				layoutOrder: orderKey(`a${index + 1}`),
			})),
			junctions: [],
			relations: [
				{ id: 'a-b', from: 'a', to: 'b' },
				{ id: 'a-c', from: 'a', to: 'c' },
			],
		};
		const original = prepareLayoutDocument(fork);
		const base = layoutWithDedicatedEngine(original.graph, original.ranks, original.measurements);
		const vertical =
			configuration.direction === LayoutDirection.TopToBottom ||
			configuration.direction === LayoutDirection.BottomToTop;
		const forkSignature = (layout: typeof base) => {
			const cross = (point: Point): number => {
				if (vertical) return point.x;
				return point.y;
			};
			const boxes = new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
			const anchor = boxes.get('a');
			if (anchor === undefined) throw new Error('Missing fork source');
			const anchorTransverse = cross(anchor);
			return layout.relations
				.filter(({ from }) => from === 'a')
				.map(({ id, to, points }) => {
					const target = boxes.get(to);
					const sourcePort = points[0];
					const targetPort = points.at(-1);
					if (target === undefined || sourcePort === undefined || targetPort === undefined)
						throw new Error('Missing fork target or port');
					return {
						id,
						sourcePort: { x: sourcePort.x - anchor.x, y: sourcePort.y - anchor.y },
						targetPort: { x: targetPort.x - target.x, y: targetPort.y - target.y },
						transverseRails: points.map((point) => cross(point) - anchorTransverse),
						segments: points.slice(1).map((point, index) => {
							const previous = points[index];
							if (previous === undefined) throw new Error('Missing route point');
							const delta = cross(point) - cross(previous);
							if (delta !== 0) return `transverse:${Math.sign(delta)}`;
							let longitudinal = point.x - previous.x;
							if (vertical) longitudinal = point.y - previous.y;
							return `main:${Math.sign(longitudinal)}`;
						}),
					};
				});
		};
		const expected = forkSignature(base);
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 6 }), (fanout) => {
				const spokes = Array.from({ length: fanout }, (_, index) => `q${index}`);
				const expanded = prepareLayoutDocument({
					...fork,
					groups: [{ kind: EndpointKind.Group, id: 'G', label: 'G', layoutOrder: orderKey('a0') }],
					nodes: [
						...fork.nodes,
						...spokes.map((id, index) => ({
							kind: EndpointKind.Node as const,
							id,
							natureId: 'goal',
							markdown: id,
							layoutOrder: orderKey(`a${index + 4}`),
						})),
						{
							kind: EndpointKind.Node,
							id: 't',
							natureId: 'goal',
							markdown: 't',
							layoutOrder: orderKey('aA'),
						},
					],
					relations: [
						...fork.relations,
						...spokes.flatMap((id) => [
							{ id: `G-${id}`, from: 'G', to: id },
							{ id: `${id}-t`, from: id, to: 't' },
						]),
						{ id: 'G-t', from: 'G', to: 't' },
					],
				});
				const layout = layoutWithDedicatedEngine(
					expanded.graph,
					expanded.ranks,
					expanded.measurements,
				);
				expect(validateDedicatedCandidate({ ...expanded, layout })).toMatchObject({
					valid: true,
				});
				expect(forkSignature(layout)).toEqual(expected);
			}),
			{ numRuns: 12 },
		);
	},
);

it('keeps a route outside a foreign frame adjoining its shared target', () => {
	const prepared = prepareLayoutDocument(validLogicDocument(), {
		nodes: { 'source-a': { width: 123.5, height: 73.25 } },
		junctions: { choice: { width: 29.5, height: 21.25 } },
		groups: {
			container: {
				minimumWidth: 160.5,
				minimumHeight: 72.25,
				headerHeight: 36.5,
				padding: 24.25,
			},
		},
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
	const group = layout.relations.find(({ id }) => id === 'group-to-target');
	const container = layout.elements.find(({ id }) => id === 'container')?.bounds;
	if (group === undefined || container === undefined) throw new Error('Missing route or frame');
	const bottom = container.y + container.height;
	expect(
		group.points.some(
			({ x, y }) => x > container.x && x < container.x + container.width && y < bottom,
		),
	).toBe(false);
});
it('does not reserve shared-target ports against its own ancestor frame', () => {
	const document: LogicDocument = {
		...validLogicDocument(),
		layout: { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Left },
	};
	const ancestorDocument: LogicDocument = {
		...document,
		nodes: document.nodes.map((node) => {
			if (node.id === 'target') return { ...node, groupId: 'container' };
			return node;
		}),
	};
	const ancestor = prepareLayoutDocument(ancestorDocument, {
		nodes: { target: { width: 12.1, height: 0.1 } },
		groups: {
			container: {
				minimumWidth: 344,
				minimumHeight: 72,
				headerHeight: 36,
				padding: 24,
			},
		},
	});
	const layout = layoutWithDedicatedEngine(ancestor.graph, ancestor.ranks, ancestor.measurements);
	expect(validateDedicatedCandidate({ ...ancestor, layout })).toMatchObject({ valid: true });
	const target = layout.elements.find(({ id }) => id === 'target')?.bounds;
	const container = layout.elements.find(({ id }) => id === 'container')?.bounds;
	const route = layout.relations.find(({ id }) => id === 'group-to-target');
	if (target === undefined || container === undefined || route === undefined)
		throw new Error('Missing target, ancestor frame, or direct group relation');
	expect(target.x).toBeGreaterThanOrEqual(container.x);
	expect(target.y).toBeGreaterThanOrEqual(container.y);
	expect(target.x + target.width).toBeLessThanOrEqual(container.x + container.width);
	expect(target.y + target.height).toBeLessThanOrEqual(container.y + container.height);
	expect(route.points.at(-1)?.x).toBe(target.x);
	expect(initialLayerPortReservation(ancestor)).toBeUndefined();

	const blocked = prepareLayoutDocument(document, {
		nodes: { target: { width: 12.1, height: 0.1 } },
		groups: {
			container: {
				minimumWidth: 368,
				minimumHeight: 72,
				headerHeight: 36,
				padding: 24,
			},
		},
	});
	const blockedPlan = initialLayerPortReservation(blocked);
	if (blockedPlan === undefined) throw new Error('Missing ports for a blocked shared target');
	const groupOffset = blockedPlan.targetOffsets.get('group-to-target');
	const choiceOffset = blockedPlan.targetOffsets.get('choice-to-target');
	if (groupOffset === undefined || choiceOffset === undefined)
		throw new Error('Missing a predecessor port on the blocked target');
	expect(groupOffset).toBe(-24);
	expect(choiceOffset).toBe(24);
	expect([...blockedPlan.targetOffsets.keys()].sort()).toEqual([
		'choice-to-target',
		'group-to-target',
	]);
	expect(
		blockedPlan.metricDemands.map(({ endpointId, portCount, role }) => ({
			endpointId,
			portCount,
			role,
		})),
	).toEqual([{ endpointId: 'target', portCount: 2, role: 'incoming' }]);
});

function exteriorRailWitness() {
	const document: LogicDocument = {
		...validLogicDocument(),
		groups: [
			{ kind: EndpointKind.Group, id: 'G', label: 'G', layoutOrder: orderKey('a1') },
			{ kind: EndpointKind.Group, id: 'F', label: 'F', layoutOrder: orderKey('a2') },
		],
		nodes: ['s', 'd', 't'].map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: id,
			layoutOrder: orderKey(`a${index + 3}`),
		})),
		junctions: [],
		relations: [
			{ id: 'barrier', from: 's', to: 'd' },
			{ id: 'shortcut', from: 'G', to: 't' },
		],
	};
	const prepared = prepareLayoutDocument(document, {
		groups: {
			G: { minimumWidth: 160, minimumHeight: 80, headerHeight: 4, padding: 4 },
			F: { minimumWidth: 240, minimumHeight: 20, headerHeight: 4, padding: 4 },
		},
		nodes: {
			s: { width: 64, height: 40 },
			d: { width: 64, height: 40 },
			t: { width: 160, height: 80 },
		},
	});
	const bounds = new Map([
		['G', { x: 40, y: 40, width: 160, height: 80 }],
		['F', { x: 0, y: 220, width: 240, height: 20 }],
		['s', { x: 0, y: 160, width: 64, height: 40 }],
		['d', { x: 0, y: 300, width: 64, height: 40 }],
		['t', { x: 40, y: 340, width: 160, height: 80 }],
	]);
	const routes = [
		{
			id: 'barrier',
			from: 's',
			to: 'd',
			points: [
				{ x: 32, y: 200 },
				{ x: 264, y: 200 },
				{ x: 264, y: 280 },
				{ x: 32, y: 280 },
				{ x: 32, y: 300 },
			],
		},
		{
			id: 'shortcut',
			from: 'G',
			to: 't',
			points: [
				{ x: 120, y: 120 },
				{ x: 120, y: 340 },
			],
		},
	];
	const frame = createLayoutFrame(document.layout.direction, document.layout.bias);
	return { prepared, bounds, frame, routes };
}

it('reserves a fresh exterior rail after every local passage meets a real blocker', () => {
	const { prepared, bounds, frame, routes } = exteriorRailWitness();
	clearGroupEndpointRoutes(prepared.graph, bounds, frame, routes);
	const shortcut = routes.find(({ id }) => id === 'shortcut');
	expect(shortcut?.points.some(({ x }) => x > 264)).toBe(true);
	const elements = [...bounds]
		.map(([id, box]) => ({
			id,
			kind: prepared.graph.endpointsById.get(id)?.kind ?? EndpointKind.Node,
			bounds: box,
		}))
		.sort((left, right) => compareCanonicalStrings(left.id, right.id));
	expect(
		validateDedicatedCandidate({
			...prepared,
			layout: { width: 400, height: 540, elements, relations: routes },
		}),
	).toMatchObject({ valid: true });
});

it('reports a typed failure rather than publishing a route into an impenetrable foreign frame', () => {
	const { prepared, bounds, frame, routes } = exteriorRailWitness();
	bounds.set('F', { x: 0, y: 220, width: 240, height: 120 });
	bounds.set('d', { x: 264, y: 300, width: 64, height: 40 });
	routes[0] = {
		id: 'barrier',
		from: 's',
		to: 'd',
		points: [
			{ x: 32, y: 200 },
			{ x: 264, y: 200 },
			{ x: 264, y: 280 },
			{ x: 296, y: 280 },
			{ x: 296, y: 300 },
		],
	};
	let failure: unknown;
	try {
		clearGroupEndpointRoutes(prepared.graph, bounds, frame, routes);
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(GroupRouteFailure);
	expect(failure).toMatchObject({
		code: 'group-route-no-valid-passage',
		relationId: 'shortcut',
	});
});

it('publishes only valid group and junction routes in the rich corpus', () => {
	for (const document of fc.sample(richAcyclicLogicDocumentArbitrary(), {
		seed: 1592915777,
		numRuns: 200,
	})) {
		const prepared = prepareLayoutDocument(document);
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		const nodeObstacles = prepareRouteObstacles(
			layout.elements.filter(({ kind }) => kind !== EndpointKind.Group).map(({ bounds }) => bounds),
			0,
		);
		const groupIds = new Set(document.groups.map(({ id }) => id));
		for (const route of layout.relations) {
			if (!groupIds.has(route.from) && !groupIds.has(route.to)) continue;
			expect(routeHitsObstacles(route.points, nodeObstacles), route.id).toBe(false);
		}
		expect(contactFailure(layout.relations, routeBridgeAnalysis(layout.relations))).toBeUndefined();
		expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
	}
});
