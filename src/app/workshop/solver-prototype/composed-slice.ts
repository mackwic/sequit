import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import { defined } from '../../../lib/core/document/logic-document';
import { threeIncidenceFaceCapacity } from './face-capacity';
import {
	buildLayeringIR,
	buildLayoutContract,
	type LaneOrientation,
	type PassageLayoutGraph,
	type SliceSettings,
} from './symbolic-lane-slice';

type PassageContract = ReturnType<typeof buildLayoutContract>;
type PassageAlternative = PassageContract['alternatives'][number];
type Layering = ReturnType<typeof buildLayeringIR>;
type FaceContract = ReturnType<typeof threeIncidenceFaceCapacity>;
type FaceAlternative = FaceContract['alternatives'][number];

interface Relation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
}

interface Separation {
	readonly firstRelationId: string;
	readonly secondRelationId: string;
}

/** No positioned rectangle or route enters this combined witness. */
export interface ComposedInput {
	readonly graph: PassageLayoutGraph;
	readonly relations: readonly Relation[];
	readonly targetId: string;
	/** The default keeps the original first-to-last-lane witness. */
	readonly direction?: 'forward' | 'reverse';
	/** Tangential inset on the target's incoming face. */
	readonly faceInset: number;
	/** Tangential distance between distinct target ports. */
	readonly portSpacing: number;
	/** Supplied routing incompatibilities; IDs alone do not imply non-sharing. */
	readonly requiredSeparations?: readonly Separation[];
	/** Prototype scope: crossings need bridges, which this materializer cannot draw. */
	readonly crossingPolicy: 'crossing-free';
}

interface Point {
	readonly x: number;
	readonly y: number;
}

interface Rect extends Point {
	readonly width: number;
	readonly height: number;
}

export interface ComposedGeometry {
	readonly lanes: readonly { readonly id: string; readonly bounds: Rect }[];
	readonly boxes: readonly {
		readonly id: string;
		readonly laneId: string;
		readonly kind: 'node' | 'group';
		readonly bounds: Rect;
	}[];
	readonly paths: readonly {
		readonly relationId: string;
		readonly points: readonly Point[];
		readonly targetPortIndex: number;
		readonly targetPort: Point;
	}[];
	readonly targetFace: 'left' | 'right' | 'top' | 'bottom';
	readonly allocatedLaneGap: number;
	readonly allocatedRankGap: number;
	readonly targetLongitudinalSize: number;
	readonly extent: number;
}

type Score = readonly [locality: number, bends: number, length: number, canvasSize: number];

export interface ComposedCandidate {
	readonly id: string;
	readonly passageId: string;
	readonly passageKind: PassageAlternative['kind'];
	readonly partitionIndex: number;
	readonly portOrderIndex: number;
	readonly portGroups: FaceAlternative['portGroups'];
	readonly portCount: number;
	readonly status: 'selected' | 'feasible' | 'rejected' | 'not-explored';
	readonly reason?: string;
	readonly rejectionPhase?: 'symbolic' | 'geometry';
	readonly demands: {
		readonly targetFaceLongitudinalSize: number;
		readonly laneGap: number;
		readonly rankGap: number;
		readonly emptyRankSize: number;
	};
	readonly geometry?: ComposedGeometry;
	readonly score?: Score;
}

export interface ComposedSolution {
	readonly input: ComposedInput;
	readonly layering: Layering;
	readonly passageContract: PassageContract;
	readonly faceContract: FaceContract;
	readonly candidates: readonly ComposedCandidate[];
	readonly selectedId: string | undefined;
	/** A selected incumbent can still be incomplete if the budget cut later branches. */
	readonly outcome: 'selected' | 'budget-exhausted' | 'infeasible';
	readonly explored: number;
	readonly budget: number;
	readonly truncated: boolean;
}

