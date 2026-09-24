import type { ComposedInput } from './composed-slice';
import type { LaneOrientation, PassageLayoutGraph, SliceSettings } from './symbolic-lane-slice';

/** Three arrivals share one target face. The separation is a fixture constraint, not an ID heuristic. */
export function composedFixture(
	kind: 'free' | 'blocking',
	orientation: LaneOrientation = 'vertical',
	options: {
		readonly laneIds?: readonly [string, string, string];
		readonly direction?: 'forward' | 'reverse';
	} = {},
): ComposedInput {
	const [firstLaneId, middleLaneId, lastLaneId] = options.laneIds ?? ['S', 'SD', 'C'];
	const reverse = options.direction === 'reverse';
	let sourceLaneId = firstLaneId;
	let targetLaneId = lastLaneId;
	if (reverse) {
		sourceLaneId = lastLaneId;
		targetLaneId = firstLaneId;
	}
	const laneLabels = options.laneIds ?? ['Sales', 'Service delivery', 'Customer'];
	let variantId = '';
	if (options.laneIds !== undefined || options.direction !== undefined)
		variantId = `-${firstLaneId}-${middleLaneId}-${lastLaneId}-${options.direction ?? 'forward'}`;
	let directionOption: Pick<ComposedInput, 'direction'> = {};
	if (options.direction !== undefined) directionOption = { direction: options.direction };
	let groupLabel = 'SD hors passage';
	let groupSpan = { first: 2, last: 2 };
	let groupLongitudinalSize = 48;
	if (kind === 'blocking') {
		groupLabel = 'Groupe SD bloquant';
		groupSpan = { first: 0, last: 2 };
		groupLongitudinalSize = 240;
	}
	const elements: PassageLayoutGraph['elements'] = [
		...['a', 'b', 'c'].map((id, rank) => ({
			id,
			label: `Source ${id.toUpperCase()}`,
			kind: 'node' as const,
			laneId: sourceLaneId,
			preferredSpan: { first: rank, last: rank },
			intrinsicSize: { cross: 96, longitudinal: 36 },
		})),
		{
			id: 'target',
			label: 'Cible à trois entrées',
			kind: 'node',
			laneId: targetLaneId,
			preferredSpan: { first: 1, last: 1 },
			intrinsicSize: { cross: 112, longitudinal: 80 },
		},
		{
			id: 'sd-work',
			label: groupLabel,
			kind: 'group',
			laneId: middleLaneId,
			preferredSpan: groupSpan,
			intrinsicSize: { cross: 136, longitudinal: groupLongitudinalSize },
		},
	];
	const relations = ['a', 'b', 'c'].map((from) => ({
		id: `${from}-target`,
		from,
		to: 'target',
	}));
	return {
		graph: {
			id: `composed-${kind}-${orientation}${variantId}`,
			title: `Trois arrivées par ${firstLaneId} | ${middleLaneId} | ${lastLaneId}`,
			orientation,
			lanes: [
				{ id: firstLaneId, label: laneLabels[0], minimumCrossSize: 144 },
				{ id: middleLaneId, label: laneLabels[1], minimumCrossSize: 160 },
				{ id: lastLaneId, label: laneLabels[2], minimumCrossSize: 144 },
			],
			elements,
			relation: { id: 'a-target', from: 'a', to: 'target' },
		},
		relations,
		targetId: 'target',
		...directionOption,
		faceInset: 24,
		portSpacing: 48,
		crossingPolicy: 'crossing-free',
		/** The three independent arrivals are deliberately required to remain distinct. */
		requiredSeparations: [
			{ firstRelationId: 'a-target', secondRelationId: 'b-target' },
			{ firstRelationId: 'a-target', secondRelationId: 'c-target' },
			{ firstRelationId: 'b-target', secondRelationId: 'c-target' },
		],
	};
}

export function composedSettings(overrides: Partial<SliceSettings> = {}): SliceSettings {
	return {
		laneGap: 40,
		rankGap: 32,
		clearance: 12,
		railSpacing: 24,
		budget: 128,
		...overrides,
	};
}
