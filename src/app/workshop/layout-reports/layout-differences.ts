import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import type {
	ReportedBounds,
	ReportedBox,
	ReportedLayout,
	ReportedRelation,
} from '../../../lib/infrastructure/layout-report/layout-report';

export enum GeometryPart {
	Canvas = 'canvas',
	Region = 'region',
	Lane = 'lane',
	Group = 'group',
	Node = 'node',
	Junction = 'junction',
	Relation = 'relation',
}

export enum GeometryChange {
	/** Present on both sides, elsewhere or another size. */
	Changed = 'changed',
	/** Present before, absent after. */
	Removed = 'removed',
	/** Absent before, present after. */
	Added = 'added',
}

export interface GeometryDifference {
	readonly part: GeometryPart;
	readonly id: string;
	readonly change: GeometryChange;
}

/** Whether two geometries agree within a hundredth of a pixel. */
function close(left: number, right: number): boolean {
	return Math.abs(left - right) < 0.01;
}

function sameBounds(left: ReportedBounds, right: ReportedBounds): boolean {
	const xy = close(left.x, right.x) && close(left.y, right.y);
	return xy && close(left.width, right.width) && close(left.height, right.height);
}

function sameRoute(left: ReportedRelation, right: ReportedRelation): boolean {
	if (left.from !== right.from || left.to !== right.to) return false;
	if (left.points.length !== right.points.length) return false;
	return left.points.every((point, index) => {
		const other = right.points[index];
		return other !== undefined && close(point.x, other.x) && close(point.y, other.y);
	});
}

function compare<T>(
	part: GeometryPart,
	before: ReadonlyMap<string, T>,
	after: ReadonlyMap<string, T>,
	same: (left: T, right: T) => boolean,
): readonly GeometryDifference[] {
	const ids = [...new Set([...before.keys(), ...after.keys()])].sort(compareCanonicalStrings);
	return ids.flatMap((id): readonly GeometryDifference[] => {
		const left = before.get(id);
		const right = after.get(id);
		if (left === undefined) return [{ part, id, change: GeometryChange.Added }];
		if (right === undefined) return [{ part, id, change: GeometryChange.Removed }];
		if (same(left, right)) return [];
		return [{ part, id, change: GeometryChange.Changed }];
	});
}

function byId(boxes: readonly ReportedBox[]): ReadonlyMap<string, ReportedBounds> {
	return new Map(boxes.map(({ id, bounds }) => [id, bounds]));
}

function boxDifferences(
	part: GeometryPart,
	before: readonly ReportedBox[],
	after: readonly ReportedBox[],
): readonly GeometryDifference[] {
	return compare(part, byId(before), byId(after), sameBounds);
}

/** Lanes are scoped to their region: the same lane id may repeat across regions. */
function lanes(layout: ReportedLayout): ReadonlyMap<string, ReportedBounds> {
	return new Map(
		layout.lanes.map(({ id, regionId, bounds }) => {
			if (regionId === undefined) return [id, bounds];
			return [`${regionId}/${id}`, bounds];
		}),
	);
}

function canvasDifferences(
	before: ReportedLayout,
	after: ReportedLayout,
): readonly GeometryDifference[] {
	if (close(before.width, after.width) && close(before.height, after.height)) return [];
	return [{ part: GeometryPart.Canvas, id: '', change: GeometryChange.Changed }];
}

/** What moved, appeared or disappeared from one geometry to the other, part by part. */
export function geometryDifferences(
	before: ReportedLayout,
	after: ReportedLayout,
): readonly GeometryDifference[] {
	return [
		...canvasDifferences(before, after),
		...boxDifferences(GeometryPart.Region, before.regions, after.regions),
		...compare(GeometryPart.Lane, lanes(before), lanes(after), sameBounds),
		...boxDifferences(GeometryPart.Group, before.groups, after.groups),
		...boxDifferences(GeometryPart.Node, before.nodes, after.nodes),
		...boxDifferences(GeometryPart.Junction, before.junctions, after.junctions),
		...compare(
			GeometryPart.Relation,
			new Map(before.relations.map((relation) => [relation.id, relation])),
			new Map(after.relations.map((relation) => [relation.id, relation])),
			sameRoute,
		),
	];
}