function normalizedInput(input: ComposedInput): ComposedInput {
	const graph = input.graph;
	const reverse = input.direction === 'reverse';
	let sourceLaneId = graph.lanes[0]?.id;
	let targetLaneId = graph.lanes[2]?.id;
	if (reverse) {
		sourceLaneId = graph.lanes[2]?.id;
		targetLaneId = graph.lanes[0]?.id;
	}
	if (input.relations.length !== 3) throw new Error('The composed slice needs three relations.');
	const elements = [...graph.elements].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	const relations = [...input.relations].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	if (new Set(relations.map(({ id }) => id)).size !== 3)
		throw new Error('Composed relation IDs must be unique.');
	const target = elements.find(({ id }) => id === input.targetId);
	if (target === undefined || target.laneId !== targetLaneId || target.kind !== 'node') {
		if (reverse) throw new Error('The target must be a node in the first lane.');
		throw new Error('The target must be a node in the last lane.');
	}
	for (const relation of relations) {
		if (
			relation.to !== input.targetId ||
			elements.find(({ id }) => id === relation.from)?.laneId !== sourceLaneId
		) {
			if (reverse)
				throw new Error('Each relation must run from the last lane to the shared target.');
			throw new Error('Each relation must run from the first lane to the shared target.');
		}
	}
	if (!Number.isInteger(input.portSpacing) || input.portSpacing <= 0)
		throw new Error('Port spacing must be a positive integer.');
	if (!Number.isFinite(input.faceInset) || input.faceInset < 0)
		throw new Error('Face inset must be non-negative.');
	const separationKeys = new Set<string>();
	const separations: Separation[] = [];
	for (const pair of input.requiredSeparations ?? []) {
		let ordered = pair;
		if (compareCanonicalStrings(pair.firstRelationId, pair.secondRelationId) > 0)
			ordered = {
				firstRelationId: pair.secondRelationId,
				secondRelationId: pair.firstRelationId,
			};
		const key = JSON.stringify([ordered.firstRelationId, ordered.secondRelationId]);
		if (separationKeys.has(key)) continue;
		separationKeys.add(key);
		separations.push(ordered);
	}
	separations.sort(
		(a, b) =>
			compareCanonicalStrings(a.firstRelationId, b.firstRelationId) ||
			compareCanonicalStrings(a.secondRelationId, b.secondRelationId),
	);
	const normalized: ComposedInput = {
		...input,
		graph: { ...graph, elements, relation: defined(relations[0]) },
		relations,
	};
	if (input.requiredSeparations !== undefined)
		return { ...normalized, requiredSeparations: separations };
	return normalized;
}

function point(orientation: LaneOrientation, cross: number, long: number): Point {
	if (orientation === 'vertical') return { x: cross, y: long };
	return { x: long, y: cross };
}

function rect(
	orientation: LaneOrientation,
	cross: number,
	long: number,
	crossSize: number,
	longSize: number,
): Rect {
	if (orientation === 'vertical') return { x: cross, y: long, width: crossSize, height: longSize };
	return { x: long, y: cross, width: longSize, height: crossSize };
}

function crossStart(orientation: LaneOrientation, bounds: Rect): number {
	if (orientation === 'vertical') return bounds.x;
	return bounds.y;
}

function crossEnd(orientation: LaneOrientation, bounds: Rect): number {
	if (orientation === 'vertical') return bounds.x + bounds.width;
	return bounds.y + bounds.height;
}

function sourceFaceCross(orientation: LaneOrientation, bounds: Rect, reverse: boolean): number {
	if (reverse) return crossStart(orientation, bounds);
	return crossEnd(orientation, bounds);
}

function targetFaceCross(orientation: LaneOrientation, bounds: Rect, reverse: boolean): number {
	if (reverse) return crossEnd(orientation, bounds);
	return crossStart(orientation, bounds);
}

function targetFaceFor(
	orientation: LaneOrientation,
	reverse: boolean,
): ComposedGeometry['targetFace'] {
	if (orientation === 'vertical') {
		if (reverse) return 'right';
		return 'left';
	}
	if (reverse) return 'bottom';
	return 'top';
}

function longStart(orientation: LaneOrientation, bounds: Rect): number {
	if (orientation === 'vertical') return bounds.y;
	return bounds.x;
}

function longSize(orientation: LaneOrientation, bounds: Rect): number {
	if (orientation === 'vertical') return bounds.height;
	return bounds.width;
}

function maxDemand(alternative: PassageAlternative, kind: string): number {
	return Math.max(
		0,
		...alternative.demands.filter((demand) => demand.kind === kind).map(({ minimum }) => minimum),
	);
}

function includesBlockingGroup(alternative: PassageAlternative): string | undefined {
	for (const constraint of alternative.hardConstraints)
		if (constraint.kind === 'group-indivisible') return constraint.elementId;
	return undefined;
}

