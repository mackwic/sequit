import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { pathsTouchWithoutBridge } from '../../../../src/lib/core/layout/nested-region-leaf-incident-contacts';
import {
	RegionCompositionStatus,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/region-composition-types';
import {
	RegionIncidentRejectionCode,
	RegionIncidentRole,
	RegionIncidentUnknownCode,
} from '../../../../src/lib/core/layout/region-incident-contract';
import { solveDedicatedRegionLeafWithIncidents } from '../../../../src/lib/core/layout/region-leaf-incident-solver';
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
	it('distinguishes exhaustive rejection from a truncated search', () => {
		const exhausted = solveChain(4, 'none');
		expect(exhausted).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.NoValidAlternative,
			witness: { exhaustive: true },
		});
		expect(exhausted.witness.attempted).toBeGreaterThan(0);
		expect(
			exhausted.witness.rejectedAlternatives.some(
				({ code }) => code === RegionIncidentRejectionCode.RouteObstructed,
			),
		).toBe(true);
		const truncated = solveChain(5, 'all-bottom');
		expect(truncated).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.SearchBudgetExceeded,
			witness: { exhaustive: false },
		});
		expect(truncated.witness.attempted).toBeGreaterThan(exhausted.witness.attempted);
	});

	it('chooses a valid alternate side after rejecting the preferred side', () => {
		const selected = solveChain(4, 'second-right');
		if (selected.status !== RegionCompositionStatus.Selected) throw new Error(selected.reason);
		expect(
			defined(selected.incidents.find(({ relationId }) => relationId === 'cross-1')).side,
		).toBe(RegionPortalSide.Right);
		for (const [index, incident] of selected.incidents.entries())
			for (const other of selected.incidents.slice(index + 1))
				expect(pathsTouchWithoutBridge(incident.points, other.points)).toBe(false);
	});

	it('continues with another side combination after one combination reaches its cap', () => {
		const selected = solveChain(4, 'all-bottom');
		if (selected.status !== RegionCompositionStatus.Selected) throw new Error(selected.reason);
		expect(selected.witness.attempted).toBeGreaterThan(1_024);
		expect(selected.incidents.some(({ side }) => side === RegionPortalSide.Bottom)).toBe(true);
		for (const [index, incident] of selected.incidents.entries())
			for (const other of selected.incidents.slice(index + 1))
				expect(pathsTouchWithoutBridge(incident.points, other.points)).toBe(false);
	});
});
