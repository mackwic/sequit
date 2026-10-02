import { defined } from '../../document/logic-document';
import { BASE_RANK_GAP, RAIL_SPACING } from '../layout-settings';
import type { SharedLaneEndpoint, SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import { incidenceKey, PortRole } from './shared-lane-ports';
import type { LogicalBox } from './shared-lane-types';

/** A same-lane plan between two rows: it joins their facing faces across the rank axis. */
function facingLocalPlan(plan: SharedLanePlan): boolean {
	return plan.sameLane && plan.sourceSide !== plan.targetSide;
}

/**
 * A plan a direct order routes differently from the gutter orders: between two adjacent lanes, or
 * between two rows of one lane.
 */
export function directPlan(plan: SharedLanePlan): boolean {
	return Math.abs(plan.sourceLaneIndex - plan.targetLaneIndex) === 1 || facingLocalPlan(plan);
}

/**
 * The same lanes with every local plan on a historical U arc: it leaves and enters by the earlier
 * face of its endpoints. Returns the input itself when no plan joins facing faces.
 */
export function withLocalArcs(input: SharedLaneInput): SharedLaneInput {
	if (!input.plans.some(facingLocalPlan)) return input;
	const plans = input.plans.map((plan) => {
		if (!facingLocalPlan(plan)) return plan;
		return { ...plan, sourceSide: -1 as const, targetSide: -1 as const };
	});
	return { ...input, plans };
}

/** The endpoint of a facing local plan on the earlier row: the one leaving by its end face. */
function earlierEndpoint(input: SharedLaneInput, plan: SharedLanePlan): SharedLaneEndpoint {
	let id = plan.to;
	if (plan.sourceSide === 1) id = plan.from;
	return defined(input.endpoints.get(id));
}

function rowKey(laneIndex: number, row: number): string {
	return JSON.stringify([laneIndex, row]);
}

/** The row gap after one row: wide enough to give each facing local leg its own rail track. */
function rowGap(legs: number): number {
	return Math.max(BASE_RANK_GAP, (legs + 1) * RAIL_SPACING);
}

/** The gap a transverse lane leaves after each of its rows for the facing local legs crossing it. */
export function localRowGaps(input: SharedLaneInput): (laneIndex: number, row: number) => number {
	const counts = new Map<string, number>();
	for (const plan of input.plans) {
		if (!facingLocalPlan(plan)) continue;
		const earlier = earlierEndpoint(input, plan);
		const key = rowKey(earlier.laneIndex, earlier.row);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return (laneIndex, row) => rowGap(counts.get(rowKey(laneIndex, row)) ?? 0);
}

/** The cross position of one port: the face centre plus the offset its face granted it. */
export function transversePortCross(
	box: LogicalBox,
	offsets: ReadonlyMap<string, number>,
	relationId: string,
	role: PortRole,
): number {
	return box.cross + box.crossSize / 2 + defined(offsets.get(incidenceKey(relationId, role)));
}

interface LocalLegRow {
	readonly laneIndex: number;
	readonly row: number;
	readonly legs: { readonly planId: string; readonly port: number }[];
}

/** Where the legs of one frame are placed: its boxes, port offsets and the start of each row gap. */
export interface LocalLegPlacement {
	readonly boxes: ReadonlyMap<string, LogicalBox>;
	readonly offsets: ReadonlyMap<string, number>;
	readonly gapStart: (laneIndex: number, row: number) => number;
}

/**
 * Every facing local leg crosses the row gap after its earlier endpoint on its own track. The rows
 * of one lane take increasing cross columns, so every later port lies beyond every earlier port:
 * the leg whose earlier port is further along the cross axis runs nearer that row, and two legs
 * whose ports keep the same order on both rows never cross.
 */
export function localLegLevels(
	input: SharedLaneInput,
	placement: LocalLegPlacement,
): ReadonlyMap<string, number> {
	const byRow = new Map<string, LocalLegRow>();
	for (const plan of input.plans) {
		if (!facingLocalPlan(plan)) continue;
		const earlier = earlierEndpoint(input, plan);
		let role = PortRole.Target;
		if (plan.sourceSide === 1) role = PortRole.Source;
		const box = defined(placement.boxes.get(earlier.id));
		const port = transversePortCross(box, placement.offsets, plan.id, role);
		const key = rowKey(earlier.laneIndex, earlier.row);
		const entry = byRow.get(key) ?? { laneIndex: earlier.laneIndex, row: earlier.row, legs: [] };
		entry.legs.push({ planId: plan.id, port });
		byRow.set(key, entry);
	}
	const levels = new Map<string, number>();
	for (const { laneIndex, row, legs } of byRow.values()) {
		const gapStart = placement.gapStart(laneIndex, row);
		const spacing = rowGap(legs.length) / (legs.length + 1);
		legs.sort((left, right) => left.port - right.port);
		for (const [index, { planId }] of legs.entries())
			levels.set(planId, gapStart + (legs.length - index) * spacing);
	}
	return levels;
}
