import { defined, EndpointKind } from '../document/logic-document';
import type { RankDomain, RankOrder } from './rank-order';
import { validateRankOrder } from './rank-order';
import type { LayoutStructure } from './structure/prepare-layout';

export interface RankOrderDomain extends RankDomain {
	readonly locations: readonly {
		readonly componentIndex: number;
		readonly rank: number;
	}[];
}

/** Collect only ordinary node rows with a real choice; groups and singleton/empty rows stay fixed. */
export function collectRankOrderDomain(structure: LayoutStructure): RankOrderDomain {
	const bands: string[][] = [];
	const locations: { componentIndex: number; rank: number }[] = [];
	for (const [componentIndex, component] of structure.components.entries()) {
		for (const [rank, row] of component.rows.ordinary.entries()) {
			const nodeIds = row.filter(
				(id) => structure.graph.endpointsById.get(id)?.entity.kind === EndpointKind.Node,
			);
			if (nodeIds.length < 2) continue;
			bands.push(nodeIds);
			locations.push({ componentIndex, rank });
		}
	}
	return { bands, locations };
}

/** Apply a validated node-only permutation while retaining every pinned row position. */
export function applyRankOrder(
	structure: LayoutStructure,
	domain: RankOrderDomain,
	order: RankOrder,
): LayoutStructure {
	if (!validateRankOrder(domain, order)) throw new Error('Invalid ordinary-node rank order');
	const changedRows = new Map<number, Map<number, readonly string[]>>();
	for (const [bandIndex, location] of domain.locations.entries()) {
		const component = defined(structure.components[location.componentIndex]);
		const row = defined(component.rows.ordinary[location.rank]);
		const candidateBand = defined(order[bandIndex]);
		let nodeIndex = 0;
		let differs = false;
		for (const id of row) {
			if (structure.graph.endpointsById.get(id)?.entity.kind !== EndpointKind.Node) continue;
			if (id !== candidateBand[nodeIndex]) differs = true;
			nodeIndex += 1;
		}
		if (!differs) continue;
		let candidateIndex = 0;
		const reorderedRow = row.map((id) => {
			if (structure.graph.endpointsById.get(id)?.entity.kind !== EndpointKind.Node) return id;
			const candidateId = defined(candidateBand[candidateIndex]);
			candidateIndex += 1;
			return candidateId;
		});
		let componentRows = changedRows.get(location.componentIndex);
		if (componentRows === undefined) {
			componentRows = new Map<number, readonly string[]>();
			changedRows.set(location.componentIndex, componentRows);
		}
		componentRows.set(location.rank, reorderedRow);
	}
	if (changedRows.size === 0) return structure;
	const components = structure.components.map((component, componentIndex) => {
		const changedComponentRows = changedRows.get(componentIndex);
		if (changedComponentRows === undefined) return component;
		const ordinary = [...component.rows.ordinary];
		for (const [rank, row] of changedComponentRows) ordinary[rank] = row;
		return { ...component, rows: { ...component.rows, ordinary } };
	});
	return { ...structure, components };
}
