import { describe, expect, it } from 'vitest';

import {
	defined,
	LaneOrientation,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { ROOT_LAYOUT_REGION_ID } from '../../../../src/lib/core/document/region-presentation';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { validateGridCellLaneGeometry } from '../../../../src/lib/core/layout/grid-cell-lane-validation';
import type { Bounds, LayoutMeasurements } from '../../../../src/lib/core/layout/layout-types';
import { pathsTouchWithoutBridge } from '../../../../src/lib/core/layout/nested-region-leaf-incident-contacts';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/nested-region-leaf-incident-validation';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/region-composition-types';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/region-geometry-diagnostic';
import {
	type RegionIncidentContract,
	RegionIncidentRejectionCode,
	RegionIncidentRole,
} from '../../../../src/lib/core/layout/region-incident-contract';
import {
	RegionLocalLayoutCache,
	regionLocalLayoutKey,
} from '../../../../src/lib/core/layout/region-local-cache';
import { layoutWithRootRegionForProjection } from '../../../../src/lib/core/layout/root-region';
import type { SharedLaneGeometry } from '../../../../src/lib/core/layout/shared-lane-geometry';
import {
	directSharedLaneIncidentPath,
	validateSharedLaneIncidentPath,
} from '../../../../src/lib/core/layout/shared-lane-incident-validation';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	persistedNestedGridDocument,
	persistedNestedGridWithInnerLaneCrossingDocument,
	persistedNestedGridWithLaneCellDocument,
	persistedNestedGridWithLaneCrossingDocument,
} from './nested-region-fixture';

function regionInput(document: LogicDocument): RegionInput {
	const presentation = defined(document.regionPresentation);
	return {
		regions: [
			{ id: ROOT_LAYOUT_REGION_ID, layoutOrder: 'a0' },
			...presentation.regions.map((region) => {
				if (region.parentId !== undefined) return region;
				return { ...region, parentId: ROOT_LAYOUT_REGION_ID };
			}),
		],
		regionByEndpointId: new Map(
			[...document.nodes, ...document.groups, ...document.junctions].map(({ id, regionId }) => [
				id,
				defined(regionId),
			]),
		),
	};
}

function contains(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.x > outer.x &&
		inner.y > outer.y &&
		inner.x + inner.width < outer.x + outer.width &&
		inner.y + inner.height < outer.y + outer.height
	);
}

function resizedB2(measurements: LayoutMeasurements): LayoutMeasurements {
	const nodes = new Map(measurements.nodes);
	const b2 = defined(nodes.get('b2'));
	nodes.set('b2', { ...b2, width: b2.width + 72.5 });
	return { ...measurements, nodes };
}

function outgoingContract(document: LogicDocument, relationId: string): RegionIncidentContract {
	const relation = defined(document.relations.find(({ id }) => id === relationId));
	return {
		relation,
		endpointId: relation.from,
		role: RegionIncidentRole.Source,
		allowedSides: [RegionPortalSide.Right],
	};
}

function laneIncidentIssue(geometry: SharedLaneGeometry, contract: RegionIncidentContract) {
	const path = directSharedLaneIncidentPath(
		geometry,
		{
			offsetByIncidence: new Map(),
			demandByEndpoint: new Map(),
			incidentOffsetByFace: new Map(),
		},
		contract,
		RegionPortalSide.Right,
	);
	if ('code' in path) return path;
	return validateSharedLaneIncidentPath(geometry, contract, path);
}

