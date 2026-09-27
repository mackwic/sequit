import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { validateSelfContacts } from '../../../../src/lib/core/layout/bridges/route-self-contacts';
import { compareDedicatedRouteScores } from '../../../../src/lib/core/layout/dedicated-candidate-validation/route-score';
import { DedicatedCandidateRejectionCode } from '../../../../src/lib/core/layout/dedicated-candidate-validation/types';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { JUNCTION_PORT_INSET, PORT_INSET } from '../../../../src/lib/core/layout/layout-settings';
import type { LayoutRelation } from '../../../../src/lib/core/layout/layout-types';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

function fixture() {
	const document = validLogicDocument();
	const prepared = prepareLayoutDocument({
		...document,
		relations: document.relations.filter(({ id }) => id !== 'group-to-target'),
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	return { ...prepared, layout };
}

function ungroupNode<Node extends { readonly groupId?: string }>(
	node: Node,
): Omit<Node, 'groupId'> {
	const copy: Omit<Node, 'groupId'> & { groupId?: string } = { ...node };
	delete copy.groupId;
	return copy;
}

function configurationFor(direction: LayoutDirection): LayoutConfiguration {
	if (direction === LayoutDirection.TopToBottom) return { direction, bias: LayoutBias.Top };
	if (direction === LayoutDirection.BottomToTop) return { direction, bias: LayoutBias.Bottom };
	if (direction === LayoutDirection.LeftToRight) return { direction, bias: LayoutBias.Left };
	return { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right };
}

function twoIncomingFixture() {
	const document = validLogicDocument();
	const nodes = document.nodes
		.filter(({ id }) => id === 'source-a' || id === 'source-b' || id === 'target')
		.map(ungroupNode);
	const prepared = prepareLayoutDocument({
		...document,
		groups: [],
		nodes,
		junctions: [],
		relations: [
			{ id: 'a-to-target', from: 'source-a', to: 'target' },
			{ id: 'b-to-target', from: 'source-b', to: 'target' },
		],
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	return { ...prepared, layout };
}

function twoOutgoingFixture(
	direction: LayoutConfiguration['direction'] = LayoutDirection.BottomToTop,
) {
	const document = validLogicDocument();
	const nodes = document.nodes
		.filter(({ id }) => id === 'source-a' || id === 'target' || id === 'isolated')
		.map(ungroupNode);
	const prepared = prepareLayoutDocument({
		...document,
		groups: [],
		nodes,
		junctions: [],
		relations: [
			{ id: 'a-to-target', from: 'source-a', to: 'target' },
			{ id: 'a-to-isolated', from: 'source-a', to: 'isolated' },
		],
		layout: configurationFor(direction),
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	return { ...prepared, layout };
}

function directionFixture(direction: LayoutConfiguration['direction']) {
	const document = validLogicDocument();
	const nodes = document.nodes
		.filter(({ id }) => id === 'source-a' || id === 'target')
		.map(ungroupNode);
	const prepared = prepareLayoutDocument({
		...document,
		groups: [],
		nodes,
		junctions: [],
		relations: [{ id: 'source-to-target', from: 'source-a', to: 'target' }],
		layout: configurationFor(direction),
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	return { ...prepared, layout };
}

function replaceElement(
	layout: LayoutResult,
	id: string,
	update: (element: LayoutResult['elements'][number]) => LayoutResult['elements'][number],
): LayoutResult {
	return {
		...layout,
		elements: layout.elements.map((element) => {
			if (element.id !== id) return element;
			return update(element);
		}),
	};
}

function replaceRoute(
	layout: LayoutResult,
	id: string,
	update: (route: LayoutResult['relations'][number]) => LayoutResult['relations'][number],
): LayoutResult {
	return {
		...layout,
		relations: layout.relations.map((route) => {
			if (route.id !== id) return route;
			return update(route);
		}),
	};
}

function routeById(layout: LayoutResult, id: string): LayoutResult['relations'][number] {
	const route = layout.relations.find((candidate) => candidate.id === id);
	if (route === undefined) throw new Error(`Expected route ${id}`);
	return route;
}

function pointsWith(
	route: LayoutResult['relations'][number],
	points: readonly { x: number; y: number }[],
) {
	return { ...route, points };
}

describe('dedicated candidate validation: boxes and groups', () => {
	it('accepts an actual layout containing nested endpoint roles and an empty group', () => {
		const input = fixture();
		expect(input.layout.elements.some(({ kind }) => kind === EndpointKind.Group)).toBe(true);
		expect(input.layout.elements.some(({ kind }) => kind === EndpointKind.Junction)).toBe(true);
		const validation = validateDedicatedCandidate(input);
		expect(
			validation,
			JSON.stringify({
				validation,
				container: input.layout.elements.find(({ id }) => id === 'container')?.bounds,
				route: input.layout.relations.find(({ id }) => id === 'group-to-target')?.points,
			}),
		).toMatchObject({ valid: true });
	});

	it.each([
		LayoutDirection.TopToBottom,
		LayoutDirection.BottomToTop,
		LayoutDirection.LeftToRight,
		LayoutDirection.RightToLeft,
	])('accepts principal-face routes in %s layouts', (direction) => {
		const input = directionFixture(direction);
		expect(validateDedicatedCandidate(input)).toMatchObject({ valid: true });
	});

	it.each([15, 31])(
		'routes the %i-node binary decision tree without foreign contacts in every direction',
		(count) => {
			const ids = Array.from({ length: count }, (_, index) => `n${index}`);
			const template = validLogicDocument();
			for (const direction of Object.values(LayoutDirection)) {
				const document: LogicDocument = {
					...template,
					layout: configurationFor(direction),
					groups: [],
					junctions: [],
					nodes: ids.map((id, index) => ({
						id,
						kind: EndpointKind.Node,
						natureId: template.natures[0]?.id ?? 'task',
						markdown: id,
						layoutOrder: orderKey(`a${(index + 1).toString(36)}`),
					})),
					relations: ids.slice(1).map((id, index) => ({
						id: `r${index}`,
						from: defined(ids[Math.floor(index / 2)]),
						to: id,
					})),
				};
				const prepared = createGraph(document);
				if (!prepared.ok) throw new Error('Invalid binary decision tree');
				const graph = prepared.value;
				const ranks = topologicallyRank(graph);
				const measurements = layoutMeasurementsFor(document, {
					nodes: Object.fromEntries(ids.map((id) => [id, { width: 80, height: 40 }])),
				});
				const layout = layoutWithDedicatedEngine(graph, ranks, measurements);
				const validation = validateDedicatedCandidate({ graph, ranks, measurements, layout });
				expect(
					validation,
					`${count} nodes, ${direction}: ${JSON.stringify(validation)}`,
				).toMatchObject({
					valid: true,
				});
				if (count === 15 && direction === LayoutDirection.TopToBottom) {
					const crossingIds = ['a', 'b', 'c', 'd'];
					const combined: LogicDocument = {
						...document,
						nodes: [
							...document.nodes,
							...crossingIds.map((id, index) => ({
								id,
								kind: EndpointKind.Node as const,
								natureId: defined(document.nodes[0]).natureId,
								markdown: id,
								layoutOrder: orderKey(`b0${index + 1}`),
							})),
						],
						relations: [
							...document.relations,
							{ id: 'cross-a-c', from: 'a', to: 'c' },
							{ id: 'cross-a-d', from: 'a', to: 'd' },
							{ id: 'cross-b-c', from: 'b', to: 'c' },
							{ id: 'cross-b-d', from: 'b', to: 'd' },
						],
					};
					const combinedGraph = createGraph(combined);
					if (!combinedGraph.ok) throw new Error('Invalid mixed routing graph');
					const mixedRanks = topologicallyRank(combinedGraph.value);
					const mixedMeasurements = layoutMeasurementsFor(combined, {
						nodes: Object.fromEntries(
							combined.nodes.map(({ id }) => [id, { width: 80, height: 40 }]),
						),
					});
					const mixed = layoutWithDedicatedEngine(
						combinedGraph.value,
						mixedRanks,
						mixedMeasurements,
					);
					expect(
						validateDedicatedCandidate({
							graph: combinedGraph.value,
							ranks: mixedRanks,
							measurements: mixedMeasurements,
							layout: mixed,
						}),
					).toMatchObject({ valid: true });
				}
			}
		},
	);

	it('rejects a common source port when paths leave in opposite directions', () => {
		const input = twoOutgoingFixture(LayoutDirection.LeftToRight);
		const first = routeById(input.layout, 'a-to-target');
		const second = routeById(input.layout, 'a-to-isolated');
		const sourcePort = defined(first.points[0]);
		const firstTarget = defined(first.points.at(-1));
		const secondTarget = defined(second.points.at(-1));
		const firstPath = [
			sourcePort,
			{ x: sourcePort.x, y: sourcePort.y + 12 },
			{ x: firstTarget.x, y: sourcePort.y + 12 },
			firstTarget,
		];
		const secondPath = [
			sourcePort,
			{ x: sourcePort.x, y: sourcePort.y - 12 },
			{ x: secondTarget.x, y: sourcePort.y - 12 },
			secondTarget,
		];
		const layout = replaceRoute(
			replaceRoute(input.layout, first.id, (route) => pointsWith(route, firstPath)),
			second.id,
			(route) => pointsWith(route, secondPath),
		);
		expect(validateDedicatedCandidate({ ...input, layout })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.Ports,
		});
	});

	it('rejects two distinct node ports that are closer than the required spacing', () => {
		const input = twoIncomingFixture();
		expect(validateDedicatedCandidate(input)).toMatchObject({ valid: true });
		const first = routeById(input.layout, 'a-to-target');
		const second = routeById(input.layout, 'b-to-target');
		const firstPort = defined(first.points.at(-1));
		const secondPrevious = defined(second.points.at(-2));
		const secondPort = { x: firstPort.x + 24, y: firstPort.y };
		const penultimateY = firstPort.y - 24;
		const tooClose = [
			...second.points.slice(0, -2),
			secondPrevious,
			{ x: secondPrevious.x, y: penultimateY },
			{ x: secondPort.x, y: penultimateY },
			secondPort,
		];
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, second.id, (route) => pointsWith(route, tooClose)),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Ports });
	});

	it('accepts an actual shared outgoing prefix rooted at one source port', () => {
		const input = twoOutgoingFixture();
		const first = routeById(input.layout, 'a-to-target');
		const second = routeById(input.layout, 'a-to-isolated');
		const sourcePort = defined(first.points[0]);
		const branchPoint = defined(first.points[1]);
		const targetPort = defined(second.points.at(-1));
		const sharedPrefix = [
			sourcePort,
			branchPoint,
			{ x: targetPort.x, y: branchPoint.y },
			targetPort,
		];
		const layout = replaceRoute(input.layout, second.id, (route) =>
			pointsWith(route, sharedPrefix),
		);
		expect(validateDedicatedCandidate({ ...input, layout })).toMatchObject({ valid: true });
	});

	it('rejects a route through a group it does not own', () => {
		const input = fixture();
		const route = routeById(input.layout, 'a-to-choice');
		const first = defined(route.points[0]);
		const last = defined(route.points.at(-1));
		const group = input.layout.elements.find(({ id }) => id === 'endpoint-group');
		if (group === undefined) throw new Error('Expected unrelated empty group');
		const center = {
			x: group.bounds.x + group.bounds.width / 2,
			y: group.bounds.y + group.bounds.height / 2,
		};
		const throughGroup = [
			first,
			{ x: center.x, y: first.y },
			center,
			{ x: last.x, y: center.y },
			last,
		];
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, route.id, (candidate) =>
					pointsWith(candidate, throughGroup),
				),
			}),
		).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.Obstacle,
			endpointId: 'endpoint-group',
		});
	});

	it('rejects zero-length contact between adjacent source and target faces', () => {
		const input = directionFixture(LayoutDirection.BottomToTop);
		const source = input.layout.elements.find(({ id }) => id === 'source-a');
		const target = input.layout.elements.find(({ id }) => id === 'target');
		if (source === undefined || target === undefined) throw new Error('Expected source and target');
		const touchingTarget = {
			...target,
			bounds: { ...target.bounds, x: source.bounds.x, y: source.bounds.y + source.bounds.height },
		};
		const point = {
			x: source.bounds.x + source.bounds.width / 2,
			y: touchingTarget.bounds.y,
		};
		const layout = {
			...replaceRoute(
				replaceElement(input.layout, target.id, () => touchingTarget),
				'source-to-target',
				(route) => pointsWith(route, [point, point]),
			),
			height: Math.max(input.layout.height, touchingTarget.bounds.y + touchingTarget.bounds.height),
		};
		expect(validateDedicatedCandidate({ ...input, layout })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.Route,
		});
	});

	it('rejects missing, duplicate, and wrong-kind element identities', () => {
		const input = fixture();
		const first = input.layout.elements[0];
		if (first === undefined) throw new Error('Expected a layout element');
		expect(
			validateDedicatedCandidate({
				...input,
				layout: { ...input.layout, elements: input.layout.elements.slice(1) },
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.ElementInventory });
		expect(
			validateDedicatedCandidate({
				...input,
				layout: { ...input.layout, elements: [...input.layout.elements, first] },
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.ElementInventory });
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceElement(input.layout, first.id, (element) => ({
					...element,
					id: 'unknown',
				})),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.ElementInventory });
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceElement(input.layout, first.id, (element) => ({
					...element,
					kind: EndpointKind.Group,
				})),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.ElementInventory });
	});

	it('rejects missing and non-finite node measurements', () => {
		const input = fixture();
		const missingNode = new Map(input.measurements.nodes);
		missingNode.delete('source-a');
		expect(
			validateDedicatedCandidate({
				...input,
				measurements: { ...input.measurements, nodes: missingNode },
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.MinimumSize });
		const invalidNode = new Map(input.measurements.nodes);
		invalidNode.set('source-a', {
			width: Number.NaN,
			height: input.measurements.nodes.get('source-a')?.height ?? 1,
		});
		expect(
			validateDedicatedCandidate({
				...input,
				measurements: { ...input.measurements, nodes: invalidNode },
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.MinimumSize });
	});

	it('rejects invalid extents, subminimum boxes, and boxes beyond the canvas', () => {
		const input = fixture();
		const invalidGroupMeasurements = new Map(input.measurements.groups);
		const groupMeasurement = invalidGroupMeasurements.get('container');
		if (groupMeasurement === undefined) throw new Error('Expected group measurement');
		invalidGroupMeasurements.set('container', { ...groupMeasurement, padding: -1 });
		expect(
			validateDedicatedCandidate({
				...input,
				measurements: {
					...input.measurements,
					groups: new Map([['container', { ...groupMeasurement, headerHeight: Number.NaN }]]),
				},
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.MinimumSize });
		expect(
			validateDedicatedCandidate({
				...input,
				measurements: { ...input.measurements, groups: invalidGroupMeasurements },
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.MinimumSize });
		const node = input.layout.elements.find(({ id }) => id === 'source-a');
		if (node === undefined) throw new Error('Expected source node');
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceElement(input.layout, node.id, (element) => ({
					...element,
					bounds: { ...element.bounds, width: Number.NaN },
				})),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.InvalidBounds });
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceElement(input.layout, node.id, (element) => ({
					...element,
					bounds: { ...element.bounds, width: 1, height: 1 },
				})),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.MinimumSize });
		expect(
			validateDedicatedCandidate({ ...input, layout: { ...input.layout, width: 1 } }),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.InvalidCanvas });
		expect(
			validateDedicatedCandidate({
				...input,
				layout: { ...input.layout, height: Number.NaN },
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.InvalidCanvas });
	});

	it('rejects rank inversions and group members outside the padded group interior', () => {
		const input = fixture();
		const source = input.layout.elements.find(({ id }) => id === 'source-a');
		const target = input.layout.elements.find(({ id }) => id === 'target');
		const group = input.layout.elements.find(({ id }) => id === 'container');
		if (source === undefined || target === undefined || group === undefined)
			throw new Error('Expected grouped source and target elements');
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceElement(input.layout, target.id, (element) => ({
					...element,
					bounds: source.bounds,
				})),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.RankOrder });
		const shifted = replaceElement(input.layout, source.id, (element) => ({
			...element,
			bounds: { ...element.bounds, x: group.bounds.x + group.bounds.width + 1 },
		}));
		expect(validateDedicatedCandidate({ ...input, layout: shifted })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.GroupContainment,
		});
	});

	it('rejects interleaved ordinary bands even when their centers retain rank order', () => {
		const input = directionFixture(LayoutDirection.TopToBottom);
		const first = defined(input.layout.elements.find(({ id }) => id === 'source-a'));
		const second = defined(input.layout.elements.find(({ id }) => id === 'target'));
		let earlier = first;
		let later = second;
		if (second.bounds.y < first.bounds.y) {
			earlier = second;
			later = first;
		}
		const moved = replaceElement(input.layout, later.id, (element) => ({
			...element,
			bounds: {
				...element.bounds,
				y: earlier.bounds.y + earlier.bounds.height - later.bounds.height / 3,
			},
		}));
		const shifted = defined(moved.elements.find(({ id }) => id === later.id));
		expect(shifted.bounds.y + shifted.bounds.height / 2).toBeGreaterThan(
			earlier.bounds.y + earlier.bounds.height / 2,
		);
		expect(validateDedicatedCandidate({ ...input, layout: moved })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.RankOrder,
		});
	});

	it('rejects a junction moved into its neighboring ordinary rank', () => {
		const input = fixture();
		const junction = defined(input.layout.elements.find(({ id }) => id === 'choice'));
		const source = defined(input.layout.elements.find(({ id }) => id === 'source-a'));
		const moved = replaceElement(input.layout, junction.id, (element) => ({
			...element,
			bounds: { ...element.bounds, y: source.bounds.y + source.bounds.height / 2 },
		}));
		expect(validateDedicatedCandidate({ ...input, layout: moved })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.RankOrder,
		});
	});

	it('keeps connected junction rails in their interval and depth order', () => {
		const base = validLogicDocument();
		const choice = defined(base.junctions.find(({ id }) => id === 'choice'));
		const document = {
			...base,
			junctions: [...base.junctions, { ...choice, id: 'gate' }],
			relations: [
				...base.relations.filter(({ id }) => id !== 'choice-to-target' && id !== 'group-to-target'),
				{ id: 'choice-to-gate', from: 'choice', to: 'gate' },
				{ id: 'gate-to-target', from: 'gate', to: 'target' },
			],
		};
		const prepared = prepareLayoutDocument(document);
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
		const first = defined(layout.elements.find(({ id }) => id === 'choice'));
		const second = defined(layout.elements.find(({ id }) => id === 'gate'));
		const moved = replaceElement(layout, first.id, (element) => ({
			...element,
			bounds: { ...element.bounds, y: second.bounds.y },
		}));
		expect(validateDedicatedCandidate({ ...prepared, layout: moved })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.RankOrder,
		});
	});

	it('rejects overlap between unrelated elements', () => {
		const input = fixture();
		const target = input.layout.elements.find(({ id }) => id === 'target');
		const isolated = input.layout.elements.find(({ id }) => id === 'isolated');
		if (target === undefined || isolated === undefined) throw new Error('Expected unrelated nodes');
		const layout = replaceElement(input.layout, isolated.id, (element) => ({
			...element,
			bounds: target.bounds,
		}));
		expect(validateDedicatedCandidate({ ...input, layout })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.ElementOverlap,
		});
	});

	it('rejects missing, duplicate, and redirected routes', () => {
		const input = fixture();
		const first = input.layout.relations[0];
		if (first === undefined) throw new Error('Expected a layout route');
		expect(
			validateDedicatedCandidate({
				...input,
				layout: { ...input.layout, relations: input.layout.relations.slice(1) },
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.RelationInventory });
		expect(
			validateDedicatedCandidate({
				...input,
				layout: { ...input.layout, relations: [...input.layout.relations, first] },
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.RelationInventory });
		const duplicateRoutes = [...input.layout.relations];
		if (duplicateRoutes.length < 2) throw new Error('Expected at least two routes');
		duplicateRoutes[1] = first;
		expect(
			validateDedicatedCandidate({
				...input,
				layout: { ...input.layout, relations: duplicateRoutes },
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.RelationInventory });
		expect(
			validateDedicatedCandidate({
				...input,
				layout: {
					...input.layout,
					relations: input.layout.relations.map((route) => {
						if (route.id !== first.id) return route;
						return { ...route, from: 'unknown' };
					}),
				},
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.RelationInventory });
	});

	it('rejects malformed, detached, and off-canvas route geometry', () => {
		const input = fixture();
		const route = routeById(input.layout, 'a-to-choice');
		const first = route.points[0];
		const second = route.points[1];
		if (first === undefined || second === undefined) throw new Error('Expected route points');
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, route.id, (candidate) => pointsWith(candidate, [])),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Route });
		const nonFinite = route.points.map((point, index) => {
			if (index !== 1) return point;
			return { ...point, x: Number.POSITIVE_INFINITY };
		});
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, route.id, (candidate) =>
					pointsWith(candidate, nonFinite),
				),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Route });
		const offCanvas = route.points.map((point, index) => {
			if (index !== 1) return point;
			return { ...point, x: input.layout.width + 1 };
		});
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, route.id, (candidate) =>
					pointsWith(candidate, offCanvas),
				),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Route });
		const detached = route.points.map((point, index) => {
			if (index !== 0) return point;
			return { ...point, y: point.y + 1 };
		});
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, route.id, (candidate) =>
					pointsWith(candidate, detached),
				),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Attachment });
		const diagonal = route.points.map((point, index) => {
			if (index !== 1) return point;
			return { ...point, x: point.x + 1 };
		});
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, route.id, (candidate) =>
					pointsWith(candidate, diagonal),
				),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Route });
	});

	it('rejects routes through an unrelated element, undersized ports, and self-contacts', () => {
		const input = fixture();
		const route = routeById(input.layout, 'a-to-choice');
		const first = route.points[0];
		const last = route.points.at(-1);
		const obstacle = input.layout.elements.find(({ id }) => id === 'target');
		if (first === undefined || last === undefined || obstacle === undefined)
			throw new Error('Expected route endpoints and obstacle');
		const center = {
			x: obstacle.bounds.x + obstacle.bounds.width / 2,
			y: obstacle.bounds.y + obstacle.bounds.height / 2,
		};
		const throughObstacle = [
			first,
			{ x: center.x, y: first.y },
			center,
			{ x: last.x, y: center.y },
			last,
		];
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, route.id, (candidate) =>
					pointsWith(candidate, throughObstacle),
				),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Obstacle });

		const source = input.layout.elements.find(({ id }) => id === route.from);
		if (source === undefined) throw new Error('Expected route source');
		const edgePort = source.bounds.x + PORT_INSET / 2;
		const tooClose = route.points.map((point, index) => {
			if (index >= 2) return point;
			return { ...point, x: edgePort };
		});
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, route.id, (candidate) =>
					pointsWith(candidate, tooClose),
				),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Ports });

		const selfContact = [
			{ x: 174, y: 216 },
			{ x: 174, y: 240 },
			{ x: 252, y: 240 },
			{ x: 252, y: 258 },
			{ x: 220, y: 258 },
			{ x: 220, y: 232 },
			{ x: 252, y: 232 },
			{ x: 252, y: 240 },
			{ x: 302, y: 240 },
			{ x: 302, y: 264 },
		];
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, route.id, (candidate) =>
					pointsWith(candidate, selfContact),
				),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.SelfContact });
		const loopStart = defined(route.points[0]);
		const bend = defined(route.points[1]);
		const loopEnd = defined(route.points.at(-1));
		const overlapEnd = bend.x + 26;
		const returnStart = overlapEnd + 20;
		const returnEnd = overlapEnd - 1;
		const collinearSelfContact = [
			loopStart,
			bend,
			{ x: overlapEnd, y: bend.y },
			{ x: overlapEnd, y: bend.y + 20 },
			{ x: returnStart, y: bend.y + 20 },
			{ x: returnStart, y: bend.y },
			{ x: returnEnd, y: bend.y },
			{ x: returnEnd, y: loopEnd.y - 10 },
			{ x: loopEnd.x, y: loopEnd.y - 10 },
			loopEnd,
		];
		const collinearLayout = replaceRoute(input.layout, route.id, (candidate) =>
			pointsWith(candidate, collinearSelfContact),
		);
		expect(validateDedicatedCandidate({ ...input, layout: collinearLayout })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.SelfContact,
		});
	});

	it('rejects a collinear vertical self-contact in a route path', () => {
		const route: LayoutRelation = {
			id: 'vertical-self-contact',
			from: 'source',
			to: 'target',
			points: [
				{ x: 0, y: 0 },
				{ x: 0, y: 20 },
				{ x: 20, y: 20 },
				{ x: 20, y: 30 },
				{ x: 0, y: 30 },
				{ x: 0, y: 10 },
			],
		};
		expect(validateSelfContacts(route)).toBe(false);
	});

	it('permits a real junction arrival suffix but rejects T, rejoined, and unbridged contacts', () => {
		const input = fixture();
		const first = routeById(input.layout, 'a-to-choice');
		const second = routeById(input.layout, 'b-to-choice');
		const secondStart = second.points[0];
		const secondFirstBend = second.points[1];
		const sharedStart = first.points[2];
		const targetPort = first.points.at(-1);
		if (
			secondStart === undefined ||
			secondFirstBend === undefined ||
			sharedStart === undefined ||
			targetPort === undefined
		)
			throw new Error('Expected the two junction routes to share an arrival suffix');
		const original = validateDedicatedCandidate(input);
		expect(original).toMatchObject({ valid: true });

		const tContact = [
			secondStart,
			secondFirstBend,
			sharedStart,
			{ x: targetPort.x + 28, y: sharedStart.y },
			{ x: targetPort.x + 28, y: targetPort.y },
			targetPort,
		];
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, second.id, (route) => pointsWith(route, tContact)),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Ports });

		const junctionRejoin = [
			secondStart,
			secondFirstBend,
			sharedStart,
			{ x: sharedStart.x, y: sharedStart.y + 12 },
			{ x: sharedStart.x + 28, y: sharedStart.y + 12 },
			{ x: sharedStart.x + 28, y: targetPort.y - 6 },
			{ x: sharedStart.x, y: targetPort.y - 6 },
			targetPort,
		];
		expect(
			validateDedicatedCandidate({
				...input,
				layout: replaceRoute(input.layout, second.id, (route) => pointsWith(route, junctionRejoin)),
			}),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.RouteContact });

		const junction = input.layout.elements.find(({ id }) => id === 'choice');
		if (junction === undefined) throw new Error('Expected junction box');
		const firstPort = {
			x: junction.bounds.x + JUNCTION_PORT_INSET,
			y: targetPort.y,
		};
		const secondPort = {
			x: junction.bounds.x + junction.bounds.width - JUNCTION_PORT_INSET,
			y: targetPort.y,
		};
		const firstArrival = [
			defined(first.points[0]),
			defined(first.points[1]),
			{ x: firstPort.x, y: sharedStart.y },
			firstPort,
		];
		const secondArrival = [
			secondStart,
			secondFirstBend,
			{ x: firstPort.x, y: sharedStart.y },
			{ x: firstPort.x, y: sharedStart.y + 12 },
			{ x: secondPort.x, y: sharedStart.y + 12 },
			secondPort,
		];
		const splitPorts = replaceRoute(
			replaceRoute(input.layout, first.id, (route) => pointsWith(route, firstArrival)),
			second.id,
			(route) => pointsWith(route, secondArrival),
		);
		expect(validateDedicatedCandidate({ ...input, layout: splitPorts })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.RouteContact,
		});

		const crossingX = defined(first.points[0]).x + 1;
		const crossingY = sharedStart.y;
		const unbridgedCrossing = [
			secondStart,
			{ x: crossingX, y: secondStart.y },
			{ x: crossingX, y: crossingY + 1 },
			{ x: targetPort.x, y: crossingY + 1 },
			targetPort,
		];
		const crossingLayout = replaceRoute(input.layout, second.id, (route) =>
			pointsWith(route, unbridgedCrossing),
		);
		const bridgeAnalysis = routeBridgeAnalysis(crossingLayout.relations);
		expect(bridgeAnalysis.crossings.length).toBe(1);
		expect(bridgeAnalysis.bridges).toHaveLength(0);
		expect(validateDedicatedCandidate({ ...input, layout: crossingLayout })).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.RouteContact,
		});
	});
});