function orderedPortGroups(
	groups: FaceAlternative['portGroups'],
): readonly FaceAlternative['portGroups'][] {
	if (groups.length === 0) return [[]];
	const result: FaceAlternative['portGroups'][] = [];
	for (let index = 0; index < groups.length; index += 1) {
		const group = defined(groups[index]);
		for (const rest of orderedPortGroups(groups.filter((_, other) => other !== index)))
			result.push([group, ...rest]);
	}
	return result;
}

function demandedMetrics(
	alternative: PassageAlternative,
	face: FaceAlternative,
	settings: SliceSettings,
): ComposedCandidate['demands'] {
	const threeTrackMinimum = 2 * settings.clearance + 2 * settings.railSpacing;
	return {
		targetFaceLongitudinalSize: face.metricDemand.minimumCrossSize,
		laneGap: Math.max(settings.laneGap, maxDemand(alternative, 'min-lane-gap'), threeTrackMinimum),
		rankGap: Math.max(settings.rankGap, maxDemand(alternative, 'min-rank-gap'), threeTrackMinimum),
		emptyRankSize: Math.max(maxDemand(alternative, 'min-empty-rank-size'), threeTrackMinimum),
	};
}

function spanFor(rankAlternative: Layering['rankAlternatives'][number], id: string) {
	return defined(rankAlternative.spans.find((item) => item.id === id)).span;
}

