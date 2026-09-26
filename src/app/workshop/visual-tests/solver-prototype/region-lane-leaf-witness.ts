import {
	defined,
	EndpointKind,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../lib/core/document/logic-document';
import { orderKey } from '../../../../lib/core/document/order-key';
import { createGraph } from '../../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../lib/core/graph/topological-ranks';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../lib/core/layout/lanes/shared-lane-layout';
import type {
	Bounds,
	LayoutMeasurements,
	LayoutRelation,
	Point,
} from '../../../../lib/core/layout/layout-types';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../lib/core/layout/region-composition-validation';
import { solveRegionLeafLayout } from '../../../../lib/core/layout/region-leaf-layout';
import {
	normalizeRegionCompositionModel,
	type RegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutSelected,
} from '../../../../lib/core/layout/regions/model/region-composition-types';

const PADDING = 32;
const GAP = 96;
const MARGIN = 48;
const SHARED_REGION_ID = 'shared';
const ORDINARY_REGION_ID = 'ordinary';

interface WitnessLane {
	readonly id: string;
	readonly label: string;
	readonly localId: string;
	readonly regionId: string;
	readonly bounds: Bounds;
}

export interface RegionLaneLeafCandidate {
	readonly model: RegionCompositionModel;
	readonly selected: RegionLayoutSelected;
	readonly lanes: readonly WitnessLane[];
	readonly laneByEndpointId: ReadonlyMap<string, string>;
	readonly localRanks: ReadonlyMap<string, number>;
}

export interface RegionLaneLeafWitness {
	readonly candidate?: RegionLaneLeafCandidate;
	readonly reason?: string;
	readonly compositionIssue?: string | undefined;
	readonly independentIssue?: string | undefined;
}

function sourceDocument(): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'region-lane-leaf-witness',
		title: 'Deux lanes dans une région',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'request',
				natureId: 'task',
				markdown: 'Demande\n',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Node,
				id: 'delivery',
				natureId: 'task',
				markdown: 'Livraison\n',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Node,
				id: 'neighbor',
				natureId: 'task',
				markdown: 'Voisin\n',
				layoutOrder: orderKey('a2'),
			},
		],
		relations: [{ id: 'handoff', from: 'request', to: 'delivery' }],
	};
}

function input(): RegionInput {
	return {
		regions: [
			{ id: '@root', layoutOrder: 'a0' },
			{ id: SHARED_REGION_ID, parentId: '@root', layoutOrder: 'a0' },
			{ id: ORDINARY_REGION_ID, parentId: '@root', layoutOrder: 'a1' },
		],
		regionByEndpointId: new Map([
			['request', SHARED_REGION_ID],
			['delivery', SHARED_REGION_ID],
			['neighbor', ORDINARY_REGION_ID],
		]),
	};
}

function measuredNodes(neighborWidth: number): LayoutMeasurements {
	return {
		nodes: new Map([
			['request', { width: 132.25, height: 64.5 }],
			['delivery', { width: 145.25, height: 68.5 }],
			['neighbor', { width: neighborWidth, height: 72.5 }],
		]),
		groups: new Map(),
		junctions: new Map(),
	};
}

function localMeasurements(all: LayoutMeasurements, ids: readonly string[]): LayoutMeasurements {
	return {
		nodes: new Map(ids.map((id) => [id, defined(all.nodes.get(id))])),
		groups: new Map(),
		junctions: new Map(),
	};
}

function localDocument(
	source: LogicDocument,
	regionId: string,
	orientation: LaneOrientation,
): LogicDocument {
	const owner = input().regionByEndpointId;
	const nodes = source.nodes.filter(({ id }) => owner.get(id) === regionId);
	const ids = new Set(nodes.map(({ id }) => id));
	const relations = source.relations.filter(({ from, to }) => ids.has(from) && ids.has(to));
	if (regionId === ORDINARY_REGION_ID) return { ...source, nodes, relations };
	function laneFor(id: string): string {
		if (id === 'request') return 'sales';
		return 'service';
	}
	return {
		...source,
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: orientation,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'sales', label: 'Vente', layoutOrder: orderKey('a0') },
				{ id: 'service', label: 'Service', layoutOrder: orderKey('a1') },
			],
		},
		nodes: nodes.map((node) => ({
			...node,
			laneId: laneFor(node.id),
		})),
		relations,
	};
}

function movePoint(point: Point, delta: Point): Point {
	return { x: point.x + delta.x, y: point.y + delta.y };
}

function moveBounds(bounds: Bounds, delta: Point): Bounds {
	return { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y };
}

