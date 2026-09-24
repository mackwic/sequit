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
} from '../../../../lib/core/document/logic-document';
import { orderKey } from '../../../../lib/core/document/order-key';
import { validateLogicDocument } from '../../../../lib/core/document/validate-logic-document';
import { createGraph } from '../../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../lib/core/graph/topological-ranks';
import type { LayoutMeasurements, Point } from '../../../../lib/core/layout/layout-types';
import {
	makeSharedLaneFrame,
	SHARED_LANE_CLEARANCE,
} from '../../../../lib/core/layout/shared-lane-frame';
import { validateSharedLaneGeometry } from '../../../../lib/core/layout/shared-lane-geometry';
import { validateSharedLaneInteriorPassage } from '../../../../lib/core/layout/shared-lane-interior-validation';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../lib/core/layout/shared-lane-layout';
import { prepareSharedLanes } from '../../../../lib/core/layout/shared-lane-model';
import { planSharedLanePorts } from '../../../../lib/core/layout/shared-lane-ports';
import { routeSharedLanes } from '../../../../lib/core/layout/shared-lane-routing';
import type { SharedLaneGeometry } from '../../../../lib/core/layout/shared-lane-types';

export enum PassageCandidateId {
	Exterior = 'exterior',
	Interior = 'interior',
}

interface PassagePanel {
	readonly id: PassageCandidateId;
	readonly title: string;
	readonly geometry: SharedLaneGeometry;
	readonly preferred: boolean;
	readonly monotone: boolean;
	readonly routeLength: number;
	readonly bends: number;
	readonly middleCrossingX: number;
	readonly middleCrossingY: number;
}

export interface SharedLanePassageComparison {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly panels: readonly [PassagePanel, PassagePanel];
	readonly width: number;
	readonly height: number;
	readonly fullViewBox: string;
	readonly focusViewBox: string;
}

function passageDocument(): LogicDocument {
	const node = (id: string, laneId: string, order: string): LogicDocument['nodes'][number] => ({
		kind: EndpointKind.Node,
		id,
		natureId: 'task',
		markdown: id,
		laneId,
		layoutOrder: orderKey(order),
	});
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'workshop-s-sd-c-passage',
		title: 'S | SD | C · comparaison des passages',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: ['S', 'SD', 'C'].map((id, index) => ({
				id,
				label: id,
				layoutOrder: orderKey(`a${index}`),
			})),
		},
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'sd-block',
				label: 'Groupe médian vide',
				laneId: 'SD',
				layoutOrder: orderKey('a0'),
			},
		],
		nodes: [node('c-request', 'C', 'a0'), node('s-receive', 'S', 'a1')],
		junctions: [],
		relations: [{ id: 'request', from: 'c-request', to: 's-receive' }],
	};
}

function passageMeasurements(): LayoutMeasurements {
	return {
		nodes: new Map([
			['c-request', { width: 220, height: 116 }],
			['s-receive', { width: 220, height: 116 }],
		]),
		junctions: new Map(),
		groups: new Map([
			['sd-block', { minimumWidth: 220, minimumHeight: 180, headerHeight: 36, padding: 24 }],
		]),
	};
}

function routeLength(points: readonly Point[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index += 1) {
		const before = defined(points[index - 1]);
		const after = defined(points[index]);
		length += Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
	}
	return length;
}

function bendCount(points: readonly Point[]): number {
	let bends = 0;
	let lastAxis: 'horizontal' | 'vertical' | undefined;
	for (let index = 1; index < points.length; index += 1) {
		const before = defined(points[index - 1]);
		const after = defined(points[index]);
		if (before.x === after.x && before.y === after.y) continue;
		let axis: 'horizontal' | 'vertical' = 'horizontal';
		if (before.x === after.x) axis = 'vertical';
		if (lastAxis !== undefined && axis !== lastAxis) bends += 1;
		lastAxis = axis;
	}
	return bends;
}

