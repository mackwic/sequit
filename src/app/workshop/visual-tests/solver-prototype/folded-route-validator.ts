import { compareCanonicalStrings } from '../../../../lib/core/canonical-string';
import {
	defined,
	LayoutDirection,
	type LogicDocument,
} from '../../../../lib/core/document/logic-document';
import { createGraph } from '../../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../lib/core/graph/topological-ranks';
import type { Bounds, Point } from '../../../../lib/core/layout/layout-types';
import {
	FoldedAttachmentRole,
	type FoldedRouteAttachment,
	type FoldedRouteGeometry,
	FoldedSideFace,
} from './folded-route-witness';
import { normalizeLayoutGraph } from './normalized-graph';

export enum FoldedGeometryDiagnosticCode {
	Source = 'source',
	Ranking = 'ranking',
	Provenance = 'provenance',
	Attachment = 'attachment',
	Route = 'route',
	Obstacle = 'obstacle',
}

interface FoldedGeometryDiagnostic {
	readonly code: FoldedGeometryDiagnosticCode;
	readonly message: string;
}

export interface FoldedGeometryValidation {
	readonly ok: boolean;
	readonly diagnostics: readonly FoldedGeometryDiagnostic[];
}

function samePoint(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

function onFace(point: Point, bounds: Bounds, face: FoldedSideFace): boolean {
	if (face === FoldedSideFace.Left)
		return point.x === bounds.x && point.y > bounds.y && point.y < bounds.y + bounds.height;
	if (face === FoldedSideFace.Right)
		return (
			point.x === bounds.x + bounds.width &&
			point.y > bounds.y &&
			point.y < bounds.y + bounds.height
		);
	if (face === FoldedSideFace.Top)
		return point.y === bounds.y && point.x > bounds.x && point.x < bounds.x + bounds.width;
	return (
		point.y === bounds.y + bounds.height && point.x > bounds.x && point.x < bounds.x + bounds.width
	);
}

function entersOpenInterior(from: Point, to: Point, bounds: Bounds): boolean {
	if (from.y === to.y) {
		return (
			from.y > bounds.y &&
			from.y < bounds.y + bounds.height &&
			Math.max(from.x, to.x) > bounds.x &&
			Math.min(from.x, to.x) < bounds.x + bounds.width
		);
	}
	return (
		from.x > bounds.x &&
		from.x < bounds.x + bounds.width &&
		Math.max(from.y, to.y) > bounds.y &&
		Math.min(from.y, to.y) < bounds.y + bounds.height
	);
}

function between(value: number, first: number, second: number): boolean {
	return value >= Math.min(first, second) && value <= Math.max(first, second);
}

function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
	if (a.y === b.y && c.x === d.x) return between(c.x, a.x, b.x) && between(a.y, c.y, d.y);
	if (a.x === b.x && c.y === d.y) return between(a.x, c.x, d.x) && between(c.y, a.y, b.y);
	if (a.y === b.y && c.y === d.y && a.y === c.y)
		return (
			Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
			Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
		);
	if (a.x === b.x && c.x === d.x && a.x === c.x)
		return (
			Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
			Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
		);
	return false;
}

function expectedFaces(
	direction: LayoutDirection,
	group: Bounds,
	external: Bounds,
): { group: FoldedSideFace; external: FoldedSideFace } | undefined {
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	if (vertical) {
		if (group.x + group.width < external.x)
			return { group: FoldedSideFace.Right, external: FoldedSideFace.Left };
		if (external.x + external.width < group.x)
			return { group: FoldedSideFace.Left, external: FoldedSideFace.Right };
		return undefined;
	}
	if (group.y + group.height < external.y)
		return { group: FoldedSideFace.Bottom, external: FoldedSideFace.Top };
	if (external.y + external.height < group.y)
		return { group: FoldedSideFace.Top, external: FoldedSideFace.Bottom };
	return undefined;
}