function materialize(
	input: ComposedInput,
	layering: Layering,
	passage: PassageAlternative,
	face: FaceAlternative,
	settings: SliceSettings,
	demands: ComposedCandidate['demands'],
): ComposedGeometry {
	const graph = input.graph;
	const orientation = graph.orientation;
	const reverse = input.direction === 'reverse';
	const ranks = defined(
		layering.rankAlternatives.find(({ id }) => id === passage.rankAlternativeId),
	);
	const count = Math.max(...ranks.spans.map(({ span }) => span.last)) + 1;
	const sizes = Array.from({ length: count }, () => settings.railSpacing);
	for (const element of graph.elements) {
		const span = spanFor(ranks, element.id);
		if (span.first !== span.last) continue;
		let size = element.intrinsicSize.longitudinal;
		if (element.id === input.targetId) size = demands.targetFaceLongitudinalSize;
		sizes[span.first] = Math.max(defined(sizes[span.first]), size);
	}
	if (passage.kind === 'insert-rank') {
		const emptyRank = defined(passage.afterRank) + 1;
		sizes[emptyRank] = Math.max(defined(sizes[emptyRank]), demands.emptyRankSize);
	}
	let rankGap = demands.rankGap;
	for (const element of graph.elements) {
		const span = spanFor(ranks, element.id);
		if (span.first === span.last) continue;
		const covered = sizes.slice(span.first, span.last + 1).reduce((sum, size) => sum + size, 0);
		rankGap = Math.max(
			rankGap,
			(element.intrinsicSize.longitudinal - covered) / (span.last - span.first),
		);
	}
	const starts: number[] = [];
	let cursor = settings.clearance;
	for (const size of sizes) {
		starts.push(cursor);
		cursor += size + rankGap;
	}
	const lastBandEnd = defined(starts.at(-1)) + defined(sizes.at(-1));
	let passageLong = lastBandEnd + settings.clearance + settings.railSpacing;
	if (passage.kind === 'existing-slot') {
		const rank = defined(passage.afterRank);
		passageLong = defined(starts[rank]) + defined(sizes[rank]) + rankGap / 2;
	}
	if (passage.kind === 'insert-rank') {
		const rank = defined(passage.afterRank) + 1;
		passageLong = defined(starts[rank]) + defined(sizes[rank]) / 2;
	}
	const extent = Math.max(
		lastBandEnd + settings.clearance,
		passageLong + settings.railSpacing + settings.clearance,
	);
	const laneWidths = graph.lanes.map(({ id, minimumCrossSize }) =>
		Math.max(
			minimumCrossSize,
			...graph.elements
				.filter(({ laneId }) => laneId === id)
				.map(({ intrinsicSize }) => intrinsicSize.cross),
		),
	);
	let cross = 0;
	const lanes = graph.lanes.map((lane, index) => {
		const width = defined(laneWidths[index]);
		const placed = {
			id: lane.id,
			bounds: rect(orientation, cross, 0, width, extent),
		};
		cross += width + demands.laneGap;
		return placed;
	});
	const boxes = graph.elements.map((element) => {
		const laneIndex = graph.lanes.findIndex(({ id }) => id === element.laneId);
		const lane = defined(lanes[laneIndex]);
		const span = spanFor(ranks, element.id);
		const start = defined(starts[span.first]);
		const end = defined(starts[span.last]) + defined(sizes[span.last]);
		let requiredLong = element.intrinsicSize.longitudinal;
		if (element.id === input.targetId) requiredLong = demands.targetFaceLongitudinalSize;
		let longitudinal = requiredLong;
		if (span.first !== span.last) longitudinal = Math.max(requiredLong, end - start);
		return {
			id: element.id,
			laneId: element.laneId,
			kind: element.kind,
			bounds: rect(
				orientation,
				crossStart(orientation, lane.bounds) +
					(defined(laneWidths[laneIndex]) - element.intrinsicSize.cross) / 2,
				start + (end - start - longitudinal) / 2,
				element.intrinsicSize.cross,
				longitudinal,
			),
		};
	});
	let sourceLane = defined(lanes[0]);
	let targetLane = defined(lanes[2]);
	if (reverse) {
		sourceLane = defined(lanes[2]);
		targetLane = defined(lanes[0]);
	}
	const targetBox = defined(boxes.find(({ id }) => id === input.targetId));
	const portIndex = new Map(
		face.portGroups.flatMap((group, index) => group.map((id) => [id, index] as const)),
	);
	const relationsByRank = [...input.relations].sort((a, b) => {
		const aRank = defined(graph.elements.find(({ id }) => id === a.from)).preferredSpan.first;
		const bRank = defined(graph.elements.find(({ id }) => id === b.from)).preferredSpan.first;
		return aRank - bRank || compareCanonicalStrings(a.id, b.id);
	});
	const paths = relationsByRank
		.map((relation, index) => {
			const sourceBox = defined(boxes.find(({ id }) => id === relation.from));
			const targetPortIndex = defined(portIndex.get(relation.id));
			const sourceLong =
				longStart(orientation, sourceBox.bounds) + longSize(orientation, sourceBox.bounds) / 2;
			const targetLong =
				longStart(orientation, targetBox.bounds) +
				longSize(orientation, targetBox.bounds) / 2 +
				(targetPortIndex - (face.portGroups.length - 1) / 2) * input.portSpacing;
			const sourceGutterOffset =
				settings.clearance + (relationsByRank.length - 1 - index) * settings.railSpacing;
			let sourceGutter = crossEnd(orientation, sourceLane.bounds) + sourceGutterOffset;
			if (reverse) sourceGutter = crossStart(orientation, sourceLane.bounds) - sourceGutterOffset;
			let targetGutterIndex = relationsByRank.length - 1 - index;
			if (passageLong < longStart(orientation, targetBox.bounds)) targetGutterIndex = index;
			const targetGutterOffset = settings.clearance + targetGutterIndex * settings.railSpacing;
			let targetGutter = crossStart(orientation, targetLane.bounds) - targetGutterOffset;
			if (reverse) targetGutter = crossEnd(orientation, targetLane.bounds) + targetGutterOffset;
			const track = passageLong + (index - 1) * settings.railSpacing;
			const targetPort = point(
				orientation,
				targetFaceCross(orientation, targetBox.bounds, reverse),
				targetLong,
			);
			return {
				relationId: relation.id,
				points: [
					point(orientation, sourceFaceCross(orientation, sourceBox.bounds, reverse), sourceLong),
					point(orientation, sourceGutter, sourceLong),
					point(orientation, sourceGutter, track),
					point(orientation, targetGutter, track),
					point(orientation, targetGutter, targetLong),
					targetPort,
				],
				targetPortIndex,
				targetPort,
			};
		})
		.sort((a, b) => compareCanonicalStrings(a.relationId, b.relationId));
	return {
		lanes,
		boxes,
		paths,
		targetFace: targetFaceFor(orientation, reverse),
		allocatedLaneGap: demands.laneGap,
		allocatedRankGap: rankGap,
		targetLongitudinalSize: longSize(orientation, targetBox.bounds),
		extent,
	};
}

