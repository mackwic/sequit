import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LayoutPolicy, type LogicDocument } from '../document/logic-document';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { LayoutMeasurements, LayoutResult } from './layout-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	type RegionIncidentSearchWitness,
	type RegionSolvedIncident,
} from './region-incident-contract';

/** Projection-owned cache; every entry stores one bounded local child layout. */
export const MAX_REGION_LOCAL_CACHE_ENTRIES = 12;

/** Bump this when the local child solver's geometry contract changes. */
const LOCAL_LAYOUT_ALGORITHM = 'shared-or-dedicated-child-layout-v5';
const INCIDENT_CONTRACT = 'region-incident-contract-v1';

export interface RegionLocalLayout {
	readonly layout: LayoutResult;
	readonly ranks: TopologicalRanks;
	readonly incidents?: readonly RegionSolvedIncident[];
	readonly witness?: RegionIncidentSearchWitness;
}

export interface RegionLocalCacheStats {
	readonly entries: number;
	readonly hits: number;
	readonly misses: number;
	readonly evictions: number;
}

interface RegionContractCacheInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly policy?: LayoutPolicy | undefined;
	readonly contracts: readonly RegionIncidentContract[];
	readonly compute: () => RegionLocalLayout;
}

function canonicalById<T extends { readonly id: string }>(items: readonly T[]): T[] {
	return [...items].sort((left, right) => compareCanonicalStrings(left.id, right.id));
}

/** Geometry inputs only. Content and foreign relations cannot change a child's local solve. */
export function regionLocalLayoutKey(
	document: LogicDocument,
	measurements: LayoutMeasurements,
	policy?: LayoutPolicy,
	inputContracts: readonly RegionIncidentContract[] = [],
): string {
	const contracts = normalizeRegionIncidentContracts(inputContracts);
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
		incidentContract: INCIDENT_CONTRACT,
		incidentContracts: contracts.map(({ relation, endpointId, role, allowedSides }) => [
			[relation.id, relation.from, relation.to],
			endpointId,
			role,
			allowedSides,
		]),
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

function copyLocalLayout(value: RegionLocalLayout): RegionLocalLayout {
	let witness: { readonly witness?: RegionIncidentSearchWitness } = {};
	if (value.witness !== undefined)
		witness = {
			witness: {
				...value.witness,
				rejectedAlternatives: value.witness.rejectedAlternatives.map((rejected) => ({
					...rejected,
				})),
			},
		};
	let incidents: { readonly incidents?: readonly RegionSolvedIncident[] } = {};
	if (value.incidents !== undefined)
		incidents = {
			incidents: value.incidents.map((incident) => ({
				...incident,
				anchor: { ...incident.anchor },
				portal: { ...incident.portal },
				points: incident.points.map((point) => ({ ...point })),
			})),
		};
	let lanes: { readonly lanes?: NonNullable<LayoutResult['lanes']> } = {};
	if (value.layout.lanes !== undefined)
		lanes = {
			lanes: value.layout.lanes.map((lane) => ({
				...lane,
				bounds: { ...lane.bounds },
			})),
		};
	return {
		...witness,
		...incidents,
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
export class RegionLocalLayoutCache {
	readonly #entries = new Map<string, RegionLocalLayout>();
	#hits = 0;
	#misses = 0;
	#evictions = 0;

	get stats(): RegionLocalCacheStats {
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
		compute: () => RegionLocalLayout,
	): RegionLocalLayout {
		const key = regionLocalLayoutKey(document, measurements, policy);
		return this.#getOrComputeKey(key, compute);
	}

	getOrComputeContract(input: RegionContractCacheInput): RegionLocalLayout {
		const { document, measurements, policy, contracts, compute } = input;
		const key = regionLocalLayoutKey(document, measurements, policy, contracts);
		return this.#getOrComputeKey(key, compute);
	}

	#getOrComputeKey(key: string, compute: () => RegionLocalLayout): RegionLocalLayout {
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
		if (this.#entries.size > MAX_REGION_LOCAL_CACHE_ENTRIES) {
			const oldest = this.#entries.keys().next().value;
			this.#entries.delete(defined(oldest));
			this.#evictions += 1;
		}
		return calculated;
	}
}