/** Independent geometry and provenance oracle; it never calls the materializer. */
export function validateFoldedRouteGeometry(
	document: LogicDocument,
	groupId: string,
	geometry: FoldedRouteGeometry,
): FoldedGeometryValidation {
	const diagnostics: FoldedGeometryDiagnostic[] = [];
	const report = (code: FoldedGeometryDiagnosticCode, message: string) => {
		diagnostics.push({ code, message });
	};
	const normalized = normalizeLayoutGraph(document, [groupId]);
	const graph = createGraph(document);
	if (!normalized.ok || !graph.ok) {
		report(FoldedGeometryDiagnosticCode.Source, 'The source graph is invalid.');
		return { ok: false, diagnostics };
	}
	if (JSON.stringify(geometry.normalized) !== JSON.stringify(normalized.value))
		report(FoldedGeometryDiagnosticCode.Provenance, 'Normalized ownership differs from source.');
	if (geometry.direction !== document.layout.direction)
		report(FoldedGeometryDiagnosticCode.Source, 'Geometry direction differs from source.');
	const expectedRanks = [...topologicallyRank(graph.value).byEndpointId]
		.map(([endpointId, rank]) => ({ endpointId, rank }))
		.sort((a, b) => compareCanonicalStrings(a.endpointId, b.endpointId));
	if (JSON.stringify(geometry.sourceRanks) !== JSON.stringify(expectedRanks))
		report(FoldedGeometryDiagnosticCode.Ranking, 'Source ranks changed after folding.');
	const sourceRank = new Map(expectedRanks.map(({ endpointId, rank }) => [endpointId, rank]));
	const outward = normalized.value.relations.find(
		({ from, to }) => from.visibleOwnerId === groupId && to.visibleOwnerId !== groupId,
	);
	const inward = normalized.value.relations.find(
		({ from, to }) => from.visibleOwnerId !== groupId && to.visibleOwnerId === groupId,
	);
	if (outward === undefined || inward === undefined) {
		report(FoldedGeometryDiagnosticCode.Source, 'The two source incidences are missing.');
		return { ok: false, diagnostics };
	}
	const externalId = outward.to.visibleOwnerId;
	if (
		sourceRank.get(outward.from.endpointId) !== 2 ||
		sourceRank.get(externalId) !== 1 ||
		sourceRank.get(inward.to.endpointId) !== 0
	)
		report(FoldedGeometryDiagnosticCode.Ranking, 'Expected three source ranks B, x, A.');
	const boxes = new Map(geometry.boxes.map(({ id, bounds }) => [id, bounds]));
	const expectedOwnerIds = normalized.value.visibleOwners.map(({ id }) => id);
	const actualOwnerIds = [...boxes.keys()].sort(compareCanonicalStrings);
	if (JSON.stringify(actualOwnerIds) !== JSON.stringify(expectedOwnerIds))
		report(FoldedGeometryDiagnosticCode.Source, 'Visible boxes differ from normalized owners.');
	const groupBounds = boxes.get(groupId);
	const externalBounds = boxes.get(externalId);
	if (boxes.size !== 2 || groupBounds === undefined || externalBounds === undefined) {
		report(FoldedGeometryDiagnosticCode.Source, 'Only G and x may remain visible.');
		return { ok: false, diagnostics };
	}
	const faces = expectedFaces(document.layout.direction, groupBounds, externalBounds);
	if (faces === undefined)
		report(FoldedGeometryDiagnosticCode.Attachment, 'The two visible boxes have no lateral gap.');
	if (geometry.routes.length !== normalized.value.relations.length)
		report(FoldedGeometryDiagnosticCode.Provenance, 'Route count differs from source relations.');
	if (geometry.attachments.length !== normalized.value.relations.length * 2)
		report(
			FoldedGeometryDiagnosticCode.Provenance,
			'Attachment count differs from source incidences.',
		);

	for (const relation of normalized.value.relations) {
		const route = geometry.routes.find(({ relationId }) => relationId === relation.id);
		const from = geometry.attachments.find(
			({ relationId, role }) => relationId === relation.id && role === FoldedAttachmentRole.Source,
		);
		const to = geometry.attachments.find(
			({ relationId, role }) => relationId === relation.id && role === FoldedAttachmentRole.Target,
		);
		if (route === undefined || from === undefined || to === undefined) {
			report(FoldedGeometryDiagnosticCode.Provenance, `Missing route or incidence: ${relation.id}`);
			continue;
		}
		if (route.sourceRelationIds.length !== 1 || route.sourceRelationIds[0] !== relation.id)
			report(FoldedGeometryDiagnosticCode.Provenance, `Route provenance differs: ${relation.id}`);
		const pairs: readonly [FoldedRouteAttachment, typeof relation.from][] = [
			[from, relation.from],
			[to, relation.to],
		];
		for (const [attachment, source] of pairs) {
			if (
				attachment.sourceEndpointId !== source.endpointId ||
				attachment.visibleOwnerId !== source.visibleOwnerId
			)
				report(
					FoldedGeometryDiagnosticCode.Provenance,
					`Incidence provenance differs: ${relation.id}`,
				);
			const bounds = boxes.get(source.visibleOwnerId);
			let expectedFace = faces?.external;
			if (source.visibleOwnerId === groupId) expectedFace = faces?.group;
			if (
				bounds === undefined ||
				expectedFace === undefined ||
				attachment.face !== expectedFace ||
				!onFace(attachment.point, bounds, attachment.face)
			)
				report(
					FoldedGeometryDiagnosticCode.Attachment,
					`Incidence is not on a lateral face: ${relation.id}`,
				);
		}
		const firstPoint = route.points[0];
		const lastPoint = route.points.at(-1);
		if (
			firstPoint === undefined ||
			lastPoint === undefined ||
			route.points.length < 2 ||
			!samePoint(firstPoint, from.point) ||
			!samePoint(lastPoint, to.point)
		) {
			report(
				FoldedGeometryDiagnosticCode.Route,
				`Route endpoints differ from attachments: ${relation.id}`,
			);
			continue;
		}
		for (let index = 1; index < route.points.length; index += 1) {
			const previous = defined(route.points[index - 1]);
			const next = defined(route.points[index]);
			const horizontal = previous.y === next.y && previous.x !== next.x;
			const vertical = previous.x === next.x && previous.y !== next.y;
			if (!horizontal && !vertical) {
				report(FoldedGeometryDiagnosticCode.Route, `Non-orthogonal segment: ${relation.id}`);
				continue;
			}
			if (entersOpenInterior(previous, next, groupBounds))
				report(
					FoldedGeometryDiagnosticCode.Obstacle,
					`Route crosses group interior: ${relation.id}`,
				);
			if (entersOpenInterior(previous, next, externalBounds))
				report(
					FoldedGeometryDiagnosticCode.Obstacle,
					`Route crosses external node: ${relation.id}`,
				);
		}
	}
	for (let leftIndex = 0; leftIndex < geometry.routes.length; leftIndex += 1) {
		const left = defined(geometry.routes[leftIndex]);
		for (const right of geometry.routes.slice(leftIndex + 1)) {
			for (let a = 1; a < left.points.length; a += 1) {
				const first = defined(left.points[a - 1]);
				const second = defined(left.points[a]);
				for (let b = 1; b < right.points.length; b += 1) {
					const third = defined(right.points[b - 1]);
					const fourth = defined(right.points[b]);
					if (segmentsMeet(first, second, third, fourth))
						report(FoldedGeometryDiagnosticCode.Route, 'Routes meet without a crossing contract.');
				}
			}
		}
	}
	const groupAttachments = geometry.attachments.filter(
		({ visibleOwnerId }) => visibleOwnerId === groupId,
	);
	if (
		groupAttachments.length !== 2 ||
		groupAttachments[0]?.sourceEndpointId === groupAttachments[1]?.sourceEndpointId ||
		(groupAttachments[0] !== undefined &&
			groupAttachments[1] !== undefined &&
			samePoint(groupAttachments[0].point, groupAttachments[1].point))
	)
		report(FoldedGeometryDiagnosticCode.Attachment, 'Derived group attachments are not distinct.');
	const verticalDirection =
		document.layout.direction === LayoutDirection.TopToBottom ||
		document.layout.direction === LayoutDirection.BottomToTop;
	const along = (point: Point) => {
		if (verticalDirection) return point.y;
		return point.x;
	};
	const groupLongs = groupAttachments.map(({ point }) => along(point)).sort((a, b) => a - b);
	let externalCenter = externalBounds.x + externalBounds.width / 2;
	if (verticalDirection) externalCenter = externalBounds.y + externalBounds.height / 2;
	if (
		groupLongs.length !== 2 ||
		groupLongs[0] === undefined ||
		groupLongs[1] === undefined ||
		!(groupLongs[0] < externalCenter && externalCenter < groupLongs[1])
	)
		report(FoldedGeometryDiagnosticCode.Attachment, 'Group ports must span the external rank.');
	return { ok: diagnostics.length === 0, diagnostics };
}