function overlapsSegment(start: Point, end: Point, box: Rect, clearance: number): boolean {
	const left = box.x - clearance;
	const right = box.x + box.width + clearance;
	const top = box.y - clearance;
	const bottom = box.y + box.height + clearance;
	if (start.x === end.x)
		return (
			start.x > left &&
			start.x < right &&
			Math.max(start.y, end.y) > top &&
			Math.min(start.y, end.y) < bottom
		);
	return (
		start.y > top &&
		start.y < bottom &&
		Math.max(start.x, end.x) > left &&
		Math.min(start.x, end.x) < right
	);
}

function samePoint(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

function onSegment(point: Point, start: Point, end: Point): boolean {
	return (
		Math.min(start.x, end.x) <= point.x &&
		point.x <= Math.max(start.x, end.x) &&
		Math.min(start.y, end.y) <= point.y &&
		point.y <= Math.max(start.y, end.y)
	);
}

/** Endpoints of the contact interval, or one point for a perpendicular crossing. */
function segmentContacts(a: Point, b: Point, c: Point, d: Point): readonly Point[] {
	if (samePoint(a, b) || samePoint(c, d)) return [];
	const aVertical = a.x === b.x;
	const cVertical = c.x === d.x;
	if (aVertical !== cVertical) {
		let vertical = [c, d];
		let horizontal = [a, b];
		if (aVertical) {
			vertical = [a, b];
			horizontal = [c, d];
		}
		const contact = { x: defined(vertical[0]).x, y: defined(horizontal[0]).y };
		if (onSegment(contact, a, b) && onSegment(contact, c, d)) return [contact];
		return [];
	}
	if (aVertical && a.x !== c.x) return [];
	if (!aVertical && a.y !== c.y) return [];
	let axis: 'x' | 'y' = 'x';
	if (aVertical) axis = 'y';
	const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
	const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
	if (low > high) return [];
	if (aVertical)
		return [
			{ x: a.x, y: low },
			{ x: a.x, y: high },
		];
	return [
		{ x: low, y: a.y },
		{ x: high, y: a.y },
	];
}

function faceAssignmentRejection(
	face: FaceAlternative,
	geometry: ComposedGeometry,
): string | undefined {
	const expected = new Map(
		face.portGroups.flatMap((group, index) => group.map((id) => [id, index] as const)),
	);
	for (const path of geometry.paths)
		if (path.targetPortIndex !== expected.get(path.relationId))
			return `La route ${path.relationId} n'utilise pas le port choisi.`;
	return undefined;
}

function boxPlacementRejection(geometry: ComposedGeometry): string | undefined {
	for (const box of geometry.boxes) {
		const lane = defined(geometry.lanes.find(({ id }) => id === box.laneId));
		if (
			box.bounds.x < lane.bounds.x ||
			box.bounds.y < lane.bounds.y ||
			box.bounds.x + box.bounds.width > lane.bounds.x + lane.bounds.width ||
			box.bounds.y + box.bounds.height > lane.bounds.y + lane.bounds.height
		)
			return `La boîte ${box.id} déborde de sa lane.`;
	}
	for (let leftIndex = 0; leftIndex < geometry.boxes.length; leftIndex += 1) {
		const left = defined(geometry.boxes[leftIndex]);
		for (let rightIndex = leftIndex + 1; rightIndex < geometry.boxes.length; rightIndex += 1) {
			const right = defined(geometry.boxes[rightIndex]);
			if (left.laneId !== right.laneId) continue;
			if (
				left.bounds.x < right.bounds.x + right.bounds.width &&
				left.bounds.x + left.bounds.width > right.bounds.x &&
				left.bounds.y < right.bounds.y + right.bounds.height &&
				left.bounds.y + left.bounds.height > right.bounds.y
			)
				return `Les boîtes ${left.id} et ${right.id} se chevauchent.`;
		}
	}
	return undefined;
}

function geometryOwnershipRejection(
	input: ComposedInput,
	geometry: ComposedGeometry,
): string | undefined {
	const laneIds = new Set<string>();
	for (const lane of geometry.lanes) {
		if (laneIds.has(lane.id)) return `La lane ${lane.id} est dupliquée.`;
		laneIds.add(lane.id);
		if (!input.graph.lanes.some(({ id }) => id === lane.id))
			return `La lane ${lane.id} est inconnue.`;
	}
	for (const lane of input.graph.lanes)
		if (!laneIds.has(lane.id)) return `La lane ${lane.id} est absente.`;
	for (const box of geometry.boxes) {
		const element = input.graph.elements.find(({ id }) => id === box.id);
		if (element === undefined) continue;
		if (box.kind !== element.kind) return `La boîte ${box.id} a un mauvais type.`;
		if (box.laneId !== element.laneId) return `La boîte ${box.id} est dans la mauvaise lane.`;
	}
	return undefined;
}

function geometryBoxSetRejection(
	input: ComposedInput,
	geometry: ComposedGeometry,
): string | undefined {
	const boxIds = new Set<string>();
	for (const box of geometry.boxes) {
		if (boxIds.has(box.id)) return `La boîte ${box.id} est dupliquée.`;
		boxIds.add(box.id);
		if (!input.graph.elements.some(({ id }) => id === box.id))
			return `La boîte ${box.id} est inconnue.`;
	}
	for (const element of input.graph.elements)
		if (!boxIds.has(element.id)) return `La boîte ${element.id} est absente.`;
	return undefined;
}

/** Independent post-materialization check of attachments, routes and permitted shared trunks. */
export function validateComposedGeometry(
	input: ComposedInput,
	geometry: ComposedGeometry,
	settings: SliceSettings,
): string | undefined {
	const orientation = input.graph.orientation;
	const reverse = input.direction === 'reverse';
	const ownershipReason = geometryOwnershipRejection(input, geometry);
	if (ownershipReason !== undefined) return ownershipReason;
	const placementReason = boxPlacementRejection(geometry);
	if (placementReason !== undefined) return placementReason;
	const target = geometry.boxes.find(({ id }) => id === input.targetId);
	if (target === undefined) return 'La cible est absente de la géométrie.';
	if (geometry.paths.length !== input.relations.length)
		return 'Le nombre de routes matérialisées est incorrect.';
	if (geometry.targetFace !== targetFaceFor(orientation, reverse))
		return 'La face cible est incorrecte.';
	const seenPaths = new Set<string>();
	for (const path of geometry.paths) {
		if (seenPaths.has(path.relationId)) return `La route ${path.relationId} est dupliquée.`;
		seenPaths.add(path.relationId);
		const relation = input.relations.find(({ id }) => id === path.relationId);
		if (relation === undefined) return `La route ${path.relationId} est inconnue.`;
		const source = geometry.boxes.find(({ id }) => id === relation.from);
		if (source === undefined) return `La source ${relation.from} est absente.`;
		const first = path.points[0];
		const last = path.points.at(-1);
		if (first === undefined || last === undefined || path.points.length < 2)
			return `La route ${relation.id} est vide.`;
		const expectedSource = point(
			orientation,
			sourceFaceCross(orientation, source.bounds, reverse),
			longStart(orientation, source.bounds) + longSize(orientation, source.bounds) / 2,
		);
		if (!samePoint(first, expectedSource))
			return `La route ${relation.id} quitte une mauvaise face source.`;
		if (!samePoint(last, path.targetPort)) return `La route ${relation.id} manque son port cible.`;
		let portCross = path.targetPort.y;
		if (orientation === 'vertical') portCross = path.targetPort.x;
		const expectedTargetCross = targetFaceCross(orientation, target.bounds, reverse);
		if (expectedTargetCross !== portCross)
			return `Le port cible de ${relation.id} n'est pas sur la face entrante.`;
		const targetStart = longStart(orientation, target.bounds);
		let portLong = path.targetPort.x;
		if (orientation === 'vertical') portLong = path.targetPort.y;
		if (
			portLong < targetStart + input.faceInset ||
			portLong > targetStart + longSize(orientation, target.bounds) - input.faceInset
		)
			return `Le port cible de ${relation.id} viole l'inset.`;
		for (let index = 1; index < path.points.length; index += 1) {
			const start = defined(path.points[index - 1]);
			const end = defined(path.points[index]);
			if (start.x !== end.x && start.y !== end.y)
				return `La route ${relation.id} contient un segment oblique.`;
		}
		for (let firstIndex = 1; firstIndex < path.points.length; firstIndex += 1) {
			for (let secondIndex = firstIndex + 2; secondIndex < path.points.length; secondIndex += 1) {
				if (
					segmentContacts(
						defined(path.points[firstIndex - 1]),
						defined(path.points[firstIndex]),
						defined(path.points[secondIndex - 1]),
						defined(path.points[secondIndex]),
					).length > 0
				)
					return `La route ${relation.id} se croise elle-même.`;
			}
		}
	}
	for (let a = 0; a < geometry.paths.length; a += 1) {
		const first = defined(geometry.paths[a]);
		for (let b = a + 1; b < geometry.paths.length; b += 1) {
			const second = defined(geometry.paths[b]);
			const samePort = first.targetPortIndex === second.targetPortIndex;
			let firstLong = first.targetPort.x;
			let secondLong = second.targetPort.x;
			if (orientation === 'vertical') {
				firstLong = first.targetPort.y;
				secondLong = second.targetPort.y;
			}
			if (samePort && !samePoint(first.targetPort, second.targetPort))
				return 'Un port partagé a deux positions.';
			if (!samePort && Math.abs(firstLong - secondLong) < input.portSpacing)
				return 'Deux ports distincts sont trop proches.';
			const firstTerminalStart = defined(first.points.at(-2));
			const secondTerminalStart = defined(second.points.at(-2));
			for (let firstIndex = 1; firstIndex < first.points.length; firstIndex += 1) {
				for (let secondIndex = 1; secondIndex < second.points.length; secondIndex += 1) {
					const contacts = segmentContacts(
						defined(first.points[firstIndex - 1]),
						defined(first.points[firstIndex]),
						defined(second.points[secondIndex - 1]),
						defined(second.points[secondIndex]),
					);
					if (
						contacts.some(
							(contact) =>
								!samePort ||
								!onSegment(contact, firstTerminalStart, first.targetPort) ||
								!onSegment(contact, secondTerminalStart, second.targetPort),
						)
					)
						return `Les routes ${first.relationId} et ${second.relationId} se croisent hors du tronc partagé.`;
				}
			}
		}
	}
	for (const path of geometry.paths) {
		const relation = defined(input.relations.find(({ id }) => id === path.relationId));
		for (let index = 1; index < path.points.length; index += 1) {
			const start = defined(path.points[index - 1]);
			const end = defined(path.points[index]);
			for (const box of geometry.boxes) {
				if (box.id === relation.from && index === 1) continue;
				if (box.id === relation.to && index === path.points.length - 1) continue;
				if (overlapsSegment(start, end, box.bounds, settings.clearance)) {
					let noun = 'la boîte';
					if (box.kind === 'group') noun = 'le groupe';
					return `La route ${relation.id} touche ${noun} ${box.id}.`;
				}
			}
		}
	}
	return geometryBoxSetRejection(input, geometry);
}

function scoreFor(passage: PassageAlternative, geometry: ComposedGeometry): Score {
	let bends = 0;
	let length = 0;
	for (const path of geometry.paths) {
		let previousAxis: 'x' | 'y' | undefined;
		for (let index = 1; index < path.points.length; index += 1) {
			const before = defined(path.points[index - 1]);
			const after = defined(path.points[index]);
			const dx = after.x - before.x;
			const dy = after.y - before.y;
			if (dx === 0 && dy === 0) continue;
			length += Math.abs(dx) + Math.abs(dy);
			let axis: 'x' | 'y' = 'y';
			if (dy === 0) axis = 'x';
			if (previousAxis !== undefined && previousAxis !== axis) bends += 1;
			previousAxis = axis;
		}
	}
	let locality = 2;
	if (passage.kind === 'existing-slot') locality = 0;
	if (passage.kind === 'insert-rank') locality = 1;
	const lastLane = defined(geometry.lanes.at(-1));
	const canvasSize =
		(lastLane.bounds.x + lastLane.bounds.width) * (lastLane.bounds.y + lastLane.bounds.height);
	return [locality, bends, length, canvasSize];
}

function compareCandidates(left: ComposedCandidate, right: ComposedCandidate): number {
	const a = defined(left.score);
	const b = defined(right.score);
	for (let index = 0; index < a.length; index += 1) {
		const diff = defined(a[index]) - defined(b[index]);
		if (diff !== 0) return diff;
	}
	return compareCanonicalStrings(left.id, right.id);
}

/** Composes passage and face alternatives before any branch receives coordinates. */
export function solveComposedSlice(
	rawInput: ComposedInput,
	settings: SliceSettings,
): ComposedSolution {
	if (!Number.isInteger(settings.budget) || settings.budget < 0)
		throw new Error('Budget must be a non-negative integer.');
	if (
		[settings.laneGap, settings.rankGap, settings.railSpacing].some(
			(value) => !Number.isFinite(value) || value <= 0,
		) ||
		!Number.isFinite(settings.clearance) ||
		settings.clearance < 0
	)
		throw new Error('Invalid metric settings.');
	const input = normalizedInput(rawInput);
	const target = defined(input.graph.elements.find(({ id }) => id === input.targetId));
	const layering = buildLayeringIR(input.graph);
	const passageContract = buildLayoutContract(input.graph, layering, settings);
	let faceInput: Parameters<typeof threeIncidenceFaceCapacity>[0] = {
		endpointId: input.targetId,
		role: 'incoming',
		incidences: input.relations.map(({ id, from }) => ({
			relationId: id,
			oppositeEndpointId: from,
		})),
		/** Left/top incoming face: its tangent is the node's longitudinal axis. */
		intrinsicCrossSize: target.intrinsicSize.longitudinal,
		inset: input.faceInset,
		spacing: input.portSpacing,
	};
	if (input.requiredSeparations !== undefined)
		faceInput = {
			...faceInput,
			requiredSeparations: input.requiredSeparations,
		};
	const faceContract = threeIncidenceFaceCapacity(faceInput);
	const orderedFaces = faceContract.alternatives.flatMap((partition, partitionIndex) =>
		orderedPortGroups(partition.portGroups).map((portGroups, portOrderIndex) => ({
			face: { ...partition, portGroups },
			partitionIndex,
			portOrderIndex,
		})),
	);
	const pairs = passageContract.alternatives.flatMap((passage) =>
		orderedFaces.map((faceChoice) => ({ passage, ...faceChoice })),
	);
	const candidates = pairs.map(
		({ passage, face, partitionIndex, portOrderIndex }, index): ComposedCandidate => {
			const id = `${passage.id}/ports-${partitionIndex}-order-${portOrderIndex}`;
			const base = {
				id,
				passageId: passage.id,
				passageKind: passage.kind,
				partitionIndex,
				portOrderIndex,
				portGroups: face.portGroups,
				portCount: face.portGroups.length,
				demands: demandedMetrics(passage, face, settings),
			};
			if (index >= settings.budget)
				return {
					...base,
					status: 'not-explored',
					reason: 'Budget de branches atteint.',
				};
			if (!face.respectsRequiredSeparations)
				return {
					...base,
					status: 'rejected',
					rejectionPhase: 'symbolic',
					reason: 'Les ports partagés violent une séparation requise.',
				};
			const group = includesBlockingGroup(passage);
			if (group !== undefined)
				return {
					...base,
					status: 'rejected',
					rejectionPhase: 'symbolic',
					reason: `Le passage couperait le groupe ${group}.`,
				};
			const ceiling = passage.hardConstraints.find(({ kind }) => kind === 'metric-ceiling');
			if (ceiling?.kind === 'metric-ceiling' && base.demands.laneGap > ceiling.maximum)
				return {
					...base,
					status: 'rejected',
					rejectionPhase: 'symbolic',
					reason: 'La gouttière dépasse son plafond.',
				};
			const geometry = materialize(input, layering, passage, face, settings, base.demands);
			const reason =
				faceAssignmentRejection(face, geometry) ??
				validateComposedGeometry(input, geometry, settings);
			if (reason !== undefined)
				return {
					...base,
					status: 'rejected',
					rejectionPhase: 'geometry',
					reason,
					geometry,
				};
			return {
				...base,
				status: 'feasible',
				geometry,
				score: scoreFor(passage, geometry),
			};
		},
	);
	const selected = candidates
		.filter(({ status }) => status === 'feasible')
		.sort(compareCandidates)[0];
	if (selected !== undefined)
		candidates[candidates.indexOf(selected)] = {
			...selected,
			status: 'selected',
		};
	const truncated = pairs.length > settings.budget;
	let outcome: ComposedSolution['outcome'] = 'selected';
	if (selected === undefined) outcome = 'infeasible';
	if (truncated) outcome = 'budget-exhausted';
	return {
		input,
		layering,
		passageContract,
		faceContract,
		candidates,
		selectedId: selected?.id,
		outcome,
		explored: Math.min(pairs.length, settings.budget),
		budget: settings.budget,
		truncated,
	};
}
