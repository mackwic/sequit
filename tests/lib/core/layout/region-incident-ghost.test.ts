import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	type LogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { pathsTouchWithoutBridge } from '../../../../src/lib/core/layout/nested-region-leaf-incident-contacts';
import { NestedRegionLocalLayoutCache } from '../../../../src/lib/core/layout/nested-region-local-cache';
import { NestedPortalSide } from '../../../../src/lib/core/layout/nested-region-types';
import {
	RegionIncidentGhostStatus,
	solveRegionLeafWithGhostIncident,
} from '../../../../src/lib/core/layout/region-incident-ghost';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { regionDocument } from './nested-region-fixture';

function leafDocument(
	direction: LayoutDirection.TopToBottom | LayoutDirection.BottomToTop,
): LogicDocument {
	const source = regionDocument();
	let layout: LayoutConfiguration = {
		direction: LayoutDirection.TopToBottom,
		bias: LayoutBias.Top,
	};
	if (direction === LayoutDirection.BottomToTop)
		layout = {
			direction: LayoutDirection.BottomToTop,
			bias: LayoutBias.Bottom,
		};
	return {
		...source,
		layout,
		nodes: source.nodes.filter(({ id }) => id === 'a-source' || id === 'a-target'),
		relations: source.relations.filter(({ id }) => id === 'inside-a'),
	};
}

