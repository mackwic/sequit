import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicRelation } from '../document/logic-document';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { Bounds, LayoutElement, LayoutRelation, LayoutResult, Point } from './layout-types';
import { PARENT_BUS_SPACING, REGION_PADDING } from './nested-region-crossing-routing';
import {
	type RegionChildPlacement,
	type RegionOwnedRoute,
	type RegionPortal,
	RegionPortalSide,
} from './region-composition-types';

const REGION_GAP = 96;
const ROOT_MARGIN = 48;

export interface RegionIncidentPath {
	readonly relationId: string;
	readonly endpointId: string;
	readonly pieces: readonly RegionOwnedRoute[];
	readonly portals: readonly RegionPortal[];
}

export interface SolvedRecursiveRegion {
	readonly layout: LayoutResult;
	readonly ranks: TopologicalRanks;
	readonly regions: readonly RegionChildPlacement[];
	readonly portals: readonly RegionPortal[];
	readonly ownedRoutes: readonly RegionOwnedRoute[];
	readonly incidentPaths: ReadonlyMap<string, RegionIncidentPath>;
}

interface TranslatedChildrenResult {
	readonly regions: readonly RegionChildPlacement[];
	readonly portals: readonly RegionPortal[];
	readonly ownedRoutes: readonly RegionOwnedRoute[];
	readonly elements: readonly LayoutElement[];
	readonly relations: readonly LayoutRelation[];
	readonly lanes: NonNullable<LayoutResult['lanes']>;
}

interface RowBusInput {
	readonly relation: LogicRelation;
	readonly regionId: string;
	readonly index: number;
	readonly source: Point;
	readonly target: Point;
	readonly childTop: number;
	readonly bottomBusEdge: number;
	readonly portalSide: RegionPortalSide;
}

interface BoundaryPortalInput {
	readonly relationId: string;
	readonly endpointId: string;
	readonly regionId: string;
	readonly side: RegionPortalSide;
	readonly x: number;
	/** Required for a left or right portal. */
	readonly y?: number;
	/** Required for a right portal. */
	readonly canvasWidth?: number;
	readonly canvasHeight: number;
}

function translated(point: Point, delta: Point): Point {
	return { x: point.x + delta.x, y: point.y + delta.y };
}

function translatedBounds(bounds: Bounds, delta: Point): Bounds {
	return { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y };
}

function translatedRelation(relation: LayoutRelation, delta: Point): LayoutRelation {
	return {
		...relation,
		points: relation.points.map((point) => translated(point, delta)),
	};
}

function translatedPortal(portal: RegionPortal, delta: Point): RegionPortal {
	return { ...portal, point: translated(portal.point, delta) };
}

function translatedOwnedRoute(route: RegionOwnedRoute, delta: Point): RegionOwnedRoute {
	return {
		...route,
		points: route.points.map((point) => translated(point, delta)),
	};
}

export function translatedIncidentPath(path: RegionIncidentPath, delta: Point): RegionIncidentPath {
	return {
		...path,
		pieces: path.pieces.map((piece) => translatedOwnedRoute(piece, delta)),
		portals: path.portals.map((portal) => translatedPortal(portal, delta)),
	};
}

export function translatedChildren(
	children: readonly {
		readonly id: string;
		readonly solved: SolvedRecursiveRegion;
	}[],
	placements: readonly RegionChildPlacement[],
): TranslatedChildrenResult {
	const regions: RegionChildPlacement[] = [];
	const portals: RegionPortal[] = [];
	const ownedRoutes: RegionOwnedRoute[] = [];
	const elements: LayoutElement[] = [];
	const relations: LayoutRelation[] = [];
	const lanes: NonNullable<LayoutResult['lanes']>[number][] = [];
	for (const [index, child] of children.entries()) {
		const placement = defined(placements[index]);
		regions.push(placement);
		regions.push(
			...child.solved.regions.map((region) => ({
				...region,
				bounds: translatedBounds(region.bounds, placement.translation),
				translation: {
					x: region.translation.x + placement.translation.x,
					y: region.translation.y + placement.translation.y,
				},
			})),
		);
		portals.push(
			...child.solved.portals.map((portal) => translatedPortal(portal, placement.translation)),
		);
		ownedRoutes.push(
			...child.solved.ownedRoutes.map((route) =>
				translatedOwnedRoute(route, placement.translation),
			),
		);
		elements.push(
			...child.solved.layout.elements.map((element) => ({
				...element,
				bounds: translatedBounds(element.bounds, placement.translation),
			})),
		);
		relations.push(
			...child.solved.layout.relations.map((relation) =>
				translatedRelation(relation, placement.translation),
			),
		);
		lanes.push(
			...(child.solved.layout.lanes ?? []).map((lane) => ({
				...lane,
				bounds: translatedBounds(lane.bounds, placement.translation),
			})),
		);
	}
	return { regions, portals, ownedRoutes, elements, relations, lanes };
}

