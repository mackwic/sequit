import { describe, expect, it } from 'vitest';

import {
	FoldedGeometryDiagnosticCode,
	validateFoldedRouteGeometry,
} from '../../../../../src/app/workshop/visual-tests/solver-prototype/folded-route-validator';
import {
	type FoldedRouteGeometry,
	foldedRouteWitnessDocument,
	FoldedSideFace,
	materializeFoldedRouteWitness,
} from '../../../../../src/app/workshop/visual-tests/solver-prototype/folded-route-witness';
import {
	EndpointKind,
	GroupState,
	JunctionOperator,
	LayoutDirection,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';

function witness(direction = LayoutDirection.TopToBottom) {
	const document = foldedRouteWitnessDocument(direction);
	const result = materializeFoldedRouteWitness(document, 'G');
	if (!result.ok) throw new Error(result.reason);
	return { document, geometry: result.value };
}

function diagnostics(document: LogicDocument, geometry: FoldedRouteGeometry) {
	return new Set(
		validateFoldedRouteGeometry(document, 'G', geometry).diagnostics.map(({ code }) => code),
	);
}

function alter<T>(
	values: readonly T[],
	matches: (value: T) => boolean,
	change: (value: T) => T,
): T[] {
	return values.map((value) => {
		if (matches(value)) return change(value);
		return value;
	});
}

function rejectReason(document: LogicDocument): string {
	const result = materializeFoldedRouteWitness(document, 'G');
	if (result.ok) throw new Error('Expected a reduced counterexample');
	expect(result.counterexample.endpointIds).toEqual([...result.counterexample.endpointIds].sort());
	return result.reason;
}

describe('folded route source and geometry boundaries', () => {
	it('rejects stale direction, ownership, ranks, and an invalid source graph independently', () => {
		const { document, geometry } = witness();
		expect(
			diagnostics(document, { ...geometry, direction: LayoutDirection.BottomToTop }),
		).toContain(FoldedGeometryDiagnosticCode.Source);
		expect(
			diagnostics(document, {
				...geometry,
				normalized: { ...geometry.normalized, visibleOwners: [] },
			}),
		).toContain(FoldedGeometryDiagnosticCode.Provenance);
		expect(diagnostics(document, { ...geometry, sourceRanks: [] })).toContain(
			FoldedGeometryDiagnosticCode.Ranking,
		);
		const cyclic = {
			...document,
			relations: [...document.relations, { id: 'A-to-B', from: 'A', to: 'B' }],
		};
		expect(diagnostics(cyclic, geometry)).toContain(FoldedGeometryDiagnosticCode.Source);
		const predecessor = document.nodes.find(({ id }) => id === 'x');
		if (predecessor === undefined) throw new Error('Missing witness node');
		const shiftedRanks = {
			...document,
			nodes: [...document.nodes, { ...predecessor, id: 'z', layoutOrder: orderKey('a4') }],
			relations: [...document.relations, { id: 'A-to-z', from: 'A', to: 'z' }],
		};
		expect(diagnostics(shiftedRanks, geometry)).toContain(FoldedGeometryDiagnosticCode.Ranking);
	});

	it('refuses a missing source incidence, missing box, and overlapping visible boxes', () => {
		const { document, geometry } = witness();
		expect(
			diagnostics({ ...document, relations: document.relations.slice(0, 1) }, geometry),
		).toContain(FoldedGeometryDiagnosticCode.Source);
		expect(diagnostics(document, { ...geometry, boxes: geometry.boxes.slice(0, 1) })).toContain(
			FoldedGeometryDiagnosticCode.Source,
		);
		expect(
			diagnostics(document, {
				...geometry,
				boxes: alter(
					geometry.boxes,
					(box) => box.id === 'x',
					(box) => ({ ...box, bounds: { ...box.bounds, x: 200 } }),
				),
			}),
		).toContain(FoldedGeometryDiagnosticCode.Attachment);
	});

	it('allows the same valid topology with the external owner on the opposite lateral side', () => {
		const { document, geometry } = witness();
		const mirrored: FoldedRouteGeometry = {
			...geometry,
			boxes: geometry.boxes.map(({ id, bounds }) => ({
				id,
				bounds: { ...bounds, x: 610 - bounds.x - bounds.width },
			})),
			attachments: geometry.attachments.map((attachment) => {
				let face = FoldedSideFace.Left;
				if (attachment.face === FoldedSideFace.Left) face = FoldedSideFace.Right;
				return { ...attachment, face, point: { ...attachment.point, x: 610 - attachment.point.x } };
			}),
			routes: geometry.routes.map((route) => ({
				...route,
				points: route.points.map((point) => ({ ...point, x: 610 - point.x })),
			})),
		};
		expect(validateFoldedRouteGeometry(document, 'G', mirrored)).toEqual({
			ok: true,
			diagnostics: [],
		});
	});

	it('allows a horizontal layout with the external owner above the group', () => {
		const { document, geometry } = witness(LayoutDirection.LeftToRight);
		expect(
			diagnostics(document, {
				...geometry,
				boxes: alter(
					geometry.boxes,
					(box) => box.id === 'x',
					(box) => ({ ...box, bounds: { ...box.bounds, y: 200 } }),
				),
			}),
		).toContain(FoldedGeometryDiagnosticCode.Attachment);
		const mirrored: FoldedRouteGeometry = {
			...geometry,
			boxes: geometry.boxes.map(({ id, bounds }) => ({
				id,
				bounds: { ...bounds, y: 610 - bounds.y - bounds.height },
			})),
			attachments: geometry.attachments.map((attachment) => {
				let face = FoldedSideFace.Top;
				if (attachment.face === FoldedSideFace.Top) face = FoldedSideFace.Bottom;
				return { ...attachment, face, point: { ...attachment.point, y: 610 - attachment.point.y } };
			}),
			routes: geometry.routes.map((route) => ({
				...route,
				points: route.points.map((point) => ({ ...point, y: 610 - point.y })),
			})),
		};
		expect(validateFoldedRouteGeometry(document, 'G', mirrored)).toEqual({
			ok: true,
			diagnostics: [],
		});
	});

	it('reports missing routes and source incidences rather than accepting partial provenance', () => {
		const { document, geometry } = witness();
		expect(diagnostics(document, { ...geometry, routes: geometry.routes.slice(0, 1) })).toContain(
			FoldedGeometryDiagnosticCode.Provenance,
		);
		expect(
			diagnostics(document, { ...geometry, attachments: geometry.attachments.slice(0, 2) }),
		).toContain(FoldedGeometryDiagnosticCode.Provenance);
		const wrongIncidence = {
			...geometry,
			attachments: alter(
				geometry.attachments,
				(attachment) => attachment.relationId === 'B-to-x' && attachment.sourceEndpointId === 'B',
				(attachment) => ({ ...attachment, sourceEndpointId: 'A' }),
			),
		};
		expect(diagnostics(document, wrongIncidence)).toContain(
			FoldedGeometryDiagnosticCode.Provenance,
		);
		const wrongOwner = {
			...geometry,
			attachments: alter(
				geometry.attachments,
				(attachment) => attachment.sourceEndpointId === 'A',
				(attachment) => ({ ...attachment, visibleOwnerId: 'x' }),
			),
		};
		expect(diagnostics(document, wrongOwner)).toContain(FoldedGeometryDiagnosticCode.Provenance);
	});

	it('rejects broken route endpoints, diagonal bends, and penetration of the external node', () => {
		const { document, geometry } = witness();
		const replace = (points: readonly { x: number; y: number }[]) => ({
			...geometry,
			routes: alter(
				geometry.routes,
				(route) => route.relationId === 'B-to-x',
				(route) => ({ ...route, points }),
			),
		});
		expect(diagnostics(document, replace([]))).toContain(FoldedGeometryDiagnosticCode.Route);
		expect(
			diagnostics(
				document,
				replace([
					{ x: 320, y: 350 },
					{ x: 430, y: 270 },
				]),
			),
		).toContain(FoldedGeometryDiagnosticCode.Route);
		expect(
			diagnostics(
				document,
				replace([
					{ x: 320, y: 350 },
					{ x: 500, y: 350 },
					{ x: 500, y: 270 },
					{ x: 430, y: 270 },
				]),
			),
		).toContain(FoldedGeometryDiagnosticCode.Obstacle);
	});

	it('rejects a shared segment and a group attachment pair that does not span x', () => {
		const { document, geometry } = witness();
		const sharedSegment = {
			...geometry,
			routes: alter(
				geometry.routes,
				(route) => route.relationId === 'x-to-A',
				(route) => ({
					...route,
					points: [
						{ x: 430, y: 230 },
						{ x: 410, y: 230 },
						{ x: 410, y: 350 },
						{ x: 320, y: 350 },
						{ x: 320, y: 150 },
					],
				}),
			),
		};
		expect(diagnostics(document, sharedSegment)).toContain(FoldedGeometryDiagnosticCode.Route);
		const sharedVerticalSegment = {
			...geometry,
			routes: alter(
				geometry.routes,
				(route) => route.relationId === 'x-to-A',
				(route) => ({
					...route,
					points: [
						{ x: 430, y: 230 },
						{ x: 395, y: 230 },
						{ x: 395, y: 350 },
						{ x: 320, y: 350 },
						{ x: 320, y: 150 },
					],
				}),
			),
		};
		expect(diagnostics(document, sharedVerticalSegment)).toContain(
			FoldedGeometryDiagnosticCode.Route,
		);
		const sameSide = {
			...geometry,
			attachments: alter(
				geometry.attachments,
				(attachment) => attachment.sourceEndpointId === 'A',
				(attachment) => ({ ...attachment, point: { x: 320, y: 330 } }),
			),
		};
		expect(diagnostics(document, sameSide)).toContain(FoldedGeometryDiagnosticCode.Attachment);
		const coalesced = {
			...geometry,
			attachments: alter(
				geometry.attachments,
				(attachment) => attachment.sourceEndpointId === 'A',
				(attachment) => ({ ...attachment, point: { x: 320, y: 350 } }),
			),
		};
		expect(
			validateFoldedRouteGeometry(document, 'G', coalesced).diagnostics.map(
				({ message }) => message,
			),
		).toContain('Derived group attachments are not distinct.');
	});

	it('materializer refuses invalid, open, incomplete, or differently owned source topology', () => {
		const { document } = witness();
		expect(
			rejectReason({
				...document,
				relations: [...document.relations, { id: 'A-to-B', from: 'A', to: 'B' }],
			}),
		).toBe('source graph is invalid');
		expect(
			rejectReason({
				...document,
				groups: document.groups.map((group) => ({ ...group, state: GroupState.Expanded })),
			}),
		).toBe('the witness group must be closed');
		expect(rejectReason({ ...document, relations: document.relations.slice(0, 1) })).toBe(
			'the witness requires exactly one relation in each direction',
		);
		const external = document.nodes.find(({ id }) => id === 'x');
		if (external === undefined) throw new Error('Missing external node');
		expect(
			rejectReason({
				...document,
				nodes: [...document.nodes, { ...external, id: 'y', layoutOrder: orderKey('a4') }],
				relations: alter(
					document.relations,
					(relation) => relation.id === 'x-to-A',
					(relation) => ({ ...relation, from: 'y' }),
				),
			}),
		).toBe('the external owner differs');
		const externalGroup: LogicDocument['groups'][number] = {
			id: 'H',
			kind: EndpointKind.Group,
			label: 'H',
			state: GroupState.Expanded,
			layoutOrder: orderKey('a4'),
		};
		expect(
			rejectReason({
				...document,
				groups: [...document.groups, externalGroup],
				nodes: document.nodes.filter(({ id }) => id !== 'x'),
				relations: document.relations.map((relation) => {
					let from = relation.from;
					let to = relation.to;
					if (from === 'x') from = 'H';
					if (to === 'x') to = 'H';
					return { ...relation, from, to };
				}),
			}),
		).toBe('the external owner must be a visible node');
	});

	it('refuses a rank-compressed source member while preserving the reduced counterexample', () => {
		const { document } = witness();
		const member = document.nodes.find(({ id }) => id === 'B');
		if (member === undefined) throw new Error('Missing witness member');
		const compressed: LogicDocument = {
			...document,
			nodes: document.nodes.filter(({ id }) => id !== 'B'),
			junctions: [
				{
					id: 'B',
					kind: EndpointKind.Junction,
					operator: JunctionOperator.Xor,
					groupId: 'G',
					layoutOrder: member.layoutOrder,
				},
			],
		};
		const result = materializeFoldedRouteWitness(compressed, 'G');
		expect(result).toMatchObject({
			ok: false,
			reason: 'the reduced witness requires three consecutive source ranks',
			counterexample: {
				endpointIds: ['A', 'B', 'G', 'x'],
				relations: [
					{ id: 'B-to-x', from: 'B', to: 'x' },
					{ id: 'x-to-A', from: 'x', to: 'A' },
				],
			},
		});
	});

	it('rejects an unknown direction when constructing a witness document', () => {
		expect(() => {
			Reflect.apply(foldedRouteWitnessDocument, undefined, ['diagonal']);
		}).toThrow('Witness direction and bias do not match');
	});
});
