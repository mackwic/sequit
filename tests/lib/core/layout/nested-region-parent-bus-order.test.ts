import { describe, expect, it } from 'vitest';

import { defined, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/nested-region-leaf-incident-validation';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { RegionCompositionStatus } from '../../../../src/lib/core/layout/region-composition-types';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { validateParentRouteContacts } from '../../../../src/lib/core/layout/region-composition-validation-detail';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/region-geometry-diagnostic';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/region-local-cache';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { persistedNestedGridWithTwoOuterIncidentsDocument } from './nested-region-fixture';

function exits(
	input: {
		readonly reverseLeft?: boolean;
		readonly reverseRight?: boolean;
		readonly leftOutside?: 'outside' | 'outside-2';
		readonly rightOutside?: 'outside' | 'outside-2';
	} = {},
): LogicDocument {
	const source = persistedNestedGridWithTwoOuterIncidentsDocument();
	const leftOutside = input.leftOutside ?? 'outside';
	const rightOutside = input.rightOutside ?? 'outside-2';
	let left: { id: string; from: string; to: string } = {
		id: 'a-left-exit',
		from: 'a-target',
		to: leftOutside,
	};
	let right: { id: string; from: string; to: string } = {
		id: 'z-right-exit',
		from: 'b',
		to: rightOutside,
	};
	if (input.reverseLeft === true) left = { ...left, from: leftOutside, to: 'a-target' };
	if (input.reverseRight === true) right = { ...right, from: rightOutside, to: 'b' };
	return {
		...source,
		relations: [defined(source.relations.find(({ id }) => id === 'inside-a')), left, right],
	};
}

function solve(document: LogicDocument, cache?: RegionLocalLayoutCache) {
	const prepared = prepareLayoutDocument(document);
	const input = nestedRegionInput(prepared.graph);
	const candidate = solveRecursiveNestedRegionLayout(
		prepared.graph,
		prepared.measurements,
		input,
		cache,
	);
	const cold = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	expect(candidate).toEqual(cold);
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Expected a normalized grid region tree');
	if (candidate.status === RegionCompositionStatus.Selected) {
		expect(validateRegionCompositionGeometry(normalized.model, candidate)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, candidate)).toBeUndefined();
	}
	return { candidate, model: normalized.model };
}

function parentPiece(
	candidate: Extract<
		ReturnType<typeof solve>['candidate'],
		{ status: RegionCompositionStatus.Selected }
	>,
	id: string,
) {
	return defined(
		candidate.ownedRoutes.find(
			({ relationId, regionId }) => relationId === id && regionId === '@root',
		),
	);
}

describe('parent bus rails for two grid exits', () => {
	it.each([
		{ label: 'outbound', reverseLeft: false, reverseRight: false },
		{ label: 'inbound', reverseLeft: true, reverseRight: true },
		{ label: 'mixed', reverseLeft: true, reverseRight: false },
	])(
		'puts the outer $label arc farther from the children regardless of relation IDs',
		(direction) => {
			const document = exits(direction);
			const cache = new RegionLocalLayoutCache();
			const { candidate, model } = solve(document, cache);
			if (candidate.status !== RegionCompositionStatus.Selected)
				throw new Error(`Expected two grid exits: ${candidate.status}: ${candidate.reason}`);
			const outer = parentPiece(candidate, 'a-left-exit');
			const inner = parentPiece(candidate, 'z-right-exit');
			const outerXs = [defined(outer.points[0]).x, defined(outer.points.at(-1)).x];
			const innerXs = [defined(inner.points[0]).x, defined(inner.points.at(-1)).x];
			expect(Math.min(...outerXs)).toBeLessThan(Math.min(...innerXs));
			expect(Math.max(...innerXs)).toBeLessThan(Math.max(...outerXs));
			expect(defined(outer.points[1]).y).toBeLessThan(defined(inner.points[1]).y);
			expect(validateParentRouteContacts(model, candidate.ownedRoutes)).toBeUndefined();

			const wrongRails = candidate.ownedRoutes.map((piece) => {
				if (piece.regionId !== '@root') return piece;
				let y: number | undefined;
				if (piece.relationId === outer.relationId) y = defined(inner.points[1]).y;
				if (piece.relationId === inner.relationId) y = defined(outer.points[1]).y;
				if (y === undefined) return piece;
				const start = defined(piece.points[0]);
				const end = defined(piece.points.at(-1));
				return { ...piece, points: [start, { x: start.x, y }, { x: end.x, y }, end] };
			});
			expect(validateParentRouteContacts(model, wrongRails)).toContain(
				'intersect without a bridge',
			);

			const permuted = {
				...document,
				nodes: [...document.nodes].reverse(),
				relations: [...document.relations].reverse(),
				regionPresentation: {
					...defined(document.regionPresentation),
					regions: [...defined(document.regionPresentation).regions].reverse(),
				},
			};
			expect(solve(permuted, cache).candidate).toEqual(candidate);
			expect(cache.stats.hits).toBeGreaterThan(0);
		},
	);

	it('preserves canonical rail order when the two intervals are disjoint', () => {
		const source = exits({ leftOutside: 'outside-2', rightOutside: 'outside' });
		const document: LogicDocument = {
			...source,
			regionPresentation: {
				...defined(source.regionPresentation),
				regions: defined(source.regionPresentation).regions.map((region) => {
					if (region.id === 'outside-2') return { ...region, layoutOrder: orderKey('a0') };
					if (region.id === 'grid') return { ...region, layoutOrder: orderKey('a1') };
					return region;
				}),
			},
		};
		const { candidate } = solve(document);
		if (candidate.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected disjoint grid exits: ${candidate.status}: ${candidate.reason}`);
		const left = parentPiece(candidate, 'a-left-exit');
		const right = parentPiece(candidate, 'z-right-exit');
		expect(defined(left.points[1]).y).toBeGreaterThan(defined(right.points[1]).y);
	});

	it('keeps interleaved arcs and three conflicting exits unknown', () => {
		const interleaved = exits({ leftOutside: 'outside-2', rightOutside: 'outside' });
		expect(solve(interleaved).candidate).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
			regionId: '@root',
			relationId: 'a-left-exit',
			reason: 'Region @root routes a-left-exit and z-right-exit intersect without a bridge.',
		});
		const third = {
			...interleaved,
			relations: [...interleaved.relations, { id: 'third-exit', from: 'c', to: 'outside' }],
		};
		expect(solve(third).candidate).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
			regionId: 'grid',
			relationId: 'a-left-exit',
			reason: 'Region grid routes a-left-exit and third-exit intersect without a bridge.',
		});
	});
});