export function childPlacements(
	parentId: string,
	children: readonly {
		readonly id: string;
		readonly solved: SolvedRecursiveRegion;
	}[],
	portalSide: RegionPortalSide,
	crossingCount: number,
): readonly RegionChildPlacement[] {
	let top = 64;
	if (portalSide === RegionPortalSide.Top) top += crossingCount * PARENT_BUS_SPACING;
	let left = ROOT_MARGIN;
	return children.map(({ id, solved }) => {
		const bounds = {
			x: left,
			y: top,
			width: solved.layout.width + REGION_PADDING * 2,
			height: solved.layout.height + REGION_PADDING * 2,
		};
		left += bounds.width + REGION_GAP;
		return {
			id,
			parentId,
			bounds,
			translation: {
				x: bounds.x + REGION_PADDING,
				y: bounds.y + REGION_PADDING,
			},
			localLayout: solved.layout,
			localRanks: solved.ranks,
		};
	});
}

export function rowSize(
	placements: readonly RegionChildPlacement[],
	portalSide: RegionPortalSide,
	crossingCount: number,
): {
	readonly width: number;
	readonly height: number;
	readonly bottomBusEdge: number;
} {
	const bottomBusEdge = Math.max(...placements.map(({ bounds }) => bounds.y + bounds.height));
	const width = Math.max(...placements.map(({ bounds }) => bounds.x + bounds.width)) + ROOT_MARGIN;
	let height = bottomBusEdge + ROOT_MARGIN;
	if (portalSide === RegionPortalSide.Bottom) height += crossingCount * PARENT_BUS_SPACING;
	return { width, height, bottomBusEdge };
}

export function rowBus({
	relation,
	regionId,
	index,
	source,
	target,
	childTop,
	bottomBusEdge,
	portalSide,
}: RowBusInput): RegionOwnedRoute {
	const offset = PARENT_BUS_SPACING * (index + 1);
	let y = childTop - offset;
	if (portalSide === RegionPortalSide.Bottom) y = bottomBusEdge + offset;
	return {
		relationId: relation.id,
		regionId,
		points: [source, { x: source.x, y }, { x: target.x, y }, target],
	};
}

export function boundaryPortal({
	relationId,
	endpointId,
	regionId,
	side,
	x,
	y: incidentY,
	canvasWidth,
	canvasHeight,
}: BoundaryPortalInput): RegionPortal {
	if (side === RegionPortalSide.Left || side === RegionPortalSide.Right) {
		const y = defined(incidentY, 'A lateral boundary portal needs its vertical coordinate.');
		let boundaryX = -REGION_PADDING;
		let localX = 0;
		if (side === RegionPortalSide.Right) {
			const width = defined(canvasWidth, 'A right boundary portal needs its canvas width.');
			boundaryX = width + REGION_PADDING;
			localX = width + REGION_PADDING * 2;
		}
		return {
			relationId,
			endpointId,
			regionId,
			side,
			localPoint: { x: localX, y: y + REGION_PADDING },
			point: { x: boundaryX, y },
		};
	}
	let y = -REGION_PADDING;
	let localY = 0;
	if (side === RegionPortalSide.Bottom) {
		y = canvasHeight + REGION_PADDING;
		localY = canvasHeight + REGION_PADDING * 2;
	}
	return {
		relationId,
		endpointId,
		regionId,
		side,
		localPoint: { x: x + REGION_PADDING, y: localY },
		point: { x, y },
	};
}

export function stitchedRoute(
	relation: LogicRelation,
	pieces: readonly RegionOwnedRoute[],
): LayoutRelation {
	const points: Point[] = [];
	for (const piece of pieces) {
		if (points.length === 0) points.push(...piece.points);
		else points.push(...piece.points.slice(1));
	}
	return { id: relation.id, from: relation.from, to: relation.to, points };
}

export function sortedElements(elements: readonly LayoutElement[]): readonly LayoutElement[] {
	return [...elements].sort((left, right) => compareCanonicalStrings(left.id, right.id));
}
