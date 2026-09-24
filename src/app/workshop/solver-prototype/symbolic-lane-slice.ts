/** A small executable symbolic slice. These lanes are fixtures, not document preferences. */

import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import { defined } from '../../../lib/core/document/logic-document';

export type LaneOrientation = 'vertical' | 'horizontal';
type CandidateKind = 'existing-slot' | 'insert-rank' | 'exterior';

interface IntrinsicSize {
	readonly cross: number;
	readonly longitudinal: number;
}

/** Inclusive visual ranks, before any empty rank is inserted. */
interface RankSpan {
	readonly first: number;
	readonly last: number;
}

export interface PassageLayoutGraph {
	readonly id: string;
	readonly title: string;
	readonly orientation: LaneOrientation;
	readonly lanes: readonly {
		readonly id: string;
		readonly label: string;
		readonly minimumCrossSize: number;
	}[];
	readonly elements: readonly {
		readonly id: string;
		readonly label?: string;
		readonly kind: 'node' | 'group';
		readonly laneId: string;
		readonly preferredSpan: RankSpan;
		readonly intrinsicSize: IntrinsicSize;
	}[];
	readonly relation: { readonly id: string; readonly from: string; readonly to: string };
}

interface LayeredElement {
	readonly id: string;
	readonly laneId: string;
	readonly kind: 'node' | 'group';
	readonly preferredSpan: RankSpan;
	/** The first slice fixes order canonically; this still records the decision domain. */
	readonly orderDomain: readonly number[];
}

interface RankAlternative {
	readonly id: string;
	readonly kind: 'preferred' | 'insert-empty-rank';
	readonly afterRank?: number;
	readonly spans: readonly { readonly id: string; readonly span: RankSpan }[];
	readonly cutsGroups: readonly string[];
}

export interface LayeringIR {
	readonly rankCount: number;
	readonly elements: readonly LayeredElement[];
	readonly rankAlternatives: readonly RankAlternative[];
}

type MetricDemand =
	| { readonly kind: 'min-lane-gap'; readonly minimum: number }
	| { readonly kind: 'min-rank-gap'; readonly minimum: number }
	| { readonly kind: 'min-empty-rank-size'; readonly minimum: number };

type HardConstraint =
	| { readonly kind: 'group-indivisible'; readonly elementId: string }
	| { readonly kind: 'metric-ceiling'; readonly dimension: 'lane-gap'; readonly maximum: number };

interface PassageAlternative {
	readonly id: string;
	readonly kind: CandidateKind;
	readonly afterRank?: number;
	readonly rankAlternativeId: string;
	readonly demands: readonly MetricDemand[];
	readonly hardConstraints: readonly HardConstraint[];
}

export interface LayoutContract {
	readonly alternatives: readonly PassageAlternative[];
	readonly objectiveOrder: readonly [
		'passage-locality',
		'bends',
		'path-length',
		'canvas-growth',
		'canonical-id',
	];
}

export interface SliceSettings {
	readonly laneGap: number;
	readonly rankGap: number;
	readonly clearance: number;
	readonly railSpacing: number;
	readonly budget: number;
	/** A fixture-only contradiction used to exercise infeasible diagnostics. */
	readonly maximumLaneGap?: number;
}

interface Point {
	readonly x: number;
	readonly y: number;
}

interface Rect extends Point {
	readonly width: number;
	readonly height: number;
}

export interface CandidateGeometry {
	readonly lanes: readonly { readonly id: string; readonly label: string; readonly bounds: Rect }[];
	readonly boxes: readonly {
		readonly id: string;
		readonly label: string;
		readonly laneId: string;
		readonly kind: 'node' | 'group';
		readonly bounds: Rect;
	}[];
	readonly path: readonly Point[];
	readonly extent: number;
	readonly allocatedLaneGap: number;
	readonly allocatedRankGap: number;
}

type CandidateScore = readonly [number, number, number, number];

export interface CandidateTrace {
	readonly id: string;
	readonly kind: CandidateKind;
	readonly status: 'selected' | 'feasible' | 'rejected' | 'not-explored';
	readonly reason?: string;
	readonly demands: readonly MetricDemand[];
	readonly geometry?: CandidateGeometry;
	readonly score?: CandidateScore;
}