describe('a two-lane leaf in a recursive grid cell', () => {
	it('publishes both lanes and the local route inside its cell and the root canvas', () => {
		const document = persistedNestedGridWithLaneCellDocument();
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected lane cell: ${selected.status}: ${selected.reason}`);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
		if (normalized.status !== RegionCompositionModelStatus.Ready) return;
		expect(validateRegionCompositionGeometry(normalized.model, selected)).toBeUndefined();
		const cell = defined(selected.regions.find(({ id }) => id === 'b'));
		const grid = defined(selected.regions.find(({ id }) => id === 'grid'));
		const lanes = selected.layout.lanes ?? [];
		expect(lanes.map(({ id, regionId, label }) => ({ id, regionId, label }))).toEqual([
			{ id: 'left', regionId: 'b', label: 'Left' },
			{ id: 'right', regionId: 'b', label: 'Right' },
		]);
		for (const lane of lanes) {
			expect(contains(cell.bounds, lane.bounds)).toBe(true);
			expect(contains(grid.bounds, lane.bounds)).toBe(true);
		}
		for (const [nodeId, laneId] of [
			['b', 'left'],
			['b2', 'right'],
		] as const) {
			const element = defined(selected.layout.elements.find(({ id }) => id === nodeId));
			const lane = defined(lanes.find(({ id }) => id === laneId));
			expect(contains(lane.bounds, element.bounds)).toBe(true);
		}
		expect(selected.portals.some(({ relationId }) => relationId === 'inside-b')).toBe(false);
		expect(selected.ownedRoutes.find(({ relationId }) => relationId === 'inside-b')?.regionId).toBe(
			'b',
		);
		const projected = layoutWithRootRegionForProjection(
			prepared.graph,
			prepared.ranks,
			prepared.measurements,
			new RegionLocalLayoutCache(),
		);
		expect(projected.lanes).toEqual(lanes);
	});

	it('matches a cold solve after a local lane measurement changes', () => {
		const document = persistedNestedGridWithLaneCellDocument();
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const cache = new RegionLocalLayoutCache();
		const first = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		expect(first.status).toBe(RegionCompositionStatus.Selected);
		const measurements = resizedB2(prepared.measurements);
		const incremental = solveRecursiveNestedRegionLayout(
			prepared.graph,
			measurements,
			input,
			cache,
		);
		const cold = solveRecursiveNestedRegionLayout(prepared.graph, measurements, input);
		expect(incremental).toEqual(cold);
		expect(incremental.status).toBe(RegionCompositionStatus.Selected);
		expect(incremental).not.toEqual(first);
		expect(cache.stats).toMatchObject({ misses: 6, hits: 4 });
	});

	it('reserves a distinct passage for the inner-lane incident and local route', () => {
		const document = persistedNestedGridWithInnerLaneCrossingDocument();
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected inner-lane crossing: ${selected.status}: ${selected.reason}`);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		expect(validateRegionCompositionGeometry(normalized.model, selected)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, selected)).toBeUndefined();
		const cell = defined(selected.regions.find(({ id }) => id === 'b'));
		const local = defined(cell.localLayout);
		const geometry = { ...local, lanes: defined(local.lanes) };
		expect(laneIncidentIssue(geometry, outgoingContract(document, 'leaves-b'))).toBeUndefined();
		const b = defined(selected.layout.elements.find(({ id }) => id === 'b'));
		const localRoute = defined(selected.layout.relations.find(({ id }) => id === 'inside-b'));
		const incident = defined(selected.layout.relations.find(({ id }) => id === 'leaves-b'));
		expect(localRoute.points[0]?.y).toBeLessThan(incident.points[0]?.y ?? 0);
		expect(incident.points[0]).toEqual({
			x: b.bounds.x + b.bounds.width,
			y: b.bounds.y + b.bounds.height / 2,
		});
		expect(
			selected.ownedRoutes
				.filter(({ relationId }) => relationId === 'leaves-b')
				.map(({ regionId }) => regionId),
		).toEqual(['b', 'grid', 'd']);
		expect(
			layoutWithRootRegionForProjection(
				prepared.graph,
				prepared.ranks,
				prepared.measurements,
				new RegionLocalLayoutCache(),
			),
		).toEqual({
			...selected.layout,
			regions: selected.regions.map(({ id, bounds }) => ({ id, bounds })),
		});
	});

	it('keeps a same-measure inner-lane incident cold-equal after an edit and permutation', () => {
		const source = persistedNestedGridWithInnerLaneCrossingDocument();
		const prepared = prepareLayoutDocument(source);
		const input = regionInput(source);
		const cache = new RegionLocalLayoutCache();
		const first = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		expect(first.status).toBe(RegionCompositionStatus.Selected);
		const edited: LogicDocument = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'leaves-b') return relation;
				return { ...relation, id: 'edited-leaves-b' };
			}),
		};
		const next = prepareLayoutDocument(edited);
		const editedInput = regionInput(edited);
		const previousStats = cache.stats;
		const incremental = solveRecursiveNestedRegionLayout(
			next.graph,
			prepared.measurements,
			editedInput,
			cache,
		);
		const cold = solveRecursiveNestedRegionLayout(next.graph, prepared.measurements, editedInput);
		expect(incremental).toEqual(cold);
		if (cold.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected edited incident: ${cold.status}: ${cold.reason}`);
		// The crossing contract belongs to both endpoint leaves.
		expect(cache.stats.misses).toBe(previousStats.misses + 2);
		const permuted: LogicDocument = {
			...edited,
			nodes: [...edited.nodes].reverse(),
			relations: [...edited.relations].reverse(),
			regionPresentation: {
				...defined(edited.regionPresentation),
				regions: [...defined(edited.regionPresentation).regions].reverse(),
			},
		};
		const alternate = prepareLayoutDocument(permuted);
		const alternateSelected = solveRecursiveNestedRegionLayout(
			alternate.graph,
			prepared.measurements,
			regionInput(permuted),
			cache,
		);
		expect(alternateSelected).toEqual(cold);
		expect(
			regionLocalLayoutKey(source, prepared.measurements, undefined, [
				outgoingContract(source, 'leaves-b'),
			]),
		).not.toBe(
			regionLocalLayoutKey(source, prepared.measurements, undefined, [
				outgoingContract(edited, 'edited-leaves-b'),
			]),
		);
		const widened = resizedB2(prepared.measurements);
		const nodes = new Map(widened.nodes);
		const b = defined(nodes.get('b'));
		nodes.set('b', { ...b, height: b.height + 18.5 });
		const measurements = { ...widened, nodes };
		const varied = solveRecursiveNestedRegionLayout(next.graph, measurements, editedInput, cache);
		expect(varied).toEqual(solveRecursiveNestedRegionLayout(next.graph, measurements, editedInput));
		expect(varied.status).toBe(RegionCompositionStatus.Selected);
		const switched: LogicDocument = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'leaves-b') return relation;
				return { ...relation, from: 'b2' };
			}),
		};
		const switchedPrepared = prepareLayoutDocument(switched);
		const statsBeforeSwitch = cache.stats;
		const reused = solveRecursiveNestedRegionLayout(
			switchedPrepared.graph,
			prepared.measurements,
			regionInput(switched),
			cache,
		);
		const switchedCold = solveRecursiveNestedRegionLayout(
			switchedPrepared.graph,
			prepared.measurements,
			regionInput(switched),
		);
		expect(reused).toEqual(switchedCold);
		if (reused.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected switched incident: ${reused.status}: ${reused.reason}`);
		if (first.status !== RegionCompositionStatus.Selected)
			throw new Error('Expected the original incident to be selected');
		expect(defined(reused.regions.find(({ id }) => id === 'b')).localLayout).not.toEqual(
			defined(first.regions.find(({ id }) => id === 'b')).localLayout,
		);
		expect(cache.stats.misses).toBe(statsBeforeSwitch.misses + 2);
	});

	it('rejects an inner-lane crossing without its single local passage', () => {
		const source = persistedNestedGridWithInnerLaneCrossingDocument();
		const document: LogicDocument = {
			...source,
			relations: source.relations.filter(({ id }) => id !== 'inside-b'),
		};
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const prepared = prepareLayoutDocument(document);
		const attempt = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			regionInput(document),
		);
		expect(attempt).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionGeometryDiagnosticCode.GridCrossingEntersElement,
		});
		if (attempt.status === RegionCompositionStatus.Unknown)
			expect(attempt.reason).toContain('enters element b2');
	});

	it('returns unknown when an outer-lane node blocks the reserved corridor', () => {
		const source = persistedNestedGridWithInnerLaneCrossingDocument();
		const b2 = defined(source.nodes.find(({ id }) => id === 'b2'));
		const document: LogicDocument = {
			...source,
			nodes: [...source.nodes, { ...b2, id: 'b3', markdown: 'B3\n', layoutOrder: orderKey('a7') }],
		};
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const prepared = prepareLayoutDocument(document);
		const attempt = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			regionInput(document),
		);
		expect(attempt.status).toBe(RegionCompositionStatus.Unknown);
		if (attempt.status !== RegionCompositionStatus.Unknown) return;
		expect(attempt.code).toBe(RegionGeometryDiagnosticCode.GridCrossingEntersElement);
		expect(attempt.reason).toContain('enters element b3');
	});

	it('rejects forged face capacity or a node obstructing the reserved lane passage', () => {
		const source = persistedNestedGridWithInnerLaneCrossingDocument();
		const prepared = prepareLayoutDocument(source);
		const input = regionInput(source);
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected passage: ${selected.status}: ${selected.reason}`);
		const local = defined(defined(selected.regions.find(({ id }) => id === 'b')).localLayout);
		const geometry = { ...local, lanes: defined(local.lanes) };
		const b = defined(local.elements.find(({ id }) => id === 'b'));
		const anchorY = b.bounds.y + b.bounds.height / 2;
		const relation = defined(local.relations.find(({ id }) => id === 'inside-b'));
		const points = relation.points.map((point, index) => {
			if (index >= 2) return point;
			return { ...point, y: anchorY };
		});
		const occupiedPort = {
			...geometry,
			relations: [{ ...relation, points }],
		};
		const contract = outgoingContract(source, 'leaves-b');
		expect(laneIncidentIssue(geometry, { ...contract, endpointId: 'removed-b' })).toMatchObject({
			code: RegionIncidentRejectionCode.InvalidAttachment,
		});
		expect(
			laneIncidentIssue({ ...geometry, width: b.bounds.x + b.bounds.width }, contract),
		).toMatchObject({ code: RegionIncidentRejectionCode.PortUnavailable });
		expect(laneIncidentIssue(occupiedPort, contract)).toMatchObject({
			code: RegionIncidentRejectionCode.PortUnavailable,
			reason:
				'Incident leaves-b cannot use edge b/right: an occupied slot is beside the demanded port within PORT_SPACING (held by inside-b).',
		});
		const incoming = {
			...geometry,
			relations: [
				{
					...relation,
					id: 'incoming-b',
					from: 'b2',
					to: 'b',
					points: [...relation.points].reverse(),
				},
			],
		};
		expect(laneIncidentIssue(incoming, contract)).toBeUndefined();
		const detour = {
			...geometry,
			relations: [
				{
					...relation,
					points: relation.points.map((point, index) => {
						if (index !== 2 && index !== 3) return point;
						return { ...point, y: anchorY + 48 };
					}),
				},
			],
		};
		expect(laneIncidentIssue(detour, contract)).toMatchObject({
			code: RegionIncidentRejectionCode.RouteObstructed,
			reason: 'Incident leaves-b touches local relation inside-b in its lane leaf.',
		});
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		const globalIncident = defined(selected.layout.relations.find(({ id }) => id === 'leaves-b'));
		const globalAnchorY = defined(globalIncident.points[0]).y;
		const sharedTrunk = {
			...selected,
			ownedRoutes: selected.ownedRoutes.map((piece) => {
				if (piece.relationId !== 'inside-b') return piece;
				return {
					...piece,
					points: piece.points.map((point, index) => {
						if (index >= 2) return point;
						return { ...point, y: globalAnchorY };
					}),
				};
			}),
		};
		expect(validateNestedRegionLeafIncidents(normalized.model, sharedTrunk)).toBe(
			'Relation leaves-b incident touches local relation inside-b in leaf b without a defined bridge.',
		);
		const b2 = defined(local.elements.find(({ id }) => id === 'b2'));
		const obstructed = {
			...geometry,
			elements: geometry.elements.map((element) => {
				if (element.id !== 'b2') return element;
				return {
					...b2,
					bounds: {
						...b2.bounds,
						x: b.bounds.x + b.bounds.width + 72,
						y: anchorY - 30,
					},
				};
			}),
		};
		expect(laneIncidentIssue(obstructed, contract)).toMatchObject({
			code: RegionIncidentRejectionCode.RouteObstructed,
			reason: 'Incident leaves-b crosses node b2 in its lane leaf.',
		});
	});

	it('selects a second intercell incident on the lane cell by reallocating the grid rails', () => {
		const source = persistedNestedGridWithLaneCrossingDocument();
		const document: LogicDocument = {
			...source,
			relations: [...source.relations, { id: 'second-leaves-b', from: 'b2', to: 'c' }],
		};
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, attempt)).toBeUndefined();
		const routes = new Map(attempt.layout.relations.map((route) => [route.id, route]));
		const first = defined(routes.get('leaves-b'));
		const second = defined(routes.get('second-leaves-b'));
		expect(first.points[0]).not.toEqual(second.points[0]);
		expect(pathsTouchWithoutBridge(first.points, second.points)).toBe(false);
	});

	it('evaluates a non-monotone lane crossing and transverse lanes through the contract', () => {
		const source = persistedNestedGridWithLaneCrossingDocument();
		const sideways: LogicDocument = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'leaves-b') return relation;
				return { ...relation, to: 'c' };
			}),
		};
		expect(validateLogicDocument(sideways)).toMatchObject({ ok: true });
		const sidewaysPrepared = prepareLayoutDocument(sideways);
		const sidewaysInput = regionInput(sideways);
		const sidewaysAttempt = solveRecursiveNestedRegionLayout(
			sidewaysPrepared.graph,
			sidewaysPrepared.measurements,
			sidewaysInput,
		);
		expect(sidewaysAttempt.status).toBe(RegionCompositionStatus.Selected);
		if (sidewaysAttempt.status === RegionCompositionStatus.Selected) {
			const model = normalizeRegionCompositionModel(sidewaysPrepared.graph, sidewaysInput);
			if (model.status !== RegionCompositionModelStatus.Ready)
				throw new Error('Expected normalized sideways region composition');
			expect(validateRegionCompositionGeometry(model.model, sidewaysAttempt)).toBeUndefined();
		}
		const transverse: LogicDocument = {
			...source,
			regionPresentation: {
				...source.regionPresentation,
				regions: source.regionPresentation.regions.map((region) => {
					if (region.id !== 'b' || region.lanePresentation === undefined) return region;
					return {
						...region,
						lanePresentation: {
							...region.lanePresentation,
							laneOrientation: LaneOrientation.Transverse,
						},
					};
				}),
			},
		};
		expect(validateLogicDocument(transverse)).toMatchObject({ ok: true });
		const transversePrepared = prepareLayoutDocument(transverse);
		const transverseInput = regionInput(transverse);
		const transverseAttempt = solveRecursiveNestedRegionLayout(
			transversePrepared.graph,
			transversePrepared.measurements,
			transverseInput,
		);
		expect(transverseAttempt.status).toBe(RegionCompositionStatus.Selected);
		if (transverseAttempt.status === RegionCompositionStatus.Selected) {
			const model = normalizeRegionCompositionModel(transversePrepared.graph, transverseInput);
			if (model.status !== RegionCompositionModelStatus.Ready)
				throw new Error('Expected normalized transverse region composition');
			expect(validateRegionCompositionGeometry(model.model, transverseAttempt)).toBeUndefined();
		}
	});

	it('composes a lane-cell incident across the grid boundary', () => {
		const source = persistedNestedGridWithLaneCellDocument();
		const document: LogicDocument = {
			...source,
			relations: [
				...source.relations.filter(({ id }) => id !== 'across-grid'),
				{ id: 'leaves-grid', from: 'b2', to: 'outside' },
			],
		};
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		expect(normalizeRegionCompositionModel(prepared.graph, input).status).toBe(
			RegionCompositionModelStatus.Ready,
		);
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error(
				`Expected selected lane-cell incident: ${selected.status}: ${selected.reason}`,
			);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		expect(validateRegionCompositionGeometry(normalized.model, selected)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, selected)).toBeUndefined();
		expect(
			selected.portals
				.filter(({ relationId }) => relationId === 'leaves-grid')
				.map(({ regionId }) => regionId),
		).toEqual(['b', 'grid', 'outside']);
	});

	it('selects one right-lane incident with a local lane route and complete ownership', () => {
		const document = persistedNestedGridWithLaneCrossingDocument();
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected lane crossing: ${selected.status}: ${selected.reason}`);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		expect(validateRegionCompositionGeometry(normalized.model, selected)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, selected)).toBeUndefined();
		expect(
			selected.portals
				.filter(({ relationId }) => relationId === 'leaves-b')
				.map(({ regionId, side }) => [regionId, side]),
		).toEqual([
			['b', RegionPortalSide.Right],
			['d', RegionPortalSide.Right],
		]);
		expect(
			selected.ownedRoutes
				.filter(({ relationId }) => relationId === 'leaves-b')
				.map(({ regionId }) => regionId),
		).toEqual(['b', 'grid', 'd']);
		expect(selected.layout.relations.map(({ id }) => id)).toContain('inside-b');
		expect(
			layoutWithRootRegionForProjection(
				prepared.graph,
				prepared.ranks,
				prepared.measurements,
				new RegionLocalLayoutCache(),
			),
		).toEqual({
			...selected.layout,
			regions: selected.regions.map(({ id, bounds }) => ({ id, bounds })),
		});
	});

	it('keeps the intercell lane route equal after cache hits, measure edits, and a cold solve', () => {
		const crossing = persistedNestedGridWithLaneCrossingDocument();
		const without: LogicDocument = {
			...crossing,
			relations: crossing.relations.filter(({ id }) => id !== 'leaves-b'),
		};
		const cache = new RegionLocalLayoutCache();
		const first = prepareLayoutDocument(without);
		expect(
			solveRecursiveNestedRegionLayout(first.graph, first.measurements, regionInput(without), cache)
				.status,
		).toBe(RegionCompositionStatus.Selected);
		const prepared = prepareLayoutDocument(crossing);
		const input = regionInput(crossing);
		const incremental = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		const cold = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(incremental).toEqual(cold);
		expect(incremental.status).toBe(RegionCompositionStatus.Selected);
		const statsAfterIncremental = cache.stats;
		expect(
			solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input, cache),
		).toEqual(cold);
		expect(cache.stats.misses).toBe(statsAfterIncremental.misses);
		expect(cache.stats.hits).toBeGreaterThan(statsAfterIncremental.hits);
		const measurements = resizedB2(prepared.measurements);
		const resized = solveRecursiveNestedRegionLayout(prepared.graph, measurements, input, cache);
		expect(resized).toEqual(solveRecursiveNestedRegionLayout(prepared.graph, measurements, input));
		expect(resized.status).toBe(RegionCompositionStatus.Selected);
		const renamed: LogicDocument = {
			...crossing,
			relations: crossing.relations.map((relation) => {
				if (relation.id !== 'leaves-b') return relation;
				return { ...relation, id: 'renamed-leaves-b' };
			}),
		};
		const renamedPrepared = prepareLayoutDocument(renamed);
		const renamedInput = regionInput(renamed);
		const reused = solveRecursiveNestedRegionLayout(
			renamedPrepared.graph,
			renamedPrepared.measurements,
			renamedInput,
			cache,
		);
		expect(reused).toEqual(
			solveRecursiveNestedRegionLayout(
				renamedPrepared.graph,
				renamedPrepared.measurements,
				renamedInput,
			),
		);
		if (reused.status !== RegionCompositionStatus.Selected)
			throw new Error('Expected renamed crossing to be selected');
		expect(reused.layout.relations.some(({ id }) => id === 'leaves-b')).toBe(false);
		expect(reused.layout.relations.some(({ id }) => id === 'renamed-leaves-b')).toBe(true);
	});

	it('keeps the intercell lane route and portal geometry under collection permutations', () => {
		const source = persistedNestedGridWithLaneCrossingDocument();
		const permuted: LogicDocument = {
			...source,
			nodes: [...source.nodes].reverse(),
			relations: [...source.relations].reverse(),
			regionPresentation: {
				...source.regionPresentation,
				regions: [...source.regionPresentation.regions].reverse(),
			},
		};
		const prepared = prepareLayoutDocument(source);
		const selected = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			regionInput(source),
		);
		const alternatePrepared = prepareLayoutDocument(permuted);
		const alternate = solveRecursiveNestedRegionLayout(
			alternatePrepared.graph,
			alternatePrepared.measurements,
			regionInput(permuted),
		);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error('Expected the original crossing to be selected');
		if (alternate.status !== RegionCompositionStatus.Selected)
			throw new Error('Expected the permuted crossing to be selected');
		expect(alternate.layout.relations.find(({ id }) => id === 'leaves-b')).toEqual(
			selected.layout.relations.find(({ id }) => id === 'leaves-b'),
		);
		expect(alternate.portals).toEqual(selected.portals);
		expect(alternate.layout.lanes).toEqual(selected.layout.lanes);
	});

	it('rejects a falsified cell portal or node-face attachment', () => {
		const source = persistedNestedGridWithLaneCrossingDocument();
		const prepared = prepareLayoutDocument(source);
		const input = regionInput(source);
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error('Expected a selected lane crossing');
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		const displacedPortal = {
			...selected,
			portals: selected.portals.map((portal) => {
				if (portal.relationId !== 'leaves-b' || portal.regionId !== 'b') return portal;
				return {
					...portal,
					localPoint: { ...portal.localPoint, x: portal.localPoint.x - 1 },
				};
			}),
		};
		expect(validateRegionCompositionGeometry(normalized.model, displacedPortal)).toBe(
			'Relation leaves-b has an invalid boundary portal.',
		);
		const shiftedAttachment = {
			...selected,
			ownedRoutes: selected.ownedRoutes.map((piece) => {
				if (piece.relationId !== 'leaves-b' || piece.regionId !== 'b') return piece;
				const [anchor, ...rest] = piece.points;
				return {
					...piece,
					points: [{ x: defined(anchor).x - 1, y: defined(anchor).y }, ...rest],
				};
			}),
		};
		expect(validateNestedRegionLeafIncidents(normalized.model, shiftedAttachment)).toBe(
			'Relation leaves-b source incident in leaf b does not attach to node b2 on its right face.',
		);
	});

	it('rejects a lane translated beyond its cell in the independent composition validator', () => {
		const document = persistedNestedGridWithLaneCellDocument();
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected lane cell: ${selected.status}: ${selected.reason}`);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		const lanes = defined(selected.layout.lanes);
		const first = defined(lanes[0]);
		const invalid = {
			...selected,
			layout: {
				...selected.layout,
				lanes: [
					{
						...first,
						bounds: { ...first.bounds, x: selected.layout.width + 100 },
					},
					...lanes.slice(1),
				],
			},
		};
		expect(validateRegionCompositionGeometry(normalized.model, invalid)).toBe(
			'Lane left leaves its leaf region b.',
		);
	});

	it('checks lane publication and confinement against the cell layouts', () => {
		const document = persistedNestedGridWithLaneCellDocument();
		const prepared = prepareLayoutDocument(document);
		const selected = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			regionInput(document),
		);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected lane cell: ${selected.status}: ${selected.reason}`);
		const cells = selected.regions
			.filter(({ parentId }) => parentId === 'grid')
			.map((cell) => ({
				id: cell.id,
				bounds: cell.bounds,
				translation: defined(cell.translation),
				localLayout: defined(cell.localLayout),
			}));
		const valid = { cells, layout: selected.layout };
		expect(validateGridCellLaneGeometry(valid)).toBeUndefined();
		const lanes = defined(valid.layout.lanes);
		expect(
			validateGridCellLaneGeometry({
				...valid,
				layout: { ...valid.layout, lanes: lanes.slice(1) },
			}),
		).toBe('The composed grid does not publish each local lane exactly once.');
		const clipped = {
			...valid,
			cells: cells.map((cell) => {
				if (cell.id !== 'b') return cell;
				return { ...cell, bounds: { ...cell.bounds, width: 16 } };
			}),
		};
		expect(validateGridCellLaneGeometry(clipped)).toBe('Lane left escapes cell b.');
	});

	it('keeps the ordinary recursive grid layout free of lane output', () => {
		const document = persistedNestedGridDocument();
		const prepared = prepareLayoutDocument(document);
		const selected = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			regionInput(document),
		);
		expect(selected.status).toBe(RegionCompositionStatus.Selected);
		if (selected.status !== RegionCompositionStatus.Selected) return;
		expect(selected.layout).not.toHaveProperty('lanes');
	});
});
