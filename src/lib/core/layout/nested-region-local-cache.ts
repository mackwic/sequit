import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LayoutPolicy, type LogicDocument } from '../document/logic-document';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { LayoutMeasurements, LayoutResult } from './layout-types';
import type { SharedLaneOutgoingIncident } from './shared-lane-incident-contract';

/** Projection-owned cache; every entry stores one bounded local child layout. */
export const MAX_NESTED_REGION_LOCAL_CACHE_ENTRIES = 12;

/** Bump this when the local child solver's geometry contract changes. */
const LOCAL_LAYOUT_ALGORITHM = 'shared-or-dedicated-child-layout-v3';
/** Materialized incidents enter the local graph and this key when a ghost policy is selected. */
const INCIDENT_CONTRACT = 'materialized-local-incidents-v2';

export interface NestedRegionLocalLayout {
	readonly layout: LayoutResult;
	readonly ranks: TopologicalRanks;
}

export interface NestedRegionLocalCacheStats {
	readonly entries: number;
	readonly hits: number;
	readonly misses: number;
	readonly evictions: number;
}

interface IncidentCacheInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly policy: LayoutPolicy | undefined;
	readonly incident: SharedLaneOutgoingIncident;
	readonly compute: () => NestedRegionLocalLayout;
}

function canonicalById<T extends { readonly id: string }>(items: readonly T[]): T[] {
	return [...items].sort((left, right) => compareCanonicalStrings(left.id, right.id));
}

/** Geometry inputs only. Content and foreign relations cannot change a child's local solve. */
export function nestedRegionLocalLayoutKey(
	document: LogicDocument,
	measurements: LayoutMeasurements,
	policy?: LayoutPolicy,
	incident?: SharedLaneOutgoingIncident,
): string {
	const nodes = canonicalById(document.nodes);
	const groups = canonicalById(document.groups);
	const junctions = canonicalById(document.junctions);
	let presentation: unknown = null;
	if (document.presentation !== undefined)
		presentation = [
			document.presentation.laneOrientation,
			document.presentation.growth,
			canonicalById(document.presentation.lanes).map(({ id, layoutOrder }) => [id, layoutOrder]),
		];
	return JSON.stringify({
		algorithm: LOCAL_LAYOUT_ALGORITHM,
		incident: INCIDENT_CONTRACT,
		outgoingLaneIncident: incident ?? null,
		source: {
			documentId: document.id,
			policy: policy ?? null,
			layout: [document.layout.direction, document.layout.bias],
			presentation,
			nodes: nodes.map(({ id, kind, layoutOrder, groupId, laneId, regionId }) => [
				id,
				kind,
				layoutOrder,
				groupId ?? null,
				laneId ?? null,
				regionId ?? null,
			]),
			groups: groups.map(({ id, state, layoutOrder, groupId, laneId, regionId }) => {
				const parent = groupId ?? null;
				const lane = laneId ?? null;
				const region = regionId ?? null;
				return [id, state ?? null, layoutOrder, parent, lane, region];
			}),
			junctions: junctions.map(({ id, operator, layoutOrder, groupId, laneId, regionId }) => [
				id,
				operator,
				layoutOrder,
				groupId ?? null,
				laneId ?? null,
				regionId ?? null,
			]),
			relations: canonicalById(document.relations).map(({ id, from, to }) => [id, from, to]),
		},
		measurement: {
			nodes: nodes.map(({ id }) => {
				const size = measurements.nodes.get(id);
				if (size === undefined) return [id, null];
				return [id, [size.width, size.height]];
			}),
			groups: groups.map(({ id }) => {
				const size = measurements.groups.get(id);
				if (size === undefined) return [id, null];
				return [id, [size.minimumWidth, size.minimumHeight, size.headerHeight, size.padding]];
			}),
			junctions: junctions.map(({ id }) => {
				const size = measurements.junctions.get(id);
				if (size === undefined) return [id, null];
				return [id, [size.width, size.height]];
			}),
		},
	});
}

function copyLocalLayout(value: NestedRegionLocalLayout): NestedRegionLocalLayout {
	let lanes: { readonly lanes?: NonNullable<LayoutResult['lanes']> } = {};
	if (value.layout.lanes !== undefined)
		lanes = {
			lanes: value.layout.lanes.map((lane) => ({
				...lane,
				bounds: { ...lane.bounds },
			})),
		};
	return {
		layout: {
			...value.layout,
			...lanes,
			elements: value.layout.elements.map((element) => ({
				...element,
				bounds: { ...element.bounds },
			})),
			relations: value.layout.relations.map((relation) => ({
				...relation,
				points: relation.points.map((point) => ({ ...point })),
			})),
		},
		ranks: {
			byEndpointId: new Map(value.ranks.byEndpointId),
			bands: value.ranks.bands.map((band) => [...band]),
		},
	};
}

/** Instance ownership belongs to one open projection; no core-global mutable state. */
export class NestedRegionLocalLayoutCache {
	readonly #entries = new Map<string, NestedRegionLocalLayout>();
	#hits = 0;
	#misses = 0;
	#evictions = 0;

	get stats(): NestedRegionLocalCacheStats {
		return {
			entries: this.#entries.size,
			hits: this.#hits,
			misses: this.#misses,
			evictions: this.#evictions,
		};
	}

	getOrCompute(
		document: LogicDocument,
		measurements: LayoutMeasurements,
		policy: LayoutPolicy | undefined,
		compute: () => NestedRegionLocalLayout,
	): NestedRegionLocalLayout {
		const key = nestedRegionLocalLayoutKey(document, measurements, policy);
		return this.#getOrComputeKey(key, compute);
	}

	getOrComputeIncident(input: IncidentCacheInput): NestedRegionLocalLayout {
		const { document, measurements, policy, incident, compute } = input;
		const key = nestedRegionLocalLayoutKey(document, measurements, policy, incident);
		return this.#getOrComputeKey(key, compute);
	}

	#getOrComputeKey(key: string, compute: () => NestedRegionLocalLayout): NestedRegionLocalLayout {
		const hit = this.#entries.get(key);
		if (hit !== undefined) {
			this.#hits += 1;
			this.#entries.delete(key);
			this.#entries.set(key, hit);
			return copyLocalLayout(hit);
		}
		this.#misses += 1;
		const calculated = compute();
		this.#entries.set(key, copyLocalLayout(calculated));
		if (this.#entries.size > MAX_NESTED_REGION_LOCAL_CACHE_ENTRIES) {
			const oldest = this.#entries.keys().next().value;
			this.#entries.delete(defined(oldest));
			this.#evictions += 1;
		}
		return calculated;
	}
}
