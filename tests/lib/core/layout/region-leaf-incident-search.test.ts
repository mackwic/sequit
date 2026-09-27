import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { disallowedRouteContacts } from '../../../../src/lib/core/layout/bridges/bridge-contact';
import { solveDedicatedRegionLeafWithIncidents } from '../../../../src/lib/core/layout/regions/leaf/region-leaf-incident-solver';
import {
	RegionCompositionStatus,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	RegionIncidentRole,
	RegionIncidentUnknownCode,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { regionDocument } from './nested-region-fixture';

function solveChain(count: number, alternatives: 'none' | 'second-right' | 'all-bottom') {
	const source = regionDocument();
	const template = defined(source.nodes.find(({ id }) => id === 'b'));
	const ids = Array.from({ length: count }, (_, index) => `n${index}`);
	const document = {
		...source,
		nodes: ids.map((id, index) => ({ ...template, id, layoutOrder: orderKey(`a${index}`) })),
		relations: ids
			.slice(1)
			.map((id, index) => ({ id: `local-${index}`, from: `n${index}`, to: id })),
	};
	const measurements = prepareLayoutDocument(document).measurements;
	const contracts = ids.map((id, index) => {
		let allowedSides = [RegionPortalSide.Top];
		if (alternatives === 'second-right' && index === 1)
			allowedSides = [RegionPortalSide.Top, RegionPortalSide.Right];
		if (alternatives === 'all-bottom' && index > 0)
			allowedSides = [RegionPortalSide.Top, RegionPortalSide.Bottom];
		return {
			relation: { id: `cross-${index}`, from: id, to: 'outside' },
			endpointId: id,
			role: RegionIncidentRole.Source,
			allowedSides,
		};
	});
	return solveDedicatedRegionLeafWithIncidents({ document, measurements, contracts });
}

describe('joint dedicated incident search', () => {
	it('keeps the selected candidate when validated bridges make a route feasible before the budget', () => {
		const selected = solveChain(3, 'none');
		expect(selected.status).toBe(RegionCompositionStatus.Selected);
		if (selected.status !== RegionCompositionStatus.Selected) return;
		expect(selected.witness.attempted).toBeGreaterThan(0);
		const truncated = solveChain(5, 'all-bottom');
		expect(truncated).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.SearchBudgetExceeded,
			witness: { attempted: 8_192, exhaustive: false },
		});
		if (truncated.status !== RegionCompositionStatus.Unknown) return;
		expect(truncated.reason).toContain('global search exhausted its 8192');
		expect(truncated.witness.attempted).toBeGreaterThan(selected.witness.attempted);
	});

	it('reports the per-side cap on a genuinely searched but unresolved chain', () => {
		const unresolved = solveChain(5, 'none');
		expect(unresolved).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.SearchBudgetExceeded,
			witness: { attempted: 1_024, exhaustive: false },
		});
		if (unresolved.status !== RegionCompositionStatus.Unknown) return;
		expect(unresolved.reason).toContain('side-assignment search exhausted its 1024');
		expect('incidents' in unresolved).toBe(false);
	});

	it('chooses a valid alternate side after rejecting the preferred side', () => {
		const selected = solveChain(4, 'second-right');
		if (selected.status !== RegionCompositionStatus.Selected) throw new Error(selected.reason);
		expect(
			defined(selected.incidents.find(({ relationId }) => relationId === 'cross-1')).side,
		).toBe(RegionPortalSide.Right);
		for (const [index, incident] of selected.incidents.entries())
			for (const other of selected.incidents.slice(index + 1))
				expect(
					disallowedRouteContacts(
						{ id: incident.relationId, points: incident.points },
						{ id: other.relationId, points: other.points },
						[],
					).length > 0,
				).toBe(false);
	});

	it('continues with another side combination after one combination reaches its cap', () => {
		const selected = solveChain(4, 'all-bottom');
		if (selected.status !== RegionCompositionStatus.Selected) throw new Error(selected.reason);
		expect(selected.witness.attempted).toBeGreaterThan(1_024);
		expect(selected.incidents.some(({ side }) => side === RegionPortalSide.Bottom)).toBe(true);
		for (const [index, incident] of selected.incidents.entries())
			for (const other of selected.incidents.slice(index + 1))
				expect(
					disallowedRouteContacts(
						{ id: incident.relationId, points: incident.points },
						{ id: other.relationId, points: other.points },
						[],
					).length > 0,
				).toBe(false);
	});
});
