import type { LaneOrientation, PassageLayoutGraph, SliceSettings } from './symbolic-lane-slice';

export function symbolicSettings(overrides: Partial<SliceSettings> = {}): SliceSettings {
	return {
		laneGap: 40,
		rankGap: 32,
		clearance: 12,
		railSpacing: 24,
		budget: 16,
		...overrides,
	};
}

function baseGraph(orientation: LaneOrientation): PassageLayoutGraph {
	return {
		id: `symbolic-base-${orientation}`,
		title: 'Passage entre lanes extrêmes',
		orientation,
		lanes: [
			{ id: 'S', label: 'Sales', minimumCrossSize: 160 },
			{ id: 'SD', label: 'Service delivery', minimumCrossSize: 160 },
			{ id: 'C', label: 'Customer', minimumCrossSize: 160 },
		],
		elements: [
			{
				id: 'request',
				label: 'Demande',
				kind: 'node',
				laneId: 'S',
				preferredSpan: { first: 1, last: 1 },
				intrinsicSize: { cross: 112, longitudinal: 36 },
			},
			{
				id: 'reply',
				label: 'Réponse',
				kind: 'node',
				laneId: 'C',
				preferredSpan: { first: 1, last: 1 },
				intrinsicSize: { cross: 112, longitudinal: 36 },
			},
		],
		relation: { id: 'request-reply', from: 'request', to: 'reply' },
	};
}

export function symbolicFreeGapFixture(
	orientation: LaneOrientation = 'vertical',
): PassageLayoutGraph {
	const base = baseGraph(orientation);
	return {
		...base,
		id: `symbolic-free-gap-${orientation}`,
		title: 'Passage libre dans SD, sans coordonnées',
		elements: [
			...base.elements,
			{
				id: 'sd-work',
				label: 'Travail SD',
				kind: 'group',
				laneId: 'SD',
				preferredSpan: { first: 0, last: 0 },
				intrinsicSize: { cross: 136, longitudinal: 64 },
			},
		],
	};
}

export function symbolicBlockingGroupFixture(
	orientation: LaneOrientation = 'vertical',
): PassageLayoutGraph {
	const base = baseGraph(orientation);
	return {
		...base,
		id: `symbolic-blocking-group-${orientation}`,
		title: 'Groupe SD indivisible couvrant les rangs',
		elements: [
			...base.elements,
			{
				id: 'sd-work',
				label: 'Groupe SD',
				kind: 'group',
				laneId: 'SD',
				preferredSpan: { first: 0, last: 2 },
				intrinsicSize: { cross: 160, longitudinal: 240 },
			},
		],
	};
}