function middleCrossingY(geometry: SharedLaneGeometry): number {
	const middle = defined(geometry.lanes.find(({ id }) => id === 'SD')).bounds;
	const route = defined(geometry.relations.find(({ id }) => id === 'request'));
	for (let index = 1; index < route.points.length; index += 1) {
		const before = defined(route.points[index - 1]);
		const after = defined(route.points[index]);
		if (before.y !== after.y) continue;
		const crossesLeft = Math.min(before.x, after.x) < middle.x;
		const crossesRight = Math.max(before.x, after.x) > middle.x + middle.width;
		if (crossesLeft && crossesRight) return before.y;
	}
	throw new Error('The candidate has no crossing through SD.');
}

function panel(
	id: PassageCandidateId,
	title: string,
	geometry: SharedLaneGeometry,
	preferred: boolean,
	monotone: boolean,
): PassagePanel {
	const points = defined(
		geometry.relations.find(({ id: relationId }) => relationId === 'request'),
	).points;
	const middle = defined(geometry.lanes.find(({ id: laneId }) => laneId === 'SD')).bounds;
	return {
		id,
		title,
		geometry,
		preferred,
		monotone,
		routeLength: routeLength(points),
		bends: bendCount(points),
		middleCrossingX: middle.x + middle.width / 2,
		middleCrossingY: middleCrossingY(geometry),
	};
}

function sameFrame(first: SharedLaneGeometry, second: SharedLaneGeometry): boolean {
	return (
		first.width === second.width &&
		first.height === second.height &&
		JSON.stringify(first.lanes) === JSON.stringify(second.lanes) &&
		JSON.stringify(first.elements) === JSON.stringify(second.elements)
	);
}

/** The real lane model and measurements produce two geometrically valid passage candidates. */
export function compareSharedLanePassages(): SharedLanePassageComparison {
	const document = passageDocument();
	const validation = validateLogicDocument(document);
	if (!validation.ok) throw new Error('The workshop passage document is invalid.');
	const built = createGraph(document);
	if (!built.ok) throw new Error('The workshop passage graph is invalid.');
	const graph = built.value;
	const ranks = topologicallyRank(graph);
	const measurements = passageMeasurements();
	const selected = solveSharedLaneLayout(graph, ranks, measurements);
	if (selected.status !== SharedLaneLayoutStatus.Selected)
		throw new Error(`The interior passage was not selected: ${selected.reason}`);
	const input = defined(prepareSharedLanes(graph, ranks, measurements, {}).input);
	const ports = planSharedLanePorts(input);
	const frame = makeSharedLaneFrame(input, ports);
	const exterior: SharedLaneGeometry = {
		width: frame.crossExtent,
		height: frame.longExtent,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeSharedLanes(input, frame, ports),
	};
	const exteriorIssue = validateSharedLaneGeometry(graph, exterior, SHARED_LANE_CLEARANCE);
	if (exteriorIssue !== undefined)
		throw new Error(`The exterior candidate failed: ${exteriorIssue}`);
	const interiorIssue = validateSharedLaneInteriorPassage(graph, selected.geometry, 'request');
	if (interiorIssue !== undefined)
		throw new Error(`The interior candidate failed: ${interiorIssue}`);
	const exteriorMonotonicity = validateSharedLaneInteriorPassage(graph, exterior, 'request');
	if (exteriorMonotonicity?.includes('does not progress monotonically') !== true)
		throw new Error('The exterior candidate unexpectedly became monotone.');
	if (!sameFrame(exterior, selected.geometry))
		throw new Error('The two passage candidates do not share a layout frame.');
	const middle = defined(exterior.lanes.find(({ id }) => id === 'SD')).bounds;
	const focusX = Math.max(0, middle.x - 36);
	const focusWidth = Math.min(exterior.width - focusX, middle.width + 72);
	return {
		document,
		measurements,
		panels: [
			panel(PassageCandidateId.Exterior, 'Rail extérieur', exterior, false, false),
			panel(PassageCandidateId.Interior, 'Passage intérieur', selected.geometry, true, true),
		],
		width: exterior.width,
		height: exterior.height,
		fullViewBox: `0 0 ${exterior.width} ${exterior.height}`,
		focusViewBox: `${focusX} 0 ${focusWidth} ${exterior.height}`,
	};
}
