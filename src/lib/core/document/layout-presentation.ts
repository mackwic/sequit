import { compareCanonicalStrings } from '../canonical-string';
import {
	LaneGrowth,
	LaneOrientation,
	type LayoutLane,
	LayoutPolicy,
	type LogicDocument,
} from './logic-document';

export enum NormalizedLaneKind {
	Implicit = 'implicit',
	Explicit = 'explicit',
}

interface ImplicitLayoutLane {
	readonly kind: NormalizedLaneKind.Implicit;
}

interface ExplicitLayoutLane extends LayoutLane {
	readonly kind: NormalizedLaneKind.Explicit;
}

type NormalizedLayoutLane = ImplicitLayoutLane | ExplicitLayoutLane;

type LaneEndpoint =
	| LogicDocument['groups'][number]
	| LogicDocument['nodes'][number]
	| LogicDocument['junctions'][number];

export interface NormalizedRootLayout {
	readonly policy: LayoutPolicy;
	readonly laneOrientation: LaneOrientation;
	readonly growth: LaneGrowth.Auto;
	readonly lanes: readonly NormalizedLayoutLane[];
	/** An undefined value denotes the sole implicit lane. */
	readonly laneByEndpointId: ReadonlyMap<string, string | undefined>;
}

function resolveEndpointLane(
	id: string,
	byId: ReadonlyMap<string, LaneEndpoint>,
	laneByEndpointId: Map<string, string | undefined>,
): void {
	const path: string[] = [];
	const visiting = new Set<string>();
	let current: string | undefined = id;
	while (current !== undefined && !laneByEndpointId.has(current)) {
		if (visiting.has(current)) throw new Error(`Group containment cycle at ${current}`);
		visiting.add(current);
		path.push(current);
		current = byId.get(current)?.groupId;
	}
	let laneId: string | undefined;
	if (current !== undefined) laneId = laneByEndpointId.get(current);
	for (const pathId of path.reverse()) {
		const item = byId.get(pathId);
		if (item?.groupId === undefined) laneId = item?.laneId;
		laneByEndpointId.set(pathId, laneId);
	}
}

/** A legacy document derives one root and one lane without writing either to the document. */
export function normalizeRootLayout(document: LogicDocument): NormalizedRootLayout {
	const endpoints = [...document.groups, ...document.nodes, ...document.junctions];
	const byId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
	const laneByEndpointId = new Map<string, string | undefined>();
	for (const endpoint of endpoints) {
		if (!laneByEndpointId.has(endpoint.id))
			resolveEndpointLane(endpoint.id, byId, laneByEndpointId);
	}
	const presentation = document.presentation;
	if (presentation === undefined)
		return {
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [{ kind: NormalizedLaneKind.Implicit }],
			laneByEndpointId,
		};
	return {
		policy: presentation.policy,
		laneOrientation: presentation.laneOrientation,
		growth: presentation.growth,
		lanes: [...presentation.lanes]
			.sort(
				(left, right) =>
					compareCanonicalStrings(left.layoutOrder, right.layoutOrder) ||
					compareCanonicalStrings(left.id, right.id),
			)
			.map((lane) => ({ ...lane, kind: NormalizedLaneKind.Explicit })),
		laneByEndpointId,
	};
}