function moveRoute(route: LayoutRelation, delta: Point): LayoutRelation {
	return { ...route, points: route.points.map((point) => movePoint(point, delta)) };
}

function contains(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

function sameBounds(left: Bounds, right: Bounds): boolean {
	return (
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height
	);
}

function separate(left: Bounds, right: Bounds): boolean {
	return (
		left.x + left.width <= right.x ||
		right.x + right.width <= left.x ||
		left.y + left.height <= right.y ||
		right.y + right.height <= left.y
	);
}

/** Checks the displayed lane frames and routes independently of both leaf solvers. */
export function validateRegionLaneLeafWitness(
	candidate: RegionLaneLeafCandidate,
): string | undefined {
	const { selected, lanes, laneByEndpointId } = candidate;
	const shared = selected.regions.find(({ id }) => id === SHARED_REGION_ID);
	const ordinary = selected.regions.find(({ id }) => id === ORDINARY_REGION_ID);
	if (shared === undefined || ordinary === undefined || !separate(shared.bounds, ordinary.bounds))
		return 'The two region frames overlap or are missing.';
	const root = { x: 0, y: 0, width: selected.layout.width, height: selected.layout.height };
	for (const placement of [shared, ordinary]) {
		if (!contains(root, placement.bounds)) return `Region ${placement.id} leaves the canvas.`;
		for (const local of placement.localLayout.elements) {
			const global = selected.layout.elements.find(({ id }) => id === local.id);
			if (
				global === undefined ||
				!sameBounds(global.bounds, moveBounds(local.bounds, placement.translation))
			)
				return `Element ${local.id} disagrees with its translated leaf.`;
			if (!contains(placement.bounds, global.bounds))
				return `Element ${local.id} leaves its region.`;
		}
		for (const local of placement.localLayout.relations) {
			const global = selected.layout.relations.find(({ id }) => id === local.id);
			const expected = moveRoute(local, placement.translation);
			if (global === undefined || JSON.stringify(global.points) !== JSON.stringify(expected.points))
				return `Relation ${local.id} disagrees with its translated leaf.`;
			for (const point of global.points)
				if (!contains(placement.bounds, { ...point, width: 0, height: 0 }))
					return `Relation ${local.id} leaves its region.`;
			for (let index = 1; index < global.points.length; index += 1) {
				const first = defined(global.points[index - 1]);
				const second = defined(global.points[index]);
				if (first.x !== second.x && first.y !== second.y)
					return `Relation ${local.id} is not orthogonal.`;
			}
		}
	}
	if (lanes.length !== 2 || selected.layout.lanes?.length !== lanes.length)
		return 'The shared leaf must publish two lanes.';
	const localLanes = shared.localLayout.lanes ?? [];
	for (const lane of lanes) {
		const local = localLanes.find(({ id }) => id === lane.localId);
		const published = selected.layout.lanes.find(
			({ id, regionId }) => id === lane.localId && regionId === lane.regionId,
		);
		if (local === undefined || published === undefined || lane.regionId !== shared.id)
			return `Lane ${lane.id} is missing or has the wrong owner.`;
		if (published.label !== lane.label) return `Lane ${lane.id} is missing or has the wrong owner.`;
		if (!sameBounds(lane.bounds, moveBounds(local.bounds, shared.translation)))
			return `Lane ${lane.id} disagrees with its translated leaf.`;
		if (!sameBounds(lane.bounds, published.bounds) || !contains(shared.bounds, lane.bounds))
			return `Lane ${lane.id} leaves its region.`;
	}
	if (!separate(defined(lanes[0]).bounds, defined(lanes[1]).bounds))
		return 'The two lanes overlap.';
	for (const [endpointId, laneId] of laneByEndpointId) {
		const box = selected.layout.elements.find(({ id }) => id === endpointId)?.bounds;
		const lane = lanes.find(({ localId }) => localId === laneId);
		if (box === undefined || lane === undefined || !contains(lane.bounds, box))
			return `Element ${endpointId} leaves lane ${laneId}.`;
	}
	return undefined;
}

/** Experimental composition: real lane and dedicated leaf solvers, workshop-only row placement. */
export function runRegionLaneLeafWitness(
	orientation: LaneOrientation = LaneOrientation.Parallel,
	neighborWidth = 120.5,
): RegionLaneLeafWitness {
	const source = sourceDocument();
	const sourceGraph = createGraph(source);
	if (!sourceGraph.ok) throw new Error('The source graph is invalid.');
	const normalized = normalizeRegionCompositionModel(sourceGraph.value, input());
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	const allMeasurements = measuredNodes(neighborWidth);
	const sharedDocument = localDocument(source, SHARED_REGION_ID, orientation);
	const sharedGraph = createGraph(sharedDocument);
	if (!sharedGraph.ok) throw new Error('The shared leaf graph is invalid.');
	const sharedRanks = topologicallyRank(sharedGraph.value);
	const sharedAttempt = solveSharedLaneLayout(
		sharedGraph.value,
		sharedRanks,
		localMeasurements(
			allMeasurements,
			sharedDocument.nodes.map(({ id }) => id),
		),
	);
	if (sharedAttempt.status !== SharedLaneLayoutStatus.Selected)
		return { reason: `${sharedAttempt.status}: ${sharedAttempt.reason}` };
	const ordinaryDocument = localDocument(source, ORDINARY_REGION_ID, orientation);
	const ordinary = solveRegionLeafLayout({
		document: ordinaryDocument,
		measurements: localMeasurements(
			allMeasurements,
			ordinaryDocument.nodes.map(({ id }) => id),
		),
		leafPolicy: LayoutPolicy.Layered,
	});
	const labels = new Map(
		defined(sharedDocument.presentation).lanes.map(({ id, label }) => [id, label]),
	);
	const sharedLanes = defined(sharedAttempt.layout.lanes).map((lane) => ({
		...lane,
		regionId: SHARED_REGION_ID,
		label: defined(labels.get(lane.id)),
	}));
	const sharedLayout = { ...sharedAttempt.layout, lanes: sharedLanes };
	const ordinaryLayout = ordinary.layout;
	const sharedBounds = {
		x: MARGIN,
		y: MARGIN,
		width: sharedLayout.width + PADDING * 2,
		height: sharedLayout.height + PADDING * 2,
	};
	const ordinaryBounds = {
		x: sharedBounds.x + sharedBounds.width + GAP,
		y: MARGIN,
		width: ordinaryLayout.width + PADDING * 2,
		height: ordinaryLayout.height + PADDING * 2,
	};
	const sharedTranslation = { x: sharedBounds.x + PADDING, y: sharedBounds.y + PADDING };
	const ordinaryTranslation = { x: ordinaryBounds.x + PADDING, y: ordinaryBounds.y + PADDING };
	const regions: RegionLayoutSelected['regions'] = [
		{
			id: SHARED_REGION_ID,
			parentId: '@root',
			bounds: sharedBounds,
			translation: sharedTranslation,
			localLayout: sharedLayout,
			localRanks: sharedRanks,
		},
		{
			id: ORDINARY_REGION_ID,
			parentId: '@root',
			bounds: ordinaryBounds,
			translation: ordinaryTranslation,
			localLayout: ordinaryLayout,
			localRanks: ordinary.ranks,
		},
	];
	const lanes: WitnessLane[] = sharedLanes.map((lane) => ({
		id: `${SHARED_REGION_ID}/${lane.id}`,
		label: lane.label,
		localId: lane.id,
		regionId: SHARED_REGION_ID,
		bounds: moveBounds(lane.bounds, sharedTranslation),
	}));
	const elements = [
		...sharedLayout.elements.map((element) => ({
			...element,
			bounds: moveBounds(element.bounds, sharedTranslation),
		})),
		...ordinaryLayout.elements.map((element) => ({
			...element,
			bounds: moveBounds(element.bounds, ordinaryTranslation),
		})),
	];
	const relations = sharedLayout.relations.map((route) => moveRoute(route, sharedTranslation));
	const selected: RegionLayoutSelected = {
		status: RegionCompositionStatus.Selected,
		rootId: '@root',
		layout: {
			width: ordinaryBounds.x + ordinaryBounds.width + MARGIN,
			height: Math.max(sharedBounds.height, ordinaryBounds.height) + MARGIN * 2,
			regions: regions.map(({ id, bounds }) => ({ id, bounds })),
			lanes: lanes.map(({ localId, regionId, label, bounds }) => ({
				id: localId,
				regionId,
				label,
				bounds,
			})),
			elements,
			relations,
		},
		regions,
		portals: [],
		ownedRoutes: relations.map(({ id, points }) => ({
			relationId: id,
			regionId: SHARED_REGION_ID,
			points,
		})),
	};
	const candidate: RegionLaneLeafCandidate = {
		model: normalized.model,
		selected,
		lanes,
		laneByEndpointId: new Map([
			['request', 'sales'],
			['delivery', 'service'],
		]),
		localRanks: new Map([...sharedRanks.byEndpointId, ...ordinary.ranks.byEndpointId]),
	};
	return {
		candidate,
		compositionIssue: validateRegionCompositionGeometry(candidate.model, selected),
		independentIssue: validateRegionLaneLeafWitness(candidate),
	};
}