export interface SymbolicLaneSolution {
	readonly graph: PassageLayoutGraph;
	readonly layering: LayeringIR;
	readonly contract: LayoutContract;
	readonly candidates: readonly CandidateTrace[];
	readonly selectedId: string | undefined;
	readonly outcome: 'selected' | 'budget-exhausted' | 'infeasible';
	readonly explored: number;
	readonly budget: number;
	readonly truncated: boolean;
}

function validateGraph(graph: PassageLayoutGraph): void {
	if (graph.lanes.length !== 3) throw new Error('The slice requires exactly three lanes');
	const laneIds = new Set(graph.lanes.map(({ id }) => id));
	const elementIds = new Set(graph.elements.map(({ id }) => id));
	if (laneIds.size !== graph.lanes.length || elementIds.size !== graph.elements.length)
		throw new Error('Duplicate lane or element ID');
	if (!elementIds.has(graph.relation.from) || !elementIds.has(graph.relation.to))
		throw new Error('Unknown relation endpoint');
	for (const element of graph.elements) {
		if (!laneIds.has(element.laneId)) throw new Error(`Unknown lane ${element.laneId}`);
		const { first, last } = element.preferredSpan;
		if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first)
			throw new Error(`Invalid preferred span for ${element.id}`);
		if (
			!Number.isFinite(element.intrinsicSize.cross) ||
			element.intrinsicSize.cross <= 0 ||
			!Number.isFinite(element.intrinsicSize.longitudinal) ||
			element.intrinsicSize.longitudinal <= 0
		)
			throw new Error(`Invalid intrinsic size for ${element.id}`);
	}
	if (
		graph.lanes.some(
			({ minimumCrossSize }) => !Number.isFinite(minimumCrossSize) || minimumCrossSize <= 0,
		)
	)
		throw new Error('Invalid lane minimum');
	const fromLane = graph.elements.find(({ id }) => id === graph.relation.from)?.laneId;
	const toLane = graph.elements.find(({ id }) => id === graph.relation.to)?.laneId;
	const outer = [graph.lanes[0]?.id, graph.lanes[2]?.id];
	if (!outer.includes(fromLane) || !outer.includes(toLane) || fromLane === toLane)
		throw new Error('The slice routes between the outer lanes');
}

function validateSettings(settings: SliceSettings): void {
	if (!Number.isInteger(settings.budget) || settings.budget < 0)
		throw new Error('Budget must be a non-negative integer');
	if (
		!Number.isFinite(settings.laneGap) ||
		settings.laneGap <= 0 ||
		!Number.isFinite(settings.rankGap) ||
		settings.rankGap <= 0 ||
		!Number.isFinite(settings.railSpacing) ||
		settings.railSpacing <= 0 ||
		!Number.isFinite(settings.clearance) ||
		settings.clearance < 0 ||
		(settings.maximumLaneGap !== undefined &&
			(!Number.isFinite(settings.maximumLaneGap) || settings.maximumLaneGap < 0))
	)
		throw new Error('Invalid metric settings');
}

function insertedSpan(span: RankSpan, afterRank: number): RankSpan {
	if (span.first > afterRank) return { first: span.first + 1, last: span.last + 1 };
	if (span.last > afterRank) return { first: span.first, last: span.last + 1 };
	return span;
}

export function buildLayeringIR(graph: PassageLayoutGraph): LayeringIR {
	validateGraph(graph);
	const ordered = [...graph.elements].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	const rankCount = Math.max(...ordered.map(({ preferredSpan }) => preferredSpan.last)) + 1;
	const elements = ordered.map((element) => ({
		id: element.id,
		laneId: element.laneId,
		kind: element.kind,
		preferredSpan: element.preferredSpan,
		orderDomain: [0] as readonly number[],
	}));
	const preferred: RankAlternative = {
		id: 'preferred',
		kind: 'preferred',
		spans: ordered.map(({ id, preferredSpan }) => ({ id, span: preferredSpan })),
		cutsGroups: [],
	};
	const insertions = Array.from({ length: rankCount - 1 }, (_, afterRank): RankAlternative => ({
		id: `insert-after-${afterRank}`,
		kind: 'insert-empty-rank',
		afterRank,
		spans: ordered.map(({ id, preferredSpan }) => ({
			id,
			span: insertedSpan(preferredSpan, afterRank),
		})),
		cutsGroups: ordered
			.filter(
				({ kind, preferredSpan }) =>
					kind === 'group' && preferredSpan.first <= afterRank && preferredSpan.last > afterRank,
			)
			.map(({ id }) => id),
	}));
	return { rankCount, elements, rankAlternatives: [preferred, ...insertions] };
}

