import type { Bounds } from '../layout/layout-types';
import type {
	CanvasModel,
	RenderedCanvasGroup,
	RenderedCanvasJunction,
	RenderedCanvasNode,
	RenderedCanvasRelation,
} from './canvas-model';

export enum EntityKind {
	Node = 'node',
	Group = 'group',
	Junction = 'junction',
	Relation = 'relation',
}

export type EntityKey = `${EntityKind}:${string}`;

export interface EntityRef {
	readonly kind: EntityKind;
	readonly id: string;
}

interface EntityNavigationPoint {
	readonly x: number;
	readonly y: number;
}

interface CanvasEntity {
	readonly ref: EntityRef;
	readonly bounds: Bounds | undefined;
	readonly navigationPoint: EntityNavigationPoint | undefined;
}

export type CanvasEntityIndex = ReadonlyMap<EntityKey, CanvasEntity>;

export enum CanvasNavigationDirection {
	Up = 'up',
	Right = 'right',
	Down = 'down',
	Left = 'left',
}

function compareCanonicalStrings(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export function entityKey(kind: EntityKind, id: string): EntityKey {
	return `${kind}:${id}`;
}

export function entityRef(kind: EntityKind, id: string): EntityRef {
	return { kind, id };
}

export function entityRefFromKey(key: string): EntityRef {
	for (const kind of Object.values(EntityKind)) {
		const prefix = `${kind}:`;
		if (key.startsWith(prefix)) return entityRef(kind, key.slice(prefix.length));
	}
	throw new Error(`Invalid canvas entity key: ${key}`);
}

interface RelationGeometry {
	readonly bounds: Bounds;
	readonly navigationPoint: EntityNavigationPoint;
}

interface RelationSegment {
	readonly from: EntityNavigationPoint;
	readonly to: EntityNavigationPoint;
	readonly length: number;
}

interface PositionedCanvasEntity extends CanvasEntity {
	readonly navigationPoint: EntityNavigationPoint;
}

function relationGeometry(relation: RenderedCanvasRelation): RelationGeometry | undefined {
	const first = relation.points[0];
	if (first === undefined) return undefined;
	let left = first.x;
	let right = first.x;
	let top = first.y;
	let bottom = first.y;
	for (const point of relation.points.slice(1)) {
		left = Math.min(left, point.x);
		right = Math.max(right, point.x);
		top = Math.min(top, point.y);
		bottom = Math.max(bottom, point.y);
	}
	const bounds = { x: left, y: top, width: right - left, height: bottom - top };
	let totalLength = 0;
	const segments: RelationSegment[] = [];
	let from = first;
	for (const to of relation.points.slice(1)) {
		const length = Math.hypot(to.x - from.x, to.y - from.y);
		segments.push({ from, to, length });
		totalLength += length;
		from = to;
	}
	if (totalLength === 0) return { bounds, navigationPoint: first };

	let remaining = totalLength / 2;
	let navigationPoint = first;
	for (const segment of segments) {
		if (remaining > segment.length) {
			remaining -= segment.length;
			continue;
		}
		const progress = remaining / segment.length;
		const deltaX = segment.to.x - segment.from.x;
		const deltaY = segment.to.y - segment.from.y;
		navigationPoint = {
			x: segment.from.x + deltaX * progress,
			y: segment.from.y + deltaY * progress,
		};
		break;
	}
	return { bounds, navigationPoint };
}

type BoundedCanvasEntity = RenderedCanvasNode | RenderedCanvasGroup | RenderedCanvasJunction;

function indexBoundedEntity(
	index: Map<EntityKey, CanvasEntity>,
	kind: EntityKind,
	entity: BoundedCanvasEntity,
): void {
	const ref = entityRef(kind, entity.id);
	index.set(entityKey(ref.kind, ref.id), {
		ref,
		bounds: entity.bounds,
		navigationPoint: {
			x: entity.bounds.x + entity.bounds.width / 2,
			y: entity.bounds.y + entity.bounds.height / 2,
		},
	});
}

export function createCanvasEntityIndex(canvas: CanvasModel): CanvasEntityIndex {
	const index = new Map<EntityKey, CanvasEntity>();
	for (const node of canvas.nodes) {
		indexBoundedEntity(index, EntityKind.Node, node);
	}
	for (const group of canvas.groups) {
		indexBoundedEntity(index, EntityKind.Group, group);
	}
	for (const junction of canvas.junctions) {
		indexBoundedEntity(index, EntityKind.Junction, junction);
	}
	for (const relation of canvas.relations) {
		const ref = entityRef(EntityKind.Relation, relation.id);
		const geometry = relationGeometry(relation);
		index.set(entityKey(ref.kind, ref.id), {
			ref,
			bounds: geometry?.bounds,
			navigationPoint: geometry?.navigationPoint,
		});
	}
	return index;
}

function compareEntityIdentity(left: CanvasEntity, right: CanvasEntity): number {
	return left.ref.kind.localeCompare(right.ref.kind) || left.ref.id.localeCompare(right.ref.id);
}

interface TabNode {
	readonly ref: EntityRef;
	readonly rank: number;
	readonly layoutOrder: string;
	readonly rootGroupId?: string;
	readonly navigationPoint: EntityNavigationPoint;
}

function compareTabNodes(left: TabNode, right: TabNode): number {
	const rankDifference = right.rank - left.rank;
	if (rankDifference !== 0) return rankDifference;
	const orderDifference = compareCanonicalStrings(left.layoutOrder, right.layoutOrder);
	if (orderDifference !== 0) return orderDifference;
	return compareCanonicalStrings(left.ref.id, right.ref.id);
}

function rootGroupId(canvas: CanvasModel, groupId: string | undefined): string | undefined {
	if (groupId === undefined) return undefined;
	const groups = new Map(canvas.groups.map((group) => [group.id, group]));
	const visited = new Set<string>();
	let current = groupId;
	while (!visited.has(current)) {
		visited.add(current);
		const parent = groups.get(current)?.navigation?.groupId;
		if (parent === undefined) return current;
		current = parent;
	}
	return groupId;
}

/**
 * Produces the wrapping Tab sequence. Group containers are represented by one
 * contiguous node segment whose entry target is its highest-ranked node, with
 * fractional layout order and canonical ID as deterministic tie-breakers.
 */
export function canvasNodeTabOrder(
	canvas: CanvasModel,
	index: CanvasEntityIndex = createCanvasEntityIndex(canvas),
): readonly EntityRef[] {
	const nodes: TabNode[] = [];
	for (const node of canvas.nodes) {
		const indexed = index.get(entityKey(EntityKind.Node, node.id));
		if (indexed?.navigationPoint === undefined) continue;
		const groupId = rootGroupId(canvas, node.navigation?.groupId);
		const tabNode: TabNode = {
			ref: indexed.ref,
			rank: node.navigation?.rank ?? 0,
			layoutOrder: node.navigation?.layoutOrder ?? node.id,
			navigationPoint: indexed.navigationPoint,
		};
		if (groupId === undefined) nodes.push(tabNode);
		else nodes.push({ ...tabNode, rootGroupId: groupId });
	}

	if (
		nodes.every(
			(node) => canvas.nodes.find(({ id }) => id === node.ref.id)?.navigation === undefined,
		)
	) {
		return [...nodes]
			.sort((left, right) => {
				const verticalDifference = left.navigationPoint.y - right.navigationPoint.y;
				if (verticalDifference !== 0) return verticalDifference;
				const horizontalDifference = left.navigationPoint.x - right.navigationPoint.x;
				if (horizontalDifference !== 0) return horizontalDifference;
				return compareCanonicalStrings(left.ref.id, right.ref.id);
			})
			.map(({ ref }) => ref);
	}

	type TabSegment = [TabNode, ...TabNode[]];
	const segments = new Map<string, TabSegment>();
	for (const node of nodes) {
		const segmentKey = node.rootGroupId ?? entityKey(node.ref.kind, node.ref.id);
		const segment = segments.get(segmentKey);
		if (segment === undefined) segments.set(segmentKey, [node]);
		else segment.push(node);
	}
	const orderedSegments = [...segments.values()];
	for (const segment of orderedSegments) segment.sort(compareTabNodes);
	orderedSegments.sort((left, right) => compareTabNodes(left[0], right[0]));
	return orderedSegments.flat().map(({ ref }) => ref);
}

interface DirectionalCandidate {
	readonly entity: PositionedCanvasEntity;
	readonly distanceSquared: number;
	readonly primaryDistance: number;
}

interface DirectionalDistances {
	readonly primary: number;
	readonly perpendicular: number;
}

function directionalDistances(
	from: EntityNavigationPoint,
	to: EntityNavigationPoint,
	direction: CanvasNavigationDirection,
): DirectionalDistances | undefined {
	const deltaX = to.x - from.x;
	const deltaY = to.y - from.y;
	if (direction === CanvasNavigationDirection.Up && deltaY < 0)
		return { primary: -deltaY, perpendicular: Math.abs(deltaX) };
	if (direction === CanvasNavigationDirection.Right && deltaX > 0)
		return { primary: deltaX, perpendicular: Math.abs(deltaY) };
	if (direction === CanvasNavigationDirection.Down && deltaY > 0)
		return { primary: deltaY, perpendicular: Math.abs(deltaX) };
	if (direction === CanvasNavigationDirection.Left && deltaX < 0)
		return { primary: -deltaX, perpendicular: Math.abs(deltaY) };
	return undefined;
}

/** Selects the nearest accepted-layout anchor in the requested open half-plane. */
export function canvasEntityInDirection(
	index: CanvasEntityIndex,
	currentKey: EntityKey,
	direction: CanvasNavigationDirection,
): EntityRef | undefined {
	const current = index.get(currentKey);
	if (current?.navigationPoint === undefined) return undefined;
	const candidates: DirectionalCandidate[] = [];
	for (const [key, entity] of index) {
		if (key === currentKey || entity.ref.kind === EntityKind.Group) continue;
		const navigationPoint = entity.navigationPoint;
		if (navigationPoint === undefined) continue;
		const distances = directionalDistances(current.navigationPoint, navigationPoint, direction);
		if (distances === undefined) continue;
		candidates.push({
			entity: { ...entity, navigationPoint },
			distanceSquared:
				distances.primary * distances.primary + distances.perpendicular * distances.perpendicular,
			primaryDistance: distances.primary,
		});
	}
	candidates.sort((left, right) => {
		const distanceDifference = left.distanceSquared - right.distanceSquared;
		if (distanceDifference !== 0) return distanceDifference;
		const primaryDifference = left.primaryDistance - right.primaryDistance;
		if (primaryDifference !== 0) return primaryDifference;
		return compareEntityIdentity(left.entity, right.entity);
	});
	return candidates[0]?.entity.ref;
}

export function canvasEntityBounds(index: CanvasEntityIndex, key: EntityKey): Bounds | undefined {
	return index.get(key)?.bounds;
}
