import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { pathsTouchWithoutBridge } from '../../../../src/lib/core/layout/nested-region-leaf-incident-contacts';
import { NestedRegionLocalLayoutCache } from '../../../../src/lib/core/layout/nested-region-local-cache';
import { NestedPortalSide } from '../../../../src/lib/core/layout/nested-region-types';
import {
	RegionGhostIncidentRole,
	RegionIncidentGhostStatus,
	solveRegionLeafWithGhostIncidents,
} from '../../../../src/lib/core/layout/region-incident-ghost';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument } from './nested-region-fixture';

function oneNodeLeaf(): LogicDocument {
	const source = depthTwoRegionDocument();
	return {
		...source,
		nodes: source.nodes.filter(({ id }) => id === 'c'),
		relations: [],
	};
}

const incidents = [
	{
		relationId: 'c-to-d',
		endpointId: 'c',
		side: NestedPortalSide.Top,
		role: RegionGhostIncidentRole.Source,
	},
	{
		relationId: 'inside-branch',
		endpointId: 'c',
		side: NestedPortalSide.Top,
		role: RegionGhostIncidentRole.Target,
	},
] as const;

function verticalLeaf(
	direction: LayoutDirection.TopToBottom | LayoutDirection.BottomToTop,
): LogicDocument {
	let bias = LayoutBias.Top;
	if (direction === LayoutDirection.BottomToTop) bias = LayoutBias.Bottom;
	return { ...oneNodeLeaf(), layout: { direction, bias } };
}

function roleFromMask(mask: number, index: number): RegionGhostIncidentRole {
	let role = RegionGhostIncidentRole.Target;
	if ((mask & (1 << index)) !== 0) role = RegionGhostIncidentRole.Source;
	return role;
}

