import { describe, expect, it } from 'vitest';

import { rankOrderComparisonCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { disallowedRouteContacts } from '../../../../src/lib/core/layout/bridge-contact';
import { satisfyMetricDemands } from '../../../../src/lib/core/layout/contract/metric-demand';
import { evaluateDedicatedLayout } from '../../../../src/lib/core/layout/layout-engine';
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
import { incidentMetricDemands } from '../../../../src/lib/core/layout/region-incident-metric-demand';
import { solveRegionLeafLayout } from '../../../../src/lib/core/layout/region-leaf-base-layout';
import { solveDedicatedRegionLeafWithIncidents } from '../../../../src/lib/core/layout/region-leaf-incident-solver';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/region-local-cache';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument, regionDocument } from './nested-region-fixture';

function oneNodeLeaf(): LogicDocument {
	const source = depthTwoRegionDocument();
	return {
		...source,
		nodes: source.nodes.filter(({ id }) => id === 'c'),
		relations: [],
	};
}

function incident(id: string, side: RegionPortalSide) {
	return {
		relation: { id, from: 'c', to: 'other' },
		endpointId: 'c',
		role: RegionIncidentRole.Source,
		allowedSides: [side],
	};
}

describe('dedicated leaf incident contracts', () => {
	it('preserves a zero-incident local layout through the same cache path', () => {
		const document = oneNodeLeaf();
		const measurements = prepareLayoutDocument(document).measurements;
		const expected = solveRegionLeafLayout({
			document,
			measurements,
			leafPolicy: LayoutPolicy.Layered,
		});
		const cache = new RegionLocalLayoutCache();
		const input = { document, measurements, contracts: [], cache };
		const cold = solveDedicatedRegionLeafWithIncidents(input);
		const hit = solveDedicatedRegionLeafWithIncidents(input);
		expect(cold).toEqual(hit);
		if (cold.status !== RegionCompositionStatus.Selected) throw new Error(cold.reason);
		expect(cold.layout).toEqual(expected.layout);
		expect(cold.ranks).toEqual(expected.ranks);
		expect(cold.incidents).toEqual([]);
		expect(cache.stats).toMatchObject({ misses: 1, hits: 1, entries: 1 });
	});

	it.each(Object.values(RegionPortalSide))(
		'routes a real node incident to the %s frame side',
		(side) => {
			const document = oneNodeLeaf();
			const measurements = prepareLayoutDocument(document).measurements;
			const attempt = solveDedicatedRegionLeafWithIncidents({
				document,
				measurements,
				contracts: [incident('cross', side)],
			});
			if (attempt.status !== RegionCompositionStatus.Selected) throw new Error(attempt.reason);
			const path = defined(attempt.incidents[0]);
			const node = defined(attempt.layout.elements.find(({ id }) => id === 'c'));
			expect(path.side).toBe(side);
			expect(path.anchor).toEqual(path.points[0]);
			expect(path.portal).toEqual(path.points.at(-1));
			if (side === RegionPortalSide.Top) {
				expect(path.anchor.y).toBe(node.bounds.y);
				expect(path.portal.y).toBe(0);
			} else if (side === RegionPortalSide.Bottom) {
				expect(path.anchor.y).toBe(node.bounds.y + node.bounds.height);
				expect(path.portal.y).toBe(attempt.layout.height);
			} else if (side === RegionPortalSide.Left) {
				expect(path.anchor.x).toBe(node.bounds.x);
				expect(path.portal.x).toBe(0);
			} else {
				expect(path.anchor.x).toBe(node.bounds.x + node.bounds.width);
				expect(path.portal.x).toBe(attempt.layout.width);
			}
		},
	);

	it('routes a junction boundary incident clear of its internal causal route', () => {
		const base = oneNodeLeaf();
		const document: LogicDocument = {
			...base,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'join',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a7'),
				},
			],
			relations: [{ id: 'c-to-join', from: 'c', to: 'join' }],
		};
		const measurements = prepareLayoutDocument(document).measurements;
		const contracts = [
			{
				relation: { id: 'outside-join', from: 'join', to: 'outside' },
				endpointId: 'join',
				role: RegionIncidentRole.Source,
				allowedSides: [RegionPortalSide.Bottom],
			},
		];
		const cache = new RegionLocalLayoutCache();
		const input = { document, measurements, contracts, cache };
		const cold = solveDedicatedRegionLeafWithIncidents(input);
		const hit = solveDedicatedRegionLeafWithIncidents(input);
		expect(hit).toEqual(cold);
		if (cold.status !== RegionCompositionStatus.Selected) throw new Error(cold.reason);
		const portal = defined(cold.incidents[0]);
		const junction = defined(cold.layout.elements.find(({ id }) => id === 'join'));
		const internal = defined(cold.layout.relations.find(({ id }) => id === 'c-to-join'));
		expect(portal.side).toBe(RegionPortalSide.Bottom);
		expect(portal.anchor.y).toBe(junction.bounds.y + junction.bounds.height);
		expect(portal.portal.y).toBe(cold.layout.height);
		expect(pathsTouchWithoutBridge(portal.points, internal.points)).toBe(false);
		expect(cache.stats).toMatchObject({ misses: 1, hits: 1, entries: 1 });
	});

	it('solves concurrent incidents together, independently of contract order and cache state', () => {
		const document = oneNodeLeaf();
		const measurements = prepareLayoutDocument(document).measurements;
		const contracts = [
			incident('cross-b', RegionPortalSide.Top),
			incident('cross-a', RegionPortalSide.Top),
		];
		const cache = new RegionLocalLayoutCache();
		const input = { document, measurements, contracts };
		const cold = solveDedicatedRegionLeafWithIncidents(input);
		const miss = solveDedicatedRegionLeafWithIncidents({ ...input, cache });
		const hit = solveDedicatedRegionLeafWithIncidents({
			...input,
			contracts: contracts.toReversed(),
			cache,
		});
		expect(miss).toEqual(cold);
		expect(hit).toEqual(cold);
		if (cold.status !== RegionCompositionStatus.Selected) throw new Error(cold.reason);
		expect(cold.incidents).toHaveLength(2);
		const first = defined(cold.incidents[0]);
		const second = defined(cold.incidents[1]);
		expect(
			disallowedRouteContacts(
				{ id: first.relationId, points: first.points },
				{ id: second.relationId, points: second.points },
				[],
			).length > 0,
		).toBe(false);
		expect(cache.stats).toMatchObject({ misses: 1, hits: 1, entries: 1 });
	});

	it('places an incoming portal before an outgoing portal on a shared face', () => {
		const document = oneNodeLeaf();
		const measurements = prepareLayoutDocument(document).measurements;
		const attempt = solveDedicatedRegionLeafWithIncidents({
			document,
			measurements,
			contracts: [
				incident('a-outgoing', RegionPortalSide.Top),
				{
					relation: { id: 'z-incoming', from: 'other', to: 'c' },
					endpointId: 'c',
					role: RegionIncidentRole.Target,
					allowedSides: [RegionPortalSide.Top],
				},
			],
		});
		if (attempt.status !== RegionCompositionStatus.Selected) throw new Error(attempt.reason);
		const incoming = defined(
			attempt.incidents.find(({ relationId }) => relationId === 'z-incoming'),
		);
		const outgoing = defined(
			attempt.incidents.find(({ relationId }) => relationId === 'a-outgoing'),
		);
		expect(incoming.portal.x).toBeLessThan(outgoing.portal.x);
		expect(
			disallowedRouteContacts(
				{ id: incoming.relationId, points: incoming.points },
				{ id: outgoing.relationId, points: outgoing.points },
				[],
			).length > 0,
		).toBe(false);
	});

	it('keeps a local route isolated from a crossing incident', () => {
		const source = regionDocument();
		const document = {
			...source,
			nodes: source.nodes.filter(({ id }) => id === 'a-source' || id === 'a-target'),
			relations: source.relations.filter(({ id }) => id === 'inside-a'),
		};
		const measurements = prepareLayoutDocument(document).measurements;
		const attempt = solveDedicatedRegionLeafWithIncidents({
			document,
			measurements,
			contracts: [
				{
					relation: { id: 'cross', from: 'a-target', to: 'outside' },
					endpointId: 'a-target',
					role: RegionIncidentRole.Source,
					allowedSides: Object.values(RegionPortalSide),
				},
			],
		});
		if (attempt.status !== RegionCompositionStatus.Selected) throw new Error(attempt.reason);
		const path = defined(attempt.incidents[0]);
		const local = defined(attempt.layout.relations.find(({ id }) => id === 'inside-a'));
		expect(
			disallowedRouteContacts(
				{ id: path.relationId, points: path.points, from: path.endpointId },
				local,
				[],
			),
		).toEqual([]);
	});

	it('tries another route when the straight incident crosses local geometry', () => {
		const source = regionDocument();
		const document = {
			...source,
			nodes: source.nodes.filter(({ id }) => id === 'a-source' || id === 'a-target'),
			relations: source.relations.filter(({ id }) => id === 'inside-a'),
		};
		const base = prepareLayoutDocument(document).measurements;
		const sourceSize = defined(base.nodes.get('a-source'));
		const measurements = {
			...base,
			nodes: new Map(base.nodes).set('a-source', { ...sourceSize, width: 1_000 }),
		};
		const attempt = solveDedicatedRegionLeafWithIncidents({
			document,
			measurements,
			contracts: [
				{
					relation: { id: 'cross', from: 'a-source', to: 'outside' },
					endpointId: 'a-source',
					role: RegionIncidentRole.Source,
					allowedSides: [RegionPortalSide.Top, RegionPortalSide.Right],
				},
			],
		});
		if (attempt.status !== RegionCompositionStatus.Selected) throw new Error(attempt.reason);
		expect(attempt.witness.attempted).toBeGreaterThan(1);
		expect(
			attempt.witness.rejectedAlternatives.some(
				({ side, code }) =>
					side === RegionPortalSide.Top && code === RegionIncidentRejectionCode.RouteObstructed,
			),
		).toBe(true);
	});

	it('lets a member leave its containing group through a declared frame side', () => {
		const source = regionDocument();
		const document: LogicDocument = {
			...source,
			nodes: [
				{
					...defined(source.nodes.find(({ id }) => id === 'b')),
					groupId: 'container',
				},
			],
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'container',
					label: 'Container',
					layoutOrder: orderKey('a0'),
				},
			],
			relations: [],
		};
		const measurements = prepareLayoutDocument(document).measurements;
		const attempt = solveDedicatedRegionLeafWithIncidents({
			document,
			measurements,
			contracts: [
				{
					relation: { id: 'member-cross', from: 'b', to: 'outside' },
					endpointId: 'b',
					role: RegionIncidentRole.Source,
					allowedSides: [RegionPortalSide.Right],
				},
			],
		});
		if (attempt.status !== RegionCompositionStatus.Selected) throw new Error(attempt.reason);
		const path = defined(attempt.incidents[0]);
		const member = defined(attempt.layout.elements.find(({ id }) => id === 'b'));
		const group = defined(attempt.layout.elements.find(({ id }) => id === 'container'));
		expect(path.anchor.x).toBe(member.bounds.x + member.bounds.width);
		expect(path.portal.x).toBe(attempt.layout.width);
		expect(path.points).toHaveLength(2);
		expect(path.portal.x).toBeGreaterThan(group.bounds.x + group.bounds.width);
	});

	it('reports a typed unknown and rejected sides for a missing incident endpoint', () => {
		const document = oneNodeLeaf();
		const measurements = prepareLayoutDocument(document).measurements;
		const attempt = solveDedicatedRegionLeafWithIncidents({
			document,
			measurements,
			contracts: [
				{
					relation: { id: 'missing-cross', from: 'missing', to: 'other' },
					endpointId: 'missing',
					role: RegionIncidentRole.Source,
					allowedSides: [RegionPortalSide.Top, RegionPortalSide.Left],
				},
			],
		});
		expect(attempt).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.NoValidAlternative,
			witness: {
				attempted: 2,
				exhaustive: true,
				rejectedAlternatives: [
					{ side: RegionPortalSide.Top, code: RegionIncidentRejectionCode.PortUnavailable },
					{ side: RegionPortalSide.Left, code: RegionIncidentRejectionCode.PortUnavailable },
				],
			},
		});
	});

	it('reports an absent endpoint exhaustively even when another incident could be routed', () => {
		const document = oneNodeLeaf();
		const measurements = prepareLayoutDocument(document).measurements;
		const attempt = solveDedicatedRegionLeafWithIncidents({
			document,
			measurements,
			contracts: [
				incident('a-valid', RegionPortalSide.Top),
				{
					relation: { id: 'z-missing', from: 'missing', to: 'other' },
					endpointId: 'missing',
					role: RegionIncidentRole.Source,
					allowedSides: [RegionPortalSide.Top, RegionPortalSide.Right],
				},
			],
		});
		expect(attempt).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.NoValidAlternative,
			witness: {
				attempted: 2,
				exhaustive: true,
				rejectedAlternatives: [
					{ relationId: 'z-missing', side: RegionPortalSide.Top },
					{ relationId: 'z-missing', side: RegionPortalSide.Right },
				],
			},
		});
	});

	it('distinguishes an invalid contract from the explicit search bound', () => {
		const document = oneNodeLeaf();
		const measurements = prepareLayoutDocument(document).measurements;
		const invalid = solveDedicatedRegionLeafWithIncidents({
			document,
			measurements,
			contracts: [{ ...incident('invalid', RegionPortalSide.Top), allowedSides: [] }],
		});
		expect(invalid).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.InvalidContract,
			witness: { attempted: 0, exhaustive: true },
		});
		const bounded = solveDedicatedRegionLeafWithIncidents({
			document,
			measurements,
			contracts: Array.from({ length: 9 }, (_, index) =>
				incident(`cross-${index}`, RegionPortalSide.Top),
			),
		});
		expect(bounded).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.SearchBudgetExceeded,
			witness: { attempted: 0, exhaustive: false },
		});
	});
	it('retains documentary geometry when a better rank blocks a required region incident', () => {
		const entry = rankOrderComparisonCorpus().find(({ id }) => id === 'adjacent-2+2');
		if (entry === undefined) throw new Error('Missing routed rank fixture');
		const contracts = [
			{
				relation: { id: 'foreign-a', from: 'a', to: 'outside' },
				endpointId: 'a',
				role: RegionIncidentRole.Source,
				allowedSides: [RegionPortalSide.Top],
			},
			{
				relation: { id: 'foreign-d', from: 'd', to: 'outside' },
				endpointId: 'd',
				role: RegionIncidentRole.Source,
				allowedSides: [RegionPortalSide.Right],
			},
		];
		const measurements = satisfyMetricDemands(
			entry.measurements,
			incidentMetricDemands(contracts),
			entry.document.layout.direction,
		);
		const prepared = prepareLayoutDocument(entry.document);
		const documentary = evaluateDedicatedLayout(
			prepareLayout(prepared.graph, prepared.ranks),
			measurements,
		);
		const unconstrained = solveRegionLeafLayout({
			document: entry.document,
			measurements,
			leafPolicy: LayoutPolicy.Layered,
		});
		expect(unconstrained.layout).not.toEqual(documentary);
		const cache = new RegionLocalLayoutCache();
		const input = {
			document: entry.document,
			measurements: entry.measurements,
			contracts,
			cache,
		};
		const cold = solveDedicatedRegionLeafWithIncidents(input);
		const hit = solveDedicatedRegionLeafWithIncidents(input);
		expect(hit).toEqual(cold);
		if (cold.status !== RegionCompositionStatus.Selected) throw new Error(cold.reason);
		expect(cold.layout).toEqual(documentary);
		expect(cold.incidents).toHaveLength(2);
		const first = defined(cold.incidents.find(({ relationId }) => relationId === 'foreign-a'));
		const second = defined(cold.incidents.find(({ relationId }) => relationId === 'foreign-d'));
		expect(first.side).toBe(RegionPortalSide.Top);
		expect(second.side).toBe(RegionPortalSide.Right);
		expect(pathsTouchWithoutBridge(first.points, second.points)).toBe(false);
		for (const incident of cold.incidents)
			for (const route of cold.layout.relations)
				expect(pathsTouchWithoutBridge(incident.points, route.points)).toBe(false);
		expect(cache.stats).toMatchObject({ misses: 1, hits: 1, entries: 1 });
	});
});
