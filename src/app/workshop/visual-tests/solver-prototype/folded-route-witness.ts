import { compareCanonicalStrings } from '../../../../lib/core/canonical-string';
import {
	defined,
	GroupState,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../lib/core/document/logic-document';
import { createGraph } from '../../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../lib/core/graph/topological-ranks';
import type { Bounds, Point } from '../../../../lib/core/layout/layout-types';
import { foldedSourceDocument } from './folded-source-document';
import { type NormalizedLayoutGraph, normalizeLayoutGraph } from './normalized-graph';

export enum FoldedAttachmentRole {
	Source = 'source',
	Target = 'target',
}

export enum FoldedSideFace {
	Left = 'left',
	Right = 'right',
	Top = 'top',
	Bottom = 'bottom',
}

export interface FoldedRouteAttachment {
	readonly relationId: string;
	readonly role: FoldedAttachmentRole;
	readonly sourceEndpointId: string;
	readonly visibleOwnerId: string;
	readonly face: FoldedSideFace;
	readonly point: Point;
}

export interface FoldedRouteGeometry {
	readonly direction: LayoutDirection;
	readonly normalized: NormalizedLayoutGraph;
	/** Ranks belong to source endpoints, never to the collapsed visible-owner graph. */
	readonly sourceRanks: readonly { readonly endpointId: string; readonly rank: number }[];
	readonly boxes: readonly { readonly id: string; readonly bounds: Bounds }[];
	readonly attachments: readonly FoldedRouteAttachment[];
	readonly routes: readonly {
		readonly relationId: string;
		readonly sourceRelationIds: readonly string[];
		readonly points: readonly Point[];
	}[];
}

export type FoldedRouteResult =
	| { readonly ok: true; readonly value: FoldedRouteGeometry }
	| {
			readonly ok: false;
			readonly reason: string;
			readonly counterexample: {
				readonly endpointIds: readonly string[];
				readonly relations: readonly {
					readonly id: string;
					readonly from: string;
					readonly to: string;
				}[];
			};
	  };

/** One source-valid, deliberately small witness. The closed state is documentary input. */
export function foldedRouteWitnessDocument(direction: LayoutDirection): LogicDocument {
	let bias: LayoutBias = LayoutBias.Top;
	if (direction === LayoutDirection.BottomToTop) bias = LayoutBias.Bottom;
	if (direction === LayoutDirection.LeftToRight) bias = LayoutBias.Left;
	if (direction === LayoutDirection.RightToLeft) bias = LayoutBias.Right;
	const layout = layoutConfiguration(direction, bias);
	if (layout === undefined) throw new Error('Witness direction and bias do not match');
	return foldedSourceDocument({
		layout,
		id: 'solver-folded-route',
		title: 'B → x → A, G = {A, B}',
	});
}

function reducedCounterexample(
	document: LogicDocument,
): Extract<FoldedRouteResult, { ok: false }>['counterexample'] {
	return {
		endpointIds: [...document.groups, ...document.nodes, ...document.junctions]
			.map(({ id }) => id)
			.sort(compareCanonicalStrings),
		relations: document.relations
			.map(({ id, from, to }) => ({ id, from, to }))
			.sort((a, b) => compareCanonicalStrings(a.id, b.id)),
	};
}

/** Materialize only the two-incidence folded witness; unsupported inputs remain explicit. */
export function materializeFoldedRouteWitness(
	document: LogicDocument,
	groupId: string,
): FoldedRouteResult {
	const counterexample = reducedCounterexample(document);
	const fail = (reason: string): FoldedRouteResult => ({ ok: false, reason, counterexample });
	const normalized = normalizeLayoutGraph(document, [groupId]);
	if (!normalized.ok) return fail('source graph is invalid');
	const graph = createGraph(document);
	if (!graph.ok) return fail('source graph is invalid');
	const group = document.groups.find(({ id }) => id === groupId);
	if (group?.state !== GroupState.Closed) return fail('the witness group must be closed');
	const outward = normalized.value.relations.filter(
		({ from, to }) => from.visibleOwnerId === groupId && to.visibleOwnerId !== groupId,
	);
	const inward = normalized.value.relations.filter(
		({ from, to }) => from.visibleOwnerId !== groupId && to.visibleOwnerId === groupId,
	);
	if (normalized.value.relations.length !== 2 || outward.length !== 1 || inward.length !== 1)
		return fail('the witness requires exactly one relation in each direction');
	const leaving = defined(outward[0]);
	const returning = defined(inward[0]);
	const externalId = leaving.to.visibleOwnerId;
	if (returning.from.visibleOwnerId !== externalId) return fail('the external owner differs');
	const visibleOwnerIds = normalized.value.visibleOwners.map(({ id }) => id);
	if (
		visibleOwnerIds.length !== 2 ||
		!visibleOwnerIds.includes(groupId) ||
		!visibleOwnerIds.includes(externalId)
	)
		return fail('the reduced witness requires exactly G and one external visible owner');
	if (!document.nodes.some(({ id }) => id === externalId))
		return fail('the external owner must be a visible node');
	const ranks = topologicallyRank(graph.value);
	const rankOf = (id: string) => defined(ranks.byEndpointId.get(id));
	const aRank = rankOf(returning.to.endpointId);
	const xRank = rankOf(externalId);
	const bRank = rankOf(leaving.from.endpointId);
	if (aRank !== 0 || xRank !== 1 || bRank !== 2)
		return fail('the reduced witness requires three consecutive source ranks');

	const vertical =
		document.layout.direction === LayoutDirection.TopToBottom ||
		document.layout.direction === LayoutDirection.BottomToTop;
	const reversed =
		document.layout.direction === LayoutDirection.BottomToTop ||
		document.layout.direction === LayoutDirection.RightToLeft;
	const totalLong = 500;
	const physicalLong = (long: number) => {
		if (reversed) return totalLong - long;
		return long;
	};
	const point = (cross: number, long: number): Point => {
		const along = physicalLong(long);
		if (vertical) return { x: cross, y: along };
		return { x: along, y: cross };
	};
	const bounds = (cross: number, long: number, crossSize: number, longSize: number): Bounds => {
		let start = long;
		if (reversed) start = totalLong - long - longSize;
		if (vertical) return { x: cross, y: start, width: crossSize, height: longSize };
		return { x: start, y: cross, width: longSize, height: crossSize };
	};
	let groupFace = FoldedSideFace.Bottom;
	let externalFace = FoldedSideFace.Top;
	if (vertical) {
		groupFace = FoldedSideFace.Right;
		externalFace = FoldedSideFace.Left;
	}
	const groupCross = 320;
	const externalCross = 430;
	const upperCorridor = 355;
	const lowerCorridor = 395;
	const groupARankLong = 150;
	const groupBRankLong = 350;
	const externalSourceLong = 230;
	const externalTargetLong = 270;
	const attachments: FoldedRouteAttachment[] = [
		{
			relationId: leaving.id,
			role: FoldedAttachmentRole.Source,
			sourceEndpointId: leaving.from.endpointId,
			visibleOwnerId: groupId,
			face: groupFace,
			point: point(groupCross, groupBRankLong),
		},
		{
			relationId: leaving.id,
			role: FoldedAttachmentRole.Target,
			sourceEndpointId: leaving.to.endpointId,
			visibleOwnerId: externalId,
			face: externalFace,
			point: point(externalCross, externalTargetLong),
		},
		{
			relationId: returning.id,
			role: FoldedAttachmentRole.Source,
			sourceEndpointId: returning.from.endpointId,
			visibleOwnerId: externalId,
			face: externalFace,
			point: point(externalCross, externalSourceLong),
		},
		{
			relationId: returning.id,
			role: FoldedAttachmentRole.Target,
			sourceEndpointId: returning.to.endpointId,
			visibleOwnerId: groupId,
			face: groupFace,
			point: point(groupCross, groupARankLong),
		},
	].sort(
		(a, b) =>
			compareCanonicalStrings(a.relationId, b.relationId) ||
			compareCanonicalStrings(a.role, b.role),
	);
	const routes = [
		{
			relationId: leaving.id,
			sourceRelationIds: [leaving.id],
			points: [
				point(groupCross, groupBRankLong),
				point(lowerCorridor, groupBRankLong),
				point(lowerCorridor, externalTargetLong),
				point(externalCross, externalTargetLong),
			],
		},
		{
			relationId: returning.id,
			sourceRelationIds: [returning.id],
			points: [
				point(externalCross, externalSourceLong),
				point(upperCorridor, externalSourceLong),
				point(upperCorridor, groupARankLong),
				point(groupCross, groupARankLong),
			],
		},
	].sort((a, b) => compareCanonicalStrings(a.relationId, b.relationId));
	return {
		ok: true,
		value: {
			direction: document.layout.direction,
			normalized: normalized.value,
			sourceRanks: [...ranks.byEndpointId]
				.map(([endpointId, rank]) => ({ endpointId, rank }))
				.sort((a, b) => compareCanonicalStrings(a.endpointId, b.endpointId)),
			boxes: [
				{ id: groupId, bounds: bounds(60, 80, 260, 340) },
				{ id: externalId, bounds: bounds(430, 210, 120, 80) },
			].sort((a, b) => compareCanonicalStrings(a.id, b.id)),
			attachments,
			routes,
		},
	};
}
