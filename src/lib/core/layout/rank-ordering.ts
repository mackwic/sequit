import { defined, EndpointKind } from '../document/logic-document';
import type { RankDomain, RankOrder } from './rank-order';
import { validateRankOrder } from './rank-order';
import type { RankedComponent } from './structure/placement-rows';
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
	if (
		domain.bands.every((band, index) =>
			band.every((id, position) => order[index]?.[position] === id),
		)
	)
		return structure;
	const changed = new Map<number, RankedComponent>();
	for (const [bandIndex, location] of domain.locations.entries()) {
		let component = changed.get(location.componentIndex);
		component ??= defined(structure.components[location.componentIndex]);
		const ordinaryRows = [...component.rows.ordinary];
		const originalRow = defined(ordinaryRows[location.rank]);
		const candidateBand = defined(order[bandIndex]);
		let candidateIndex = 0;
		const reorderedRow = originalRow.map((id) => {
			if (structure.graph.endpointsById.get(id)?.entity.kind !== EndpointKind.Node) return id;
			const candidateId = defined(candidateBand[candidateIndex]);
			candidateIndex += 1;
			return candidateId;
		});
		ordinaryRows[location.rank] = reorderedRow;
		changed.set(location.componentIndex, {
			...component,
			rows: { ...component.rows, ordinary: ordinaryRows },
		});
	}
	if (changed.size === 0) return structure;
	const components = structure.components.map(
		(component, index) => changed.get(index) ?? component,
	);
	return { ...structure, components };
}
