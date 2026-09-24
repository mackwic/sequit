import { describe, expect, it } from 'vitest';

import {
	FoldedGeometryDiagnosticCode,
	validateFoldedRouteGeometry,
} from '../../../../../src/app/workshop/visual-tests/solver-prototype/folded-route-validator';
import {
	foldedRouteWitnessDocument,
	materializeFoldedRouteWitness,
} from '../../../../../src/app/workshop/visual-tests/solver-prototype/folded-route-witness';
import { projectCollapsedDocument } from '../../../../../src/lib/core/document/collapsed-document';
import {
	LAYOUT_DIRECTIONS,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../../src/lib/core/graph/create-graph';

function materialized(document: LogicDocument) {
	const result = materializeFoldedRouteWitness(document, 'G');
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.reason);
	return result.value;
}

describe('folded source-route witness', () => {
	it.each(LAYOUT_DIRECTIONS)('materializes and validates %s from source ranks', (direction) => {
		const document = foldedRouteWitnessDocument(direction);
		expect(createGraph(document).ok).toBe(true);
		expect(createGraph(projectCollapsedDocument(document, ['G']).document).ok).toBe(false);
		const geometry = materialized(document);
		expect(validateFoldedRouteGeometry(document, 'G', geometry)).toEqual({
			ok: true,
			diagnostics: [],
		});
		expect(geometry.sourceRanks).toEqual(
			expect.arrayContaining([
				{ endpointId: 'A', rank: 0 },
				{ endpointId: 'x', rank: 1 },
				{ endpointId: 'B', rank: 2 },
			]),
		);
		expect(geometry.boxes.map(({ id }) => id)).toEqual(['G', 'x']);
		expect(geometry.attachments.filter(({ visibleOwnerId }) => visibleOwnerId === 'G')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ sourceEndpointId: 'A', relationId: 'x-to-A' }),
				expect.objectContaining({ sourceEndpointId: 'B', relationId: 'B-to-x' }),
			]),
		);
		expect(
			geometry.routes.map(({ relationId, sourceRelationIds }) => ({
				relationId,
				sourceRelationIds,
			})),
		).toEqual([
			{ relationId: 'B-to-x', sourceRelationIds: ['B-to-x'] },
			{ relationId: 'x-to-A', sourceRelationIds: ['x-to-A'] },
		]);
		const permuted: LogicDocument = {
			...document,
			natures: document.natures.toReversed(),
			groups: document.groups.toReversed(),
			nodes: document.nodes.toReversed(),
			relations: document.relations.toReversed(),
		};
		expect(materializeFoldedRouteWitness(permuted, 'G')).toEqual(
			materializeFoldedRouteWitness(document, 'G'),
		);
	});

	it('rejects false provenance, a non-lateral attachment, and group traversal', () => {
		const direction = LAYOUT_DIRECTIONS[0];
		if (direction === undefined) throw new Error('Missing witness direction');
		const document = foldedRouteWitnessDocument(direction);
		const geometry = materialized(document);
		const firstRoute = geometry.routes[0];
		const groupAttachment = geometry.attachments.find(
			({ visibleOwnerId }) => visibleOwnerId === 'G',
		);
		const firstPoint = firstRoute?.points[0];
		const lastPoint = firstRoute?.points.at(-1);
		if (
			firstRoute === undefined ||
			groupAttachment === undefined ||
			firstPoint === undefined ||
			lastPoint === undefined
		)
			throw new Error('Missing witness geometry');

		const wrongProvenance = {
			...geometry,
			routes: geometry.routes.map((route) => {
				if (route !== firstRoute) return route;
				return { ...route, sourceRelationIds: ['x-to-A'] };
			}),
		};
		expect(validateFoldedRouteGeometry(document, 'G', wrongProvenance).diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: FoldedGeometryDiagnosticCode.Provenance }),
			]),
		);

		const wrongAttachment = {
			...geometry,
			attachments: geometry.attachments.map((attachment) => {
				if (attachment !== groupAttachment) return attachment;
				return { ...attachment, point: { x: 200, y: 350 } };
			}),
		};
		expect(validateFoldedRouteGeometry(document, 'G', wrongAttachment).diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: FoldedGeometryDiagnosticCode.Attachment }),
			]),
		);

		const throughGroup = {
			...geometry,
			routes: geometry.routes.map((route) => {
				if (route !== firstRoute) return route;
				return {
					...route,
					points: [firstPoint, { x: 100, y: 350 }, { x: 100, y: 270 }, lastPoint],
				};
			}),
		};
		expect(validateFoldedRouteGeometry(document, 'G', throughGroup).diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: FoldedGeometryDiagnosticCode.Obstacle }),
			]),
		);
	});

	it('rejects a route crossing without a bridge or crossing contract', () => {
		const direction = LAYOUT_DIRECTIONS[0];
		if (direction === undefined) throw new Error('Missing witness direction');
		const document = foldedRouteWitnessDocument(direction);
		const geometry = materialized(document);
		const crossed = {
			...geometry,
			routes: geometry.routes.map((route) => {
				if (route.relationId !== 'x-to-A') return route;
				return {
					...route,
					points: [
						{ x: 430, y: 230 },
						{ x: 410, y: 230 },
						{ x: 410, y: 330 },
						{ x: 340, y: 330 },
						{ x: 340, y: 150 },
						{ x: 320, y: 150 },
					],
				};
			}),
		};
		expect(validateFoldedRouteGeometry(document, 'G', crossed).diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: FoldedGeometryDiagnosticCode.Route }),
			]),
		);
	});

	it('refuses an additional visible owner and retains the reduced counterexample', () => {
		const direction = LAYOUT_DIRECTIONS[0];
		if (direction === undefined) throw new Error('Missing witness direction');
		const document = foldedRouteWitnessDocument(direction);
		const external = document.nodes.find(({ id }) => id === 'x');
		if (external === undefined) throw new Error('Missing external node');
		const extra: LogicDocument = {
			...document,
			nodes: [...document.nodes, { ...external, id: 'y', layoutOrder: orderKey('a4') }],
		};
		const result = materializeFoldedRouteWitness(extra, 'G');
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected a reduced counterexample');
		expect(result.counterexample.endpointIds).toContain('y');
		expect(result.reason).toContain('exactly G and one external visible owner');
		expect(validateFoldedRouteGeometry(extra, 'G', materialized(document)).diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: FoldedGeometryDiagnosticCode.Source }),
			]),
		);
	});
});