describe('multiple incident ghosts', () => {
	it.each([
		[LayoutDirection.TopToBottom, NestedPortalSide.Top, 3, 80],
		[LayoutDirection.BottomToTop, NestedPortalSide.Bottom, 3, 80],
		[LayoutDirection.TopToBottom, NestedPortalSide.Top, 4, 220],
		[LayoutDirection.BottomToTop, NestedPortalSide.Bottom, 4, 220],
	] as const)(
		'solves every role assignment in %s at %s with %i incidents and %i px',
		(direction, side, count, width) => {
			const document = verticalLeaf(direction);
			const base = prepareLayoutDocument(document).measurements;
			const size = defined(base.nodes.get('c'));
			const measurements = { ...base, nodes: new Map([['c', { ...size, width }]]) };
			for (let mask = 0; mask < 2 ** count; mask += 1) {
				const requests = Array.from({ length: count }, (_, index) => ({
					relationId: `incident-${index}`,
					endpointId: 'c',
					side,
					role: roleFromMask(mask, index),
				}));
				const cold = solveRegionLeafWithGhostIncidents({
					document,
					measurements,
					incidents: requests,
				});
				if (cold.status !== RegionIncidentGhostStatus.Selected) throw new Error(cold.reason);
				expect(cold.layout.elements.map(({ id }) => id)).toEqual(['c']);
				expect(cold.layout.relations).toEqual([]);
				expect([...cold.ranks.byEndpointId.keys()]).toEqual(['c']);
				const permuted = solveRegionLeafWithGhostIncidents({
					document,
					measurements,
					incidents: requests.toReversed(),
				});
				expect(permuted).toEqual(cold);
				const node = defined(cold.layout.elements.find(({ id }) => id === 'c'));
				expect(new Set(cold.incidents.map(({ portal }) => portal.x)).size).toBe(count);
				for (const [index, incident] of cold.incidents.entries()) {
					let expectedY = 0;
					let nodeFaceY = node.bounds.y;
					if (side === NestedPortalSide.Bottom) {
						expectedY = cold.layout.height;
						nodeFaceY += node.bounds.height;
					}
					expect(incident.portal.y).toBe(expectedY);
					expect(incident.anchor.y).toBe(nodeFaceY);
					expect(incident.anchor.x).toBe(incident.portal.x);
					for (const other of cold.incidents.slice(index + 1))
						expect(pathsTouchWithoutBridge(incident.points, other.points)).toBe(false);
				}
			}
		},
	);

	it.each([
		[LayoutDirection.TopToBottom, NestedPortalSide.Top],
		[LayoutDirection.BottomToTop, NestedPortalSide.Bottom],
	] as const)('reports an insufficient four-incident node face in %s', (direction, side) => {
		const document = verticalLeaf(direction);
		const base = prepareLayoutDocument(document).measurements;
		const size = defined(base.nodes.get('c'));
		const requests = Array.from({ length: 4 }, (_, index) => ({
			relationId: `incident-${index}`,
			endpointId: 'c',
			side,
			role: roleFromMask(0b1010, index),
		}));
		const cache = new NestedRegionLocalLayoutCache();
		const narrow = { ...base, nodes: new Map([['c', { ...size, width: 80 }]]) };
		const narrowInput = { document, measurements: narrow, incidents: requests };
		const first = solveRegionLeafWithGhostIncidents({ ...narrowInput, cache });
		expect(first).toEqual({
			status: RegionIncidentGhostStatus.Unknown,
			reason: 'The auxiliary route misses the node face.',
		});
		expect(first).toEqual(solveRegionLeafWithGhostIncidents(narrowInput));
		const wide = { ...base, nodes: new Map([['c', { ...size, width: 220 }]]) };
		const wideInput = { document, measurements: wide, incidents: requests };
		const widened = solveRegionLeafWithGhostIncidents({ ...wideInput, cache });
		expect(widened).toEqual(solveRegionLeafWithGhostIncidents(wideInput));
		if (widened.status !== RegionIncidentGhostStatus.Selected) throw new Error(widened.reason);
		expect(widened.incidents).toHaveLength(4);
		expect(cache.stats).toMatchObject({ misses: 2, entries: 2 });
	});
	it('solves two real-pipeline top portals with distinct ordered node-face connections', () => {
		const document = oneNodeLeaf();
		const measurements = prepareLayoutDocument(document).measurements;
		const result = solveRegionLeafWithGhostIncidents({
			document,
			measurements,
			incidents,
		});
		if (result.status !== RegionIncidentGhostStatus.Selected) throw new Error(result.reason);
		expect(result.layout.elements.map(({ id }) => id)).toEqual(['c']);
		expect(result.layout.relations).toEqual([]);
		expect([...result.ranks.byEndpointId.keys()]).toEqual(['c']);
		expect(result.ranks.bands.flat()).toEqual(['c']);
		const incoming = defined(
			result.incidents.find(({ relationId }) => relationId === 'inside-branch'),
		);
		const outgoing = defined(result.incidents.find(({ relationId }) => relationId === 'c-to-d'));
		const node = defined(result.layout.elements[0]);
		expect(incoming.portal.x).toBeLessThan(outgoing.portal.x);
		expect(incoming.portal.y).toBe(0);
		expect(outgoing.portal.y).toBe(0);
		expect(incoming.points).toEqual([incoming.portal, incoming.anchor]);
		expect(outgoing.points).toEqual([outgoing.anchor, outgoing.portal]);
		for (const incident of result.incidents) {
			expect(incident.anchor.x).toBe(incident.portal.x);
			expect(incident.anchor.y).toBe(node.bounds.y);
			expect(incident.anchor.x).toBeGreaterThan(node.bounds.x);
			expect(incident.anchor.x).toBeLessThan(node.bounds.x + node.bounds.width);
		}
		expect(pathsTouchWithoutBridge(incoming.points, outgoing.points)).toBe(false);
	});

	it('is canonical under request permutation and equals a cache hit after the cold solve', () => {
		const document = oneNodeLeaf();
		const measurements = prepareLayoutDocument(document).measurements;
		const cold = solveRegionLeafWithGhostIncidents({
			document,
			measurements,
			incidents,
		});
		const cache = new NestedRegionLocalLayoutCache();
		const reversed = [...incidents].reverse();
		const miss = solveRegionLeafWithGhostIncidents({
			document,
			measurements,
			incidents: reversed,
			cache,
		});
		const hit = solveRegionLeafWithGhostIncidents({
			document,
			measurements,
			incidents,
			cache,
		});
		expect(miss).toEqual(cold);
		expect(hit).toEqual(cold);
		expect(cache.stats).toMatchObject({ misses: 1, hits: 1, entries: 1 });
	});

	it.each([
		[LayoutDirection.TopToBottom, NestedPortalSide.Top],
		[LayoutDirection.BottomToTop, NestedPortalSide.Bottom],
	] as const)(
		'keeps add, remove and rename of incidents deterministic on the %s node face',
		(direction, side) => {
			const document = verticalLeaf(direction);
			const base = prepareLayoutDocument(document).measurements;
			const size = defined(base.nodes.get('c'));
			const measurements = { ...base, nodes: new Map([['c', { ...size, width: 300 }]]) };
			const cache = new NestedRegionLocalLayoutCache();
			const requests = [
				{ relationId: 'incoming', endpointId: 'c', side, role: RegionGhostIncidentRole.Target },
				{ relationId: 'outgoing', endpointId: 'c', side, role: RegionGhostIncidentRole.Source },
				{ relationId: 'added', endpointId: 'c', side, role: RegionGhostIncidentRole.Source },
			];
			const run = (active: typeof requests) =>
				solveRegionLeafWithGhostIncidents({ document, measurements, incidents: active, cache });
			const pair = run(requests.slice(0, 2));
			const added = run(requests);
			const renamed = run(
				requests.map((request) => {
					if (request.relationId !== 'added') return request;
					return { ...request, relationId: 'renamed' };
				}),
			);
			const restored = run(requests.slice(0, 2));
			for (const candidate of [pair, added, renamed, restored]) {
				if (candidate.status !== RegionIncidentGhostStatus.Selected)
					throw new Error(`Expected selected multi-incident leaf: ${candidate.reason}`);
				const node = defined(candidate.layout.elements.find(({ id }) => id === 'c'));
				expect(candidate.layout.elements.map(({ id }) => id)).toEqual(['c']);
				expect(candidate.layout.relations).toEqual([]);
				for (const [index, incident] of candidate.incidents.entries()) {
					let expectedY = 0;
					let faceY = node.bounds.y;
					if (side === NestedPortalSide.Bottom) {
						expectedY = candidate.layout.height;
						faceY += node.bounds.height;
					}
					expect(incident.portal.y).toBe(expectedY);
					expect(incident.anchor.y).toBe(faceY);
					expect(incident.anchor.x).toBeGreaterThan(node.bounds.x);
					expect(incident.anchor.x).toBeLessThan(node.bounds.x + node.bounds.width);
					for (const other of candidate.incidents.slice(index + 1))
						expect(pathsTouchWithoutBridge(incident.points, other.points)).toBe(false);
				}
			}
			expect(restored).toEqual(pair);
			expect(added.status).toBe(RegionIncidentGhostStatus.Selected);
			if (added.status !== RegionIncidentGhostStatus.Selected) return;
			expect(added.incidents.map(({ relationId }) => relationId)).toEqual([
				'incoming',
				'added',
				'outgoing',
			]);
			expect(renamed.status).toBe(RegionIncidentGhostStatus.Selected);
			if (renamed.status !== RegionIncidentGhostStatus.Selected) return;
			expect(renamed.incidents.map(({ relationId }) => relationId)).toEqual([
				'incoming',
				'outgoing',
				'renamed',
			]);
			expect(cache.stats).toMatchObject({ misses: 3, hits: 1, entries: 3 });
		},
	);

	it('invalidates the projection for a changed real metric and retains a colliding real ID', () => {
		const source = oneNodeLeaf();
		const measurements = prepareLayoutDocument(source).measurements;
		const cache = new NestedRegionLocalLayoutCache();
		const original = solveRegionLeafWithGhostIncidents({
			document: source,
			measurements,
			incidents,
			cache,
		});
		const size = defined(measurements.nodes.get('c'));
		const editedMeasurements = {
			...measurements,
			nodes: new Map(measurements.nodes).set('c', {
				...size,
				width: size.width + 60,
			}),
		};
		const editedInput = {
			document: source,
			measurements: editedMeasurements,
			incidents,
		};
		const edited = solveRegionLeafWithGhostIncidents({ ...editedInput, cache });
		expect(edited).toEqual(solveRegionLeafWithGhostIncidents(editedInput));
		expect(edited).not.toEqual(original);
		expect(cache.stats).toMatchObject({ misses: 2, hits: 0, entries: 2 });
		const realId = '@region-incident-ghost/0-target/inside-branch';
		const document: LogicDocument = {
			...source,
			nodes: source.nodes.map((node) => ({ ...node, id: realId })),
		};
		const renamedMeasurements = {
			...measurements,
			nodes: new Map([[realId, size]]),
		};
		const renamed = solveRegionLeafWithGhostIncidents({
			document,
			measurements: renamedMeasurements,
			incidents: incidents.map((incident) => ({
				...incident,
				endpointId: realId,
			})),
		});
		if (renamed.status !== RegionIncidentGhostStatus.Selected) throw new Error(renamed.reason);
		expect(renamed.layout.elements.map(({ id }) => id)).toEqual([realId]);
		expect([...renamed.ranks.byEndpointId.keys()]).toEqual([realId]);
	});

	it('returns bounded diagnostics for unsupported leaf and incident contracts', () => {
		const document = oneNodeLeaf();
		const measurements = prepareLayoutDocument(document).measurements;
		const attempt = (changes: Record<string, unknown>) =>
			solveRegionLeafWithGhostIncidents({
				document,
				measurements,
				incidents,
				...changes,
			});
		expect(attempt({ incidents: [incidents[0]] })).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'Two to four incidents are supported.',
		});
		expect(attempt({ incidents: [...incidents, ...incidents, incidents[0]] })).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'Two to four incidents are supported.',
		});
		expect(
			attempt({
				document: {
					...document,
					layout: {
						direction: LayoutDirection.LeftToRight,
						bias: LayoutBias.Left,
					},
				},
			}),
		).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'Only vertical leaves are supported.',
		});
		expect(
			attempt({
				document: {
					...document,
					groups: [
						{
							kind: EndpointKind.Group,
							id: 'g',
							label: 'G',
							layoutOrder: orderKey('a8'),
						},
					],
				},
			}),
		).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'Only node-only leaves are supported.',
		});
		expect(
			attempt({
				document: {
					...document,
					relations: [{ id: 'local', from: 'c', to: 'c' }],
				},
			}),
		).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'Multiple incidents require one node and no local relations.',
		});
		expect(
			attempt({
				incidents: incidents.map((incident) => ({
					...incident,
					side: NestedPortalSide.Bottom,
				})),
			}),
		).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'The incident side opposes the flow.',
		});
		expect(
			attempt({
				incidents: incidents.map((incident) => ({
					...incident,
					endpointId: 'missing',
				})),
			}),
		).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'Every incident must meet the leaf node.',
		});
		expect(attempt({ incidents: [incidents[0], incidents[0]] })).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'Incident identities must be distinct.',
		});
	});

	it('supports the opposite vertical flow on its bottom boundary', () => {
		const source = oneNodeLeaf();
		const document: LogicDocument = {
			...source,
			layout: {
				direction: LayoutDirection.BottomToTop,
				bias: LayoutBias.Bottom,
			},
		};
		const measurements = prepareLayoutDocument(document).measurements;
		const result = solveRegionLeafWithGhostIncidents({
			document,
			measurements,
			incidents: incidents.map((incident) => ({
				...incident,
				side: NestedPortalSide.Bottom,
			})),
		});
		if (result.status !== RegionIncidentGhostStatus.Selected) throw new Error(result.reason);
		const node = defined(result.layout.elements[0]);
		for (const incident of result.incidents) {
			expect(incident.portal.y).toBe(result.layout.height);
			expect(incident.anchor.y).toBe(node.bounds.y + node.bounds.height);
		}
	});
});
