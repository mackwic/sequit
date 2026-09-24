import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { solveGridCellRecursiveRegion } from './grid-cell-recursive-region';
import type { LayoutMeasurements, LayoutResult } from './layout-types';
import { validateNestedRegionLeafIncidents } from './nested-region-leaf-incident-validation';
import type { NestedRegionLocalLayoutCache } from './nested-region-local-cache';
import { nestedRegionLocalMeasurements } from './nested-region-local-measurements';
import { composeCrossings, inheritedIncidentPaths } from './nested-region-recursive-composition';
import {
	regionQualifiedFailure,
	retryGhostLeafForCompositionFailure,
	retryOwnerForIncidentFailure,
} from './nested-region-recursive-diagnostics';
import {
	boundaryPortal,
	childPlacements,
	type RegionIncidentPath,
	rowSize,
	type SolvedRecursiveRegion,
	sortedElements,
	translatedChildren,
} from './nested-region-recursive-geometry';
import { multiIncidentLeaves, solveGhostLeaf } from './nested-region-recursive-ghost';
import {
	childSides,
	type IncidentSides,
	leafDocument,
	policyFailure,
	type RecursiveContext,
	sideForRegion,
} from './nested-region-recursive-model-adapter';
import {
	NestedPortalSide,
	type NestedRegionInput,
	type NestedRegionLayoutAttempt,
	NestedRegionLayoutStatus,
} from './nested-region-types';
import {
	normalizeRegionCompositionModel,
	type RegionCompositionModel,
	RegionCompositionModelStatus,
} from './region-composition-model';
import { validateRegionCompositionGeometry } from './region-composition-validation';
import type { RegionGeometryDiagnostic } from './region-geometry-diagnostic';
import {
	solveRegionLeafLayout,
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-layout';

function alternateSide(side: NestedPortalSide): NestedPortalSide {
	if (side === NestedPortalSide.Top) return NestedPortalSide.Bottom;
	return NestedPortalSide.Top;
}

function endpointPort(
	layout: LayoutResult,
	endpointId: string,
	side: NestedPortalSide,
): { readonly x: number; readonly y: number } {
	const element = defined(layout.elements.find(({ id }) => id === endpointId));
	let y = element.bounds.y;
	if (side === NestedPortalSide.Bottom) y += element.bounds.height;
	return { x: element.bounds.x + element.bounds.width / 2, y };
}

function solveLeaf(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
): SolvedRecursiveRegion {
	const document = leafDocument(context, regionId);
	const measurements = nestedRegionLocalMeasurements(document, context.measurements);
	const policy = defined(context.model.regionsById.get(regionId)).definition.policy;
	const ghost = solveGhostLeaf({
		context,
		regionId,
		incidentSides,
		document,
		measurements,
		policy,
	});
	if (ghost !== undefined) return ghost;
	const solved = solveRegionLeafLayout(document, measurements, policy, context.cache);
	const ranks = solved.ranks;
	const labels = new Map(document.presentation?.lanes.map(({ id, label }) => [id, label]) ?? []);
	let layout: LayoutResult = solved.layout;
	if (document.presentation !== undefined && solved.layout.lanes !== undefined)
		layout = {
			...solved.layout,
			lanes: solved.layout.lanes.map((lane) => ({
				...lane,
				regionId,
				label: defined(labels.get(lane.id)),
			})),
		};
	const incidentPaths = new Map<string, RegionIncidentPath>();
	for (const [relationId, side] of incidentSides) {
		const owned = defined(context.ownershipByRelationId.get(relationId));
		const isSource = owned.sourceLeafId === regionId;
		let endpointId = owned.relation.to;
		if (isSource) endpointId = owned.relation.from;
		const port = endpointPort(layout, endpointId, side);
		const portal = boundaryPortal({
			relationId,
			endpointId,
			regionId,
			side,
			x: port.x,
			canvasHeight: layout.height,
		});
		let points = [portal.point, port];
		if (isSource) points = [port, portal.point];
		incidentPaths.set(relationId, {
			relationId,
			endpointId,
			pieces: [{ relationId, regionId, points }],
			portals: [portal],
		});
	}
	return {
		layout,
		ranks,
		regions: [],
		portals: [],
		ownedRoutes: layout.relations.map((relation) => ({
			relationId: relation.id,
			regionId,
			points: relation.points,
		})),
		incidentPaths,
	};
}

function composeInner(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
): SolvedRecursiveRegion {
	const region = defined(context.model.regionsById.get(regionId));
	const localSide = sideForRegion(context, regionId);
	const crossings = context.graph.relations
		.map(({ relation }) => relation)
		.filter((relation) => context.ownershipByRelationId.get(relation.id)?.ownerId === regionId);
	const children = region.childIds.map((id) => ({
		id,
		solved: solveRegion(
			context,
			id,
			childSides({ context, regionId, childId: id, incidentSides, localSide }),
		),
	}));
	const placements = childPlacements(regionId, children, localSide, crossings.length);
	const size = rowSize(placements, localSide, crossings.length);
	const placed = translatedChildren(children, placements);
	const relationsById = new Map(placed.relations.map((relation) => [relation.id, relation]));
	const portals = [...placed.portals];
	const ownedRoutes = [...placed.ownedRoutes];
	composeCrossings({
		context,
		regionId,
		children,
		placements,
		crossings,
		localSide,
		bottomBusEdge: size.bottomBusEdge,
		relationsById,
		portals,
		ownedRoutes,
	});
	let layout: LayoutResult = {
		width: size.width,
		height: size.height,
		elements: sortedElements(placed.elements),
		relations: context.graph.relations.flatMap(({ relation }) => {
			const route = relationsById.get(relation.id);
			if (route === undefined) return [];
			return [route];
		}),
	};
	if (placed.lanes.length > 0) layout = { ...layout, lanes: placed.lanes };
	const incidentPaths = inheritedIncidentPaths({
		context,
		regionId,
		children,
		placements,
		incidentSides,
		layoutHeight: layout.height,
	});
	return {
		layout,
		ranks: { byEndpointId: new Map(), bands: [] },
		regions: placed.regions,
		portals,
		ownedRoutes,
		incidentPaths,
	};
}

function solveRegion(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
): SolvedRecursiveRegion {
	const region = defined(context.model.regionsById.get(regionId));
	if (region.definition.grid !== undefined)
		return solveGridCellRecursiveRegion(context, regionId, incidentSides, solveRegion);
	if (region.childIds.length === 0) return solveLeaf(context, regionId, incidentSides);
	return composeInner(context, regionId, incidentSides);
}

interface RecursiveCandidateInput {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly model: RegionCompositionModel;
	readonly cache: NestedRegionLocalLayoutCache | undefined;
	readonly ghostLeafIds?: ReadonlySet<string>;
}

interface DiagnosedCandidate {
	readonly attempt: NestedRegionLayoutAttempt;
	readonly diagnostic?: RegionGeometryDiagnostic;
}

function solveRecursiveCandidate(input: RecursiveCandidateInput): DiagnosedCandidate {
	const { graph, measurements, model, cache, ghostLeafIds } = input;
	const dispositionSideByRegionId = new Map<string, NestedPortalSide>();
	let context: RecursiveContext = {
		graph,
		measurements,
		cache,
		model,
		ownershipByRelationId: new Map(model.relations.map((owned) => [owned.relation.id, owned])),
		dispositionSideByRegionId,
	};
	if (ghostLeafIds !== undefined) context = { ...context, ghostLeafIds };
	const relationOrder = new Map(graph.relations.map(({ relation }, index) => [relation.id, index]));
	const retriedOwners = new Set<string>();
	for (;;) {
		const solved = solveRegion(context, model.rootId, new Map());
		const candidate = {
			status: NestedRegionLayoutStatus.Selected,
			rootId: model.rootId,
			layout: solved.layout,
			regions: solved.regions,
			portals: [...solved.portals].sort(
				(left, right) =>
					defined(relationOrder.get(left.relationId)) -
					defined(relationOrder.get(right.relationId)),
			),
			ownedRoutes: solved.ownedRoutes,
		} as const;
		const chainFailure = validateRegionCompositionGeometry(model, candidate);
		if (chainFailure !== undefined)
			return {
				attempt: {
					status: NestedRegionLayoutStatus.Unknown,
					reason: chainFailure.message,
				},
				diagnostic: chainFailure,
			};
		const incidentFailure = validateNestedRegionLeafIncidents(model, candidate);
		if (incidentFailure !== undefined) {
			const ownerId = retryOwnerForIncidentFailure(model, incidentFailure);
			if (ownerId !== undefined && !retriedOwners.has(ownerId)) {
				retriedOwners.add(ownerId);
				dispositionSideByRegionId.set(ownerId, alternateSide(sideForRegion(context, ownerId)));
				continue;
			}
			return {
				attempt: {
					status: NestedRegionLayoutStatus.Unknown,
					reason: regionQualifiedFailure(model, incidentFailure),
				},
				diagnostic: incidentFailure,
			};
		}
		return { attempt: candidate };
	}
}

/** A row disposition with an incident contract at every region boundary. */
export function solveRecursiveNestedRegionLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: NestedRegionInput,
	cache?: NestedRegionLocalLayoutCache,
): NestedRegionLayoutAttempt {
	const normalized = normalizeRegionCompositionModel(graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		return {
			status: NestedRegionLayoutStatus.Unsupported,
			reason: normalized.diagnostic.message,
		};
	const failure = policyFailure(graph, normalized.model);
	if (failure !== undefined)
		return { status: NestedRegionLayoutStatus.Unsupported, reason: failure };
	try {
		const baseline = solveRecursiveCandidate({
			graph,
			measurements,
			model: normalized.model,
			cache,
		});
		if (baseline.attempt.status !== NestedRegionLayoutStatus.Unknown) return baseline.attempt;
		if (!retryGhostLeafForCompositionFailure(baseline.diagnostic)) return baseline.attempt;
		for (const leafId of multiIncidentLeaves(normalized.model)) {
			const alternative = solveRecursiveCandidate({
				graph,
				measurements,
				model: normalized.model,
				cache,
				ghostLeafIds: new Set([leafId]),
			});
			if (alternative.attempt.status === NestedRegionLayoutStatus.Selected)
				return alternative.attempt;
		}
		return baseline.attempt;
	} catch (error) {
		if (error instanceof UnsupportedRegionLeafLayoutError)
			return {
				status: NestedRegionLayoutStatus.Unsupported,
				reason: error.reason,
			};
		if (error instanceof UnknownRegionLeafLayoutError)
			return { status: NestedRegionLayoutStatus.Unknown, reason: error.reason };
		throw error;
	}
}
