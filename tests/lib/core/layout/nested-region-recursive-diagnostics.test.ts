import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import {
	regionQualifiedFailure,
	retryGhostLeafForCompositionFailure,
	retryOwnerForIncidentFailure,
} from '../../../../src/lib/core/layout/nested-region-recursive-diagnostics';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode as Code,
} from '../../../../src/lib/core/layout/region-geometry-diagnostic';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument, depthTwoRegionInput } from './nested-region-fixture';

function retryModel() {
	const source = depthTwoRegionDocument();
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
	it('retries a candidate only at an internal owner with an explicit local direction', () => {
		const model = retryModel();
		for (const [code, detail] of [
			[Code.IncidentCrossesForeignNode, 'crosses foreign node a-source'],
			[
				Code.IncidentTouchesLocalRelation,
				'touches local relation inside-a in leaf left without a defined bridge',
			],
			[Code.IncidentWrongAttachment, 'does not attach to node a-target on its bottom face'],
		] as const) {
			const message = `Relation inside-branch ${detail}`;
			const failure = regionGeometryDiagnostic(code, message, {
				relationId: 'inside-branch',
			});
			expect(retryOwnerForIncidentFailure(model, failure)).toBe('branch');
			expect(regionQualifiedFailure(model, failure)).toBe(`Region branch: ${message}`);
			expect(
				retryOwnerForIncidentFailure(model, {
					...failure,
					message: 'Reworded.',
				}),
			).toBe('branch');
		}
	});

	it('keeps non-geometric, unknown, leaf-owned and unlaned root failures out of retry', () => {
		const model = retryModel();
		for (const failure of [
			regionGeometryDiagnostic(Code.ParentRouteContact, 'Any wording', {
				relationId: 'inside-branch',
			}),
			regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Any wording', {
				relationId: 'missing',
			}),
			regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Any wording', {
				relationId: 'inside-a',
			}),
			regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Any wording', {
				relationId: 'at-root',
			}),
		])
			expect(retryOwnerForIncidentFailure(model, failure)).toBeUndefined();
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

	it('retries ghost leaves only for the parent contact code, regardless of wording', () => {
		const contact = regionGeometryDiagnostic(Code.ParentRouteContact, 'Any wording');
		expect(retryGhostLeafForCompositionFailure(contact)).toBe(true);
		expect(retryGhostLeafForCompositionFailure({ ...contact, message: 'Reworded.' })).toBe(true);
		expect(
			retryGhostLeafForCompositionFailure({
				...contact,
				code: Code.InvalidComposedRoute,
				message: 'intersect without a bridge',
			}),
		).toBe(false);
	});
});