it('prefers fewer validated bridges at equal strict crossings regardless of route length', () => {
	const shorter = { strictCrossings: 2, validatedBridges: 2, length: 1, bends: 0 };
	const cleaner = { strictCrossings: 2, validatedBridges: 1, length: 10_000, bends: 20 };
	expect(compareDedicatedRouteScores(cleaner, shorter)).toBeLessThan(0);
	expect(compareDedicatedRouteScores(shorter, cleaner)).toBeGreaterThan(0);
	expect(compareDedicatedRouteScores({ ...shorter, strictCrossings: 1 }, cleaner)).toBeLessThan(0);
});

it('accepts coincident nested group shells when the child ID sorts before its owner', () => {
	const base = validLogicDocument();
	const template = defined(base.nodes[0]);
	const document: LogicDocument = {
		...base,
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'inner',
				groupId: 'outer',
				label: 'Inner',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Group,
				id: 'outer',
				label: 'Outer',
				layoutOrder: orderKey('a0'),
			},
		],
		nodes: [
			{ ...ungroupNode(template), id: 'member', groupId: 'inner', layoutOrder: orderKey('a2') },
		],
		junctions: [],
		relations: [],
	};
	const measurement = { minimumWidth: 140, minimumHeight: 100, headerHeight: 0, padding: 0 };
	const prepared = prepareLayoutDocument(document, {
		nodes: { member: { width: 100, height: 60 } },
		groups: { inner: measurement, outer: measurement },
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	const inner = defined(layout.elements.find(({ id }) => id === 'inner'));
	const outer = defined(layout.elements.find(({ id }) => id === 'outer'));

	expect(inner.bounds).toEqual(outer.bounds);
	expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
});