describe('single incident ghost on a vertical leaf', () => {
	it.each([
		[LayoutDirection.TopToBottom, NestedPortalSide.Top],
		[LayoutDirection.BottomToTop, NestedPortalSide.Bottom],
	] as const)('separates the local route from a %s %s incident', (direction, side) => {
		const document = leafDocument(direction);
		const prepared = prepareLayoutDocument(document);
		const input = {
			document,
			measurements: prepared.measurements,
			relationId: 'a-target-to-outside',
			endpointId: 'a-target',
			side,
		};
		const result = solveRegionLeafWithGhostIncident(input);
		if (result.status !== RegionIncidentGhostStatus.Selected) throw new Error(result.reason);
		expect(result.layout.elements.map(({ id }) => id).sort()).toEqual(['a-source', 'a-target']);
		expect(result.layout.relations.map(({ id }) => id)).toEqual(['inside-a']);
		expect([...result.ranks.byEndpointId.keys()].sort()).toEqual(['a-source', 'a-target']);
		expect(result.ranks.bands.flat().sort()).toEqual(['a-source', 'a-target']);
		expect(result.incident.points[0]).toEqual(result.incident.anchor);
		expect(result.incident.points.at(-1)).toEqual(result.incident.portal);
		let expectedPortalY = 0;
		if (side === NestedPortalSide.Bottom) expectedPortalY = result.layout.height;
		expect(result.incident.portal.y).toBe(expectedPortalY);
		const endpoint = defined(result.layout.elements.find(({ id }) => id === 'a-target'));
		let expectedAnchorY = endpoint.bounds.y;
		if (side === NestedPortalSide.Bottom) expectedAnchorY += endpoint.bounds.height;
		expect(result.incident.anchor.y).toBe(expectedAnchorY);
		const local = defined(result.layout.relations.find(({ id }) => id === 'inside-a'));
		expect(pathsTouchWithoutBridge(result.incident.points, local.points)).toBe(false);
		expect(solveRegionLeafWithGhostIncident(input)).toEqual(result);
	});

	it('projects the real graph, ranks, and dedicated engine result', () => {
		const document = leafDocument(LayoutDirection.TopToBottom);
		const measurements = prepareLayoutDocument(document).measurements;
		const target = defined(document.nodes.find(({ id }) => id === 'a-target'));
		const ghostId = '@region-incident-ghost/a-target-to-outside';
		const routeId = '@region-incident-route/a-target-to-outside';
		const ghostNode: LogicNode = {
			kind: EndpointKind.Node,
			id: ghostId,
			natureId: target.natureId,
			markdown: 'Ghost\n',
			layoutOrder: target.layoutOrder,
		};
		const augmented: LogicDocument = {
			...document,
			nodes: [...document.nodes, ghostNode],
			relations: [...document.relations, { id: routeId, from: target.id, to: ghostId }],
		};
		const graph = createGraph(augmented);
		if (!graph.ok) throw new Error('Expected an acyclic auxiliary graph.');
		const ranks = topologicallyRank(graph.value);
		const direct = layoutWithDedicatedEngine(graph.value, ranks, {
			...measurements,
			nodes: new Map([...measurements.nodes, [ghostId, { width: 1, height: 1 }]]),
		});
		const result = solveRegionLeafWithGhostIncident({
			document,
			measurements,
			relationId: 'a-target-to-outside',
			endpointId: target.id,
			side: NestedPortalSide.Top,
		});
		if (result.status !== RegionIncidentGhostStatus.Selected) throw new Error(result.reason);
		const ghost = defined(direct.elements.find(({ id }) => id === ghostId));
		const offsetY = ghost.bounds.y + ghost.bounds.height;
		expect(result.ranks.byEndpointId).toEqual(
			new Map([...ranks.byEndpointId].filter(([id]) => id !== ghostId)),
		);
		expect(result.ranks.bands).toEqual(
			ranks.bands.map((band) => band.filter((id) => id !== ghostId)),
		);
		expect(result.layout.height).toBe(direct.height - offsetY);
		expect(result.layout.elements).toEqual(
			direct.elements
				.filter(({ id }) => id !== ghostId)
				.map((element) => ({
					...element,
					bounds: { ...element.bounds, y: element.bounds.y - offsetY },
				})),
		);
		expect(result.layout.relations).toEqual(
			direct.relations
				.filter(({ id }) => id !== routeId)
				.map((relation) => ({
					...relation,
					points: relation.points.map(({ x, y }) => ({ x, y: y - offsetY })),
				})),
		);
	});

	it('returns the same public geometry and ranks through the projection-owned cache', () => {
		const document = leafDocument(LayoutDirection.TopToBottom);
		const measurements = prepareLayoutDocument(document).measurements;
		const input = {
			document,
			measurements,
			relationId: 'a-target-to-outside',
			endpointId: 'a-target',
			side: NestedPortalSide.Top,
		};
		const cold = solveRegionLeafWithGhostIncident(input);
		const cache = new NestedRegionLocalLayoutCache();
		const miss = solveRegionLeafWithGhostIncident({ ...input, cache });
		const hit = solveRegionLeafWithGhostIncident({ ...input, cache });
		expect(miss).toEqual(cold);
		expect(hit).toEqual(cold);
		expect(cache.stats).toMatchObject({ misses: 1, hits: 1, entries: 1 });
	});

	it('invalidates the augmented leaf for a real metric or incident identity edit', () => {
		const document = leafDocument(LayoutDirection.TopToBottom);
		const measurements = prepareLayoutDocument(document).measurements;
		const cache = new NestedRegionLocalLayoutCache();
		const input = {
			document,
			measurements,
			relationId: 'a-target-to-outside',
			endpointId: 'a-target',
			side: NestedPortalSide.Top,
		};
		const original = solveRegionLeafWithGhostIncident({ ...input, cache });
		expect(original.status).toBe(RegionIncidentGhostStatus.Selected);
		const size = defined(measurements.nodes.get('a-target'));
		const changedMeasurements = {
			...measurements,
			nodes: new Map(measurements.nodes).set('a-target', {
				width: size.width + 40,
				height: size.height,
			}),
		};
		const editedInput = { ...input, measurements: changedMeasurements };
		const edited = solveRegionLeafWithGhostIncident({ ...editedInput, cache });
		expect(edited).toEqual(solveRegionLeafWithGhostIncident(editedInput));
		expect(edited).not.toEqual(original);
		const renamedInput = { ...editedInput, relationId: 'renamed-incident' };
		const renamed = solveRegionLeafWithGhostIncident({
			...renamedInput,
			cache,
		});
		expect(renamed).toEqual(solveRegionLeafWithGhostIncident(renamedInput));
		expect(cache.stats).toMatchObject({ misses: 3, hits: 0, entries: 3 });
	});

	it('keeps real identities when they collide with generated ghost names', () => {
		const source = leafDocument(LayoutDirection.TopToBottom);
		const ghostId = '@region-incident-ghost/outside';
		const routeId = '@region-incident-route/outside';
		const document: LogicDocument = {
			...source,
			nodes: source.nodes.map((node) => {
				if (node.id === 'a-source') return { ...node, id: ghostId };
				return node;
			}),
			relations: [{ id: routeId, from: ghostId, to: 'a-target' }],
		};
		const base = prepareLayoutDocument(source).measurements;
		const sourceSize = defined(base.nodes.get('a-source'));
		const measurements = {
			...base,
			nodes: new Map(
				[...base.nodes].filter(([id]) => id !== 'a-source').concat([[ghostId, sourceSize]]),
			),
		};
		const result = solveRegionLeafWithGhostIncident({
			document,
			measurements,
			relationId: 'outside',
			endpointId: 'a-target',
			side: NestedPortalSide.Top,
		});
		if (result.status !== RegionIncidentGhostStatus.Selected) throw new Error(result.reason);
		expect(result.layout.elements.map(({ id }) => id)).toContain(ghostId);
		expect(result.layout.elements.map(({ id }) => id)).not.toContain(
			'@region-incident-ghost/outside#1',
		);
		expect(result.layout.relations.map(({ id }) => id)).toEqual([routeId]);
		expect(result.layout.relations.map(({ id }) => id)).not.toContain(
			'@region-incident-route/outside#1',
		);
	});

	it('reports precise unsupported inputs and an invalid augmented graph', () => {
		const document = leafDocument(LayoutDirection.TopToBottom);
		const measurements = prepareLayoutDocument(document).measurements;
		const input = {
			document,
			measurements,
			relationId: 'outside',
			endpointId: 'a-target',
			side: NestedPortalSide.Top,
		};
		expect(
			solveRegionLeafWithGhostIncident({
				...input,
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
			solveRegionLeafWithGhostIncident({
				...input,
				document: {
					...document,
					junctions: [
						{
							kind: EndpointKind.Junction,
							id: 'j',
							operator: JunctionOperator.Xor,
							layoutOrder: orderKey('a8'),
						},
					],
				},
			}),
		).toMatchObject({ status: RegionIncidentGhostStatus.Unsupported });
		expect(solveRegionLeafWithGhostIncident({ ...input, endpointId: 'a-source' })).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'The local relation must enter the incident endpoint.',
		});
		expect(solveRegionLeafWithGhostIncident({ ...input, relationId: 'inside-a' })).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'The incident identity is not local.',
		});
		expect(
			solveRegionLeafWithGhostIncident({
				...input,
				endpointId: 'missing',
				document: {
					...document,
					relations: [{ id: 'inside-a', from: 'a-source', to: 'missing' }],
				},
			}),
		).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'The incident endpoint is not a leaf node.',
		});
		const cyclic = solveRegionLeafWithGhostIncident({
			...input,
			document: {
				...document,
				relations: [{ id: 'inside-a', from: 'a-target', to: 'a-target' }],
			},
		});
		expect(cyclic.status).toBe(RegionIncidentGhostStatus.Unknown);
	});

	it.each([
		[LayoutDirection.TopToBottom, NestedPortalSide.Bottom],
		[LayoutDirection.BottomToTop, NestedPortalSide.Top],
	] as const)('marks the same-flow %s %s side unsupported', (direction, side) => {
		const document = leafDocument(direction);
		const prepared = prepareLayoutDocument(document);
		expect(
			solveRegionLeafWithGhostIncident({
				document,
				measurements: prepared.measurements,
				relationId: 'a-target-to-outside',
				endpointId: 'a-target',
				side,
			}),
		).toMatchObject({ status: RegionIncidentGhostStatus.Unsupported });
	});

	it('reports its bounded envelope for horizontal leaves and multiple local relations', () => {
		const source = leafDocument(LayoutDirection.TopToBottom);
		const horizontal: LogicDocument = {
			...source,
			layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		};
		const prepared = prepareLayoutDocument(source);
		const input = {
			document: horizontal,
			measurements: prepared.measurements,
			relationId: 'outside',
			endpointId: 'a-target',
			side: NestedPortalSide.Top,
		};
		expect(solveRegionLeafWithGhostIncident(input)).toMatchObject({
			status: RegionIncidentGhostStatus.Unsupported,
			reason: 'Only vertical leaves are supported.',
		});
		expect(
			solveRegionLeafWithGhostIncident({
				...input,
				document: {
					...source,
					relations: [
						...source.relations,
						{ id: 'another-local', from: 'a-source', to: 'a-target' },
					],
				},
			}),
		).toMatchObject({ status: RegionIncidentGhostStatus.Unsupported });
	});
});