function groupsCrossingSlot(layering: LayeringIR, afterRank: number): readonly string[] {
	return layering.elements
		.filter(
			({ kind, preferredSpan }) =>
				kind === 'group' && preferredSpan.first <= afterRank && preferredSpan.last > afterRank,
		)
		.map(({ id }) => id);
}

export function buildLayoutContract(
	graph: PassageLayoutGraph,
	layering: LayeringIR,
	settings: SliceSettings,
): LayoutContract {
	validateSettings(settings);
	validateGraph(graph);
	const laneDemand: MetricDemand = {
		kind: 'min-lane-gap',
		minimum: 2 * settings.clearance + settings.railSpacing,
	};
	const ceiling: HardConstraint[] = [];
	if (settings.maximumLaneGap !== undefined)
		ceiling.push({
			kind: 'metric-ceiling',
			dimension: 'lane-gap',
			maximum: settings.maximumLaneGap,
		});
	const preferred = layering.rankAlternatives[0];
	if (preferred === undefined) throw new Error('Missing preferred rank alternative');
	const emptyRankDemand: MetricDemand = {
		kind: 'min-empty-rank-size',
		minimum: 2 * settings.clearance + settings.railSpacing,
	};
	const alternatives: PassageAlternative[] = [];
	for (let rank = 0; rank < layering.rankCount - 1; rank += 1) {
		const inserted = layering.rankAlternatives[rank + 1];
		if (inserted === undefined) throw new Error('Missing rank alternative');
		const hardConstraints = [
			...groupsCrossingSlot(layering, rank).map((elementId): HardConstraint => ({
				kind: 'group-indivisible',
				elementId,
			})),
			...ceiling,
		];
		alternatives.push({
			id: `existing-slot-${rank}`,
			kind: 'existing-slot',
			afterRank: rank,
			rankAlternativeId: 'preferred',
			demands: [
				laneDemand,
				groupRankGapDemand(graph, preferred, settings),
				{
					kind: 'min-rank-gap',
					minimum: 2 * settings.clearance + settings.railSpacing,
				},
			],
			hardConstraints,
		});
		alternatives.push({
			id: `insert-rank-${rank}`,
			kind: 'insert-rank',
			afterRank: rank,
			rankAlternativeId: `insert-after-${rank}`,
			demands: [
				laneDemand,
				emptyRankDemand,
				groupRankGapDemand(graph, inserted, settings, emptyRankDemand.minimum),
			],
			hardConstraints,
		});
	}
	alternatives.push({
		id: 'exterior',
		kind: 'exterior',
		rankAlternativeId: 'preferred',
		demands: [laneDemand, groupRankGapDemand(graph, preferred, settings)],
		hardConstraints: ceiling,
	});
	return {
		alternatives,
		objectiveOrder: ['passage-locality', 'bends', 'path-length', 'canvas-growth', 'canonical-id'],
	};
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

function allocatedGap(
	settings: SliceSettings,
	alternative: PassageAlternative,
	kind: 'min-lane-gap' | 'min-rank-gap',
): number {
	let base = settings.rankGap;
	if (kind === 'min-lane-gap') base = settings.laneGap;
	return Math.max(
		base,
		...alternative.demands.filter((demand) => demand.kind === kind).map(({ minimum }) => minimum),
	);
}

function crossStart(orientation: LaneOrientation, bounds: Rect): number {
	if (orientation === 'vertical') return bounds.x;
	return bounds.y;
}

function crossEnd(orientation: LaneOrientation, bounds: Rect): number {
	if (orientation === 'vertical') return bounds.x + bounds.width;
	return bounds.y + bounds.height;
}

function longCenter(orientation: LaneOrientation, bounds: Rect): number {
	if (orientation === 'vertical') return bounds.y + bounds.height / 2;
	return bounds.x + bounds.width / 2;
}

function spanFor(alternative: RankAlternative, id: string): RankSpan {
	const span = alternative.spans.find((item) => item.id === id)?.span;
	if (span === undefined) throw new Error(`Missing rank span for ${id}`);
	return span;
}

function bandSizes(
	graph: PassageLayoutGraph,
	rankAlternative: RankAlternative,
	settings: SliceSettings,
	emptyRankMinimum: number,
): number[] {
	const inserted = rankAlternative.kind === 'insert-empty-rank';
	const count = Math.max(...rankAlternative.spans.map(({ span }) => span.last)) + 1;
	const sizes = Array.from({ length: count }, () => settings.railSpacing);
	for (const element of graph.elements) {
		const span = spanFor(rankAlternative, element.id);
		if (span.first === span.last)
			sizes[span.first] = Math.max(defined(sizes[span.first]), element.intrinsicSize.longitudinal);
	}
	if (inserted) {
		const empty = defined(rankAlternative.afterRank) + 1;
		sizes[empty] = Math.max(defined(sizes[empty]), emptyRankMinimum);
	}
	return sizes;
}

function groupRankGapDemand(
	graph: PassageLayoutGraph,
	rankAlternative: RankAlternative,
	settings: SliceSettings,
	emptyRankMinimum = 0,
): MetricDemand {
	const sizes = bandSizes(graph, rankAlternative, settings, emptyRankMinimum);
	let minimum = settings.rankGap;
	for (const element of graph.elements) {
		const span = spanFor(rankAlternative, element.id);
		if (span.first === span.last) continue;
		let covered = 0;
		for (let rank = span.first; rank <= span.last; rank += 1) covered += defined(sizes[rank]);
		const required = (element.intrinsicSize.longitudinal - covered) / (span.last - span.first);
		minimum = Math.max(minimum, required);
	}
	return { kind: 'min-rank-gap', minimum };
}

function rankBands(
	graph: PassageLayoutGraph,
	rankAlternative: RankAlternative,
	settings: SliceSettings,
	gap: number,
	emptyRankMinimum: number,
): { readonly starts: readonly number[]; readonly sizes: readonly number[]; readonly gap: number } {
	const sizes = bandSizes(graph, rankAlternative, settings, emptyRankMinimum);
	const starts: number[] = [];
	let cursor = settings.clearance;
	for (const size of sizes) {
		starts.push(cursor);
		cursor += size + gap;
	}
	return { starts, sizes, gap };
}

function pathFor(
	graph: PassageLayoutGraph,
	lanes: CandidateGeometry['lanes'],
	boxes: CandidateGeometry['boxes'],
	passageLong: number,
): readonly Point[] {
	const source = defined(boxes.find(({ id }) => id === graph.relation.from));
	const target = defined(boxes.find(({ id }) => id === graph.relation.to));
	const first = defined(lanes[0]);
	const middle = defined(lanes[1]);
	const last = defined(lanes[2]);
	const sourceLong = longCenter(graph.orientation, source.bounds);
	const targetLong = longCenter(graph.orientation, target.bounds);
	const firstEnd = crossEnd(graph.orientation, first.bounds);
	const middleStart = crossStart(graph.orientation, middle.bounds);
	const middleEnd = crossEnd(graph.orientation, middle.bounds);
	const lastStart = crossStart(graph.orientation, last.bounds);
	const firstGutter = (firstEnd + middleStart) / 2;
	const lastGutter = (middleEnd + lastStart) / 2;
	const forward = source.laneId === first.id;
	let sourcePort = crossStart(graph.orientation, source.bounds);
	let targetPort = crossEnd(graph.orientation, target.bounds);
	let sourceGutter = lastGutter;
	let targetGutter = firstGutter;
	if (forward) {
		sourcePort = crossEnd(graph.orientation, source.bounds);
		targetPort = crossStart(graph.orientation, target.bounds);
		sourceGutter = firstGutter;
		targetGutter = lastGutter;
	}
	return [
		point(graph.orientation, sourcePort, sourceLong),
		point(graph.orientation, sourceGutter, sourceLong),
		point(graph.orientation, sourceGutter, passageLong),
		point(graph.orientation, targetGutter, passageLong),
		point(graph.orientation, targetGutter, targetLong),
		point(graph.orientation, targetPort, targetLong),
	];
}

function materialize(
	graph: PassageLayoutGraph,
	layering: LayeringIR,
	alternative: PassageAlternative,
	settings: SliceSettings,
): CandidateGeometry {
	const rankAlternative = defined(
		layering.rankAlternatives.find(({ id }) => id === alternative.rankAlternativeId),
	);
	const laneGap = allocatedGap(settings, alternative, 'min-lane-gap');
	const emptyRankMinimum = Math.max(
		0,
		...alternative.demands
			.filter(({ kind }) => kind === 'min-empty-rank-size')
			.map(({ minimum }) => minimum),
	);
	const { starts, sizes, gap } = rankBands(
		graph,
		rankAlternative,
		settings,
		allocatedGap(settings, alternative, 'min-rank-gap'),
		emptyRankMinimum,
	);
	const laneWidths = graph.lanes.map(({ minimumCrossSize, id }) =>
		Math.max(
			minimumCrossSize,
			...graph.elements
				.filter(({ laneId }) => laneId === id)
				.map(({ intrinsicSize }) => intrinsicSize.cross),
		),
	);
	const lastBandEnd = defined(starts.at(-1)) + defined(sizes.at(-1));
	let passageLong = lastBandEnd + settings.clearance;
	if (alternative.kind === 'existing-slot') {
		const rank = defined(alternative.afterRank);
		passageLong = defined(starts[rank]) + defined(sizes[rank]) + gap / 2;
	}
	if (alternative.kind === 'insert-rank') {
		const rank = defined(alternative.afterRank) + 1;
		passageLong = defined(starts[rank]) + defined(sizes[rank]) / 2;
	}
	const extent = Math.max(lastBandEnd + settings.clearance, passageLong + settings.clearance);
	let cross = 0;
	const lanes = graph.lanes.map((lane, index) => {
		const size = defined(laneWidths[index]);
		const result = {
			id: lane.id,
			label: lane.label,
			bounds: rect(graph.orientation, cross, 0, size, extent),
		};
		cross += size + laneGap;
		return result;
	});
	const boxes = [...graph.elements]
		.sort((a, b) => compareCanonicalStrings(a.id, b.id))
		.map((element) => {
			const laneIndex = graph.lanes.findIndex(({ id }) => id === element.laneId);
			const laneStart = laneWidths
				.slice(0, laneIndex)
				.reduce((sum, size) => sum + size + laneGap, 0);
			const laneSize = defined(laneWidths[laneIndex]);
			const span = spanFor(rankAlternative, element.id);
			const spanStart = defined(starts[span.first]);
			const spanEnd = defined(starts[span.last]) + defined(sizes[span.last]);
			const longSize = Math.max(element.intrinsicSize.longitudinal, spanEnd - spanStart);
			const longStart = spanStart + (spanEnd - spanStart - longSize) / 2;
			return {
				id: element.id,
				label: element.label ?? element.id,
				laneId: element.laneId,
				kind: element.kind,
				bounds: rect(
					graph.orientation,
					laneStart + (laneSize - element.intrinsicSize.cross) / 2,
					longStart,
					element.intrinsicSize.cross,
					longSize,
				),
			};
		});
	return {
		lanes,
		boxes,
		path: pathFor(graph, lanes, boxes, passageLong),
		extent,
		allocatedLaneGap: laneGap,
		allocatedRankGap: gap,
	};
}

function rejectionReason(
	alternative: PassageAlternative,
	geometry: CandidateGeometry,
	graph: PassageLayoutGraph,
	settings: SliceSettings,
): string | undefined {
	for (const constraint of alternative.hardConstraints) {
		if (constraint.kind === 'group-indivisible')
			return `Le passage couperait le groupe ${constraint.elementId}.`;
		if (geometry.allocatedLaneGap > constraint.maximum)
			return `La gouttière requiert ${geometry.allocatedLaneGap}, au-delà du plafond ${constraint.maximum}.`;
	}
	for (const box of geometry.boxes) {
		const lane = defined(geometry.lanes.find(({ id }) => id === box.laneId));
		if (!contains(lane.bounds, box.bounds)) return `La boîte ${box.id} déborde de sa lane.`;
	}
	for (let leftIndex = 0; leftIndex < geometry.boxes.length; leftIndex += 1) {
		const left = defined(geometry.boxes[leftIndex]);
		for (let rightIndex = leftIndex + 1; rightIndex < geometry.boxes.length; rightIndex += 1) {
			const right = defined(geometry.boxes[rightIndex]);
			if (left.laneId !== right.laneId) continue;
			if (overlapBoxes(left.bounds, right.bounds))
				return `Les boîtes ${left.id} et ${right.id} se chevauchent ; l'ordre n'est pas résolu.`;
		}
	}
	for (let index = 1; index < geometry.path.length; index += 1) {
		const start = defined(geometry.path[index - 1]);
		const end = defined(geometry.path[index]);
		for (const box of geometry.boxes) {
			if (box.id === graph.relation.from && index === 1) continue;
			if (box.id === graph.relation.to && index === geometry.path.length - 1) continue;
			if (overlapsSegment(start, end, box.bounds, settings.clearance)) {
				const noun = { node: 'la boîte', group: 'le groupe' }[box.kind];
				return `La route touche ${noun} ${box.id}.`;
			}
		}
	}
	return undefined;
}

function contains(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

function overlapBoxes(left: Rect, right: Rect): boolean {
	return (
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y
	);
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

function scoreFor(alternative: PassageAlternative, geometry: CandidateGeometry): CandidateScore {
	let length = 0;
	let bends = 0;
	let previousAxis: 'horizontal' | 'vertical' | undefined;
	for (let index = 1; index < geometry.path.length; index += 1) {
		const before = defined(geometry.path[index - 1]);
		const after = defined(geometry.path[index]);
		const dx = after.x - before.x;
		const dy = after.y - before.y;
		if (dx === 0 && dy === 0) continue;
		length += Math.abs(dx) + Math.abs(dy);
		let axis: 'horizontal' | 'vertical' = 'vertical';
		if (dy === 0) axis = 'horizontal';
		if (previousAxis !== undefined && previousAxis !== axis) bends += 1;
		previousAxis = axis;
	}
	let edits = 0;
	if (alternative.kind === 'insert-rank') edits = 1;
	if (alternative.kind === 'exterior') edits = 2;
	return [edits, bends, length, geometry.extent];
}

function compareCandidates(left: CandidateTrace, right: CandidateTrace): number {
	const a = defined(left.score);
	const b = defined(right.score);
	for (let index = 0; index < a.length; index += 1) {
		const difference = defined(a[index]) - defined(b[index]);
		if (difference !== 0) return difference;
	}
	return compareCanonicalStrings(left.id, right.id);
}

function interpretLayoutContract(
	graph: PassageLayoutGraph,
	layering: LayeringIR,
	contract: LayoutContract,
	settings: SliceSettings,
): SymbolicLaneSolution {
	validateSettings(settings);
	const normalizedGraph: PassageLayoutGraph = {
		...graph,
		elements: [...graph.elements].sort((a, b) => compareCanonicalStrings(a.id, b.id)),
	};
	const candidates = contract.alternatives.map((alternative, index): CandidateTrace => {
		if (index >= settings.budget)
			return {
				id: alternative.id,
				kind: alternative.kind,
				status: 'not-explored',
				reason: 'Budget de branches atteint.',
				demands: alternative.demands,
			};
		const geometry = materialize(normalizedGraph, layering, alternative, settings);
		const reason = rejectionReason(alternative, geometry, normalizedGraph, settings);
		if (reason !== undefined)
			return {
				id: alternative.id,
				kind: alternative.kind,
				status: 'rejected',
				reason,
				demands: alternative.demands,
				geometry,
			};
		return {
			id: alternative.id,
			kind: alternative.kind,
			status: 'feasible',
			demands: alternative.demands,
			geometry,
			score: scoreFor(alternative, geometry),
		};
	});
	const selected = candidates
		.filter(({ status }) => status === 'feasible')
		.sort(compareCandidates)[0];
	if (selected !== undefined)
		candidates[candidates.indexOf(selected)] = { ...selected, status: 'selected' };
	const truncated = contract.alternatives.length > settings.budget;
	let outcome: SymbolicLaneSolution['outcome'] = 'infeasible';
	if (selected !== undefined) outcome = 'selected';
	if (truncated) outcome = 'budget-exhausted';
	return {
		graph: normalizedGraph,
		layering,
		contract,
		candidates,
		selectedId: selected?.id,
		outcome,
		explored: Math.min(contract.alternatives.length, settings.budget),
		budget: settings.budget,
		truncated,
	};
}

export function solveSymbolicLaneSlice(
	graph: PassageLayoutGraph,
	settings: SliceSettings,
): SymbolicLaneSolution {
	validateSettings(settings);
	const layering = buildLayeringIR(graph);
	const contract = buildLayoutContract(graph, layering, settings);
	return interpretLayoutContract(graph, layering, contract, settings);
}
