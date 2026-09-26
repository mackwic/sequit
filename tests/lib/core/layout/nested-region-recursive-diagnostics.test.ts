import { describe, expect, it } from 'vitest';

import {
	defined,
	LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode as Code,
} from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import {
	regionQualifiedFailure,
	retryOwnerForIncidentFailure,
} from '../../../../src/lib/core/layout/nested-region-recursive-diagnostics';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	depthTwoRegionDocument,
	depthTwoRegionInput,
	selectedNestedRegionLayout,
} from './nested-region-fixture';

function retryModel(source = depthTwoRegionDocument()) {
	const prepared = prepareLayoutDocument(source);
	const input = depthTwoRegionInput();
	const normalized = normalizeRegionCompositionModel(prepared.graph, {
		...input,
		regions: input.regions.map((region) => {
			if (region.id !== 'branch') return region;
			return {
				...region,
				layout: {
					direction: LayoutDirection.BottomToTop,
					bias: LayoutBias.Bottom,
				},
			};
		}),
	});
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Expected normalized two-level regions');
	return normalized.model;
}

describe('recursive retry diagnostics', () => {
	it('retries the owning row from a real route-contact diagnostic', () => {
		const input = depthTwoRegionInput();
		const source = depthTwoRegionDocument();
		const withParallel = {
			...source,
			relations: [...source.relations, { id: 'parallel-branch', from: 'a-target', to: 'c' }],
		};
		const model = retryModel(withParallel);
		const { result } = selectedNestedRegionLayout(source, input);
		const original = defined(result.layout.relations.find(({ id }) => id === 'inside-branch'));
		const candidate = {
			...result,
			layout: {
				...result.layout,
				relations: [...result.layout.relations, { ...original, id: 'parallel-branch' }],
			},
			portals: [
				...result.portals,
				...result.portals
					.filter(({ relationId }) => relationId === 'inside-branch')
					.map((portal) => ({ ...portal, relationId: 'parallel-branch' })),
			],
			ownedRoutes: [
				...result.ownedRoutes,
				...result.ownedRoutes
					.filter(({ relationId }) => relationId === 'inside-branch')
					.map((route) => ({ ...route, relationId: 'parallel-branch' })),
			],
		};
		const failure = validateRegionCompositionGeometry(model, candidate);
		if (failure === undefined) throw new Error('Expected a real route-contact diagnostic.');
		expect(failure).toMatchObject({
			code: Code.ParentRouteContact,
			regionId: 'branch',
			relationId: 'inside-branch',
			relatedRelationId: 'parallel-branch',
		});
		expect(retryOwnerForIncidentFailure(model, failure)).toBe('branch');
		expect(regionQualifiedFailure(model, failure)).toContain('Region branch:');
	});

	it('retries every internal row while excluding unrelated and leaf-owned failures', () => {
		const model = retryModel();
		for (const failure of [
			regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Any wording', {
				relationId: 'missing',
			}),
			regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Any wording', {
				relationId: 'inside-a',
			}),
		])
			expect(retryOwnerForIncidentFailure(model, failure)).toBeUndefined();
		expect(
			retryOwnerForIncidentFailure(
				model,
				regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Any wording', {
					relationId: 'at-root',
				}),
			),
		).toBe('@root');
		expect(
			regionQualifiedFailure(
				model,
				regionGeometryDiagnostic(
					Code.IncidentCrossesForeignNode,
					'Relation at-root crosses foreign node a-source',
					{ relationId: 'at-root' },
				),
			),
		).toBe('Relation at-root crosses foreign node a-source');
	});

	it('uses diagnostic identity and ownership rather than plausible wording', () => {
		const model = retryModel();
		const misleading = regionGeometryDiagnostic(
			Code.MissingIncidentNode,
			'Relation inside-branch crosses foreign node a-source',
			{ relationId: 'inside-branch' },
		);
		expect(retryOwnerForIncidentFailure(model, misleading)).toBeUndefined();
		expect(
			regionQualifiedFailure(
				model,
				regionGeometryDiagnostic(Code.LocalRelationMissing, 'Local relation absent', {
					relationId: 'inside-branch',
				}),
			),
		).toBe('Local relation absent');
		expect(
			regionQualifiedFailure(
				model,
				regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Unowned failure'),
			),
		).toBe('Unowned failure');
	});
});
