import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import {
	regionQualifiedFailure,
	retryOwnerForIncidentFailure,
} from '../../../../src/lib/core/layout/nested-region-recursive-diagnostics';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
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
				layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
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
		for (const detail of [
			'crosses foreign node a-source',
			'touches local relation inside-a in leaf left without a defined bridge',
			'does not attach to node a-target on its bottom face',
		]) {
			const failure = `Relation inside-branch ${detail}`;
			expect(retryOwnerForIncidentFailure(model, failure)).toBe('branch');
			expect(regionQualifiedFailure(model, failure)).toBe(`Region branch: ${failure}`);
		}
	});

	it('keeps non-geometric, unknown, leaf-owned and unlaned root failures out of retry', () => {
		const model = retryModel();
		for (const failure of [
			'Relation inside-branch intersects another route without a bridge',
			'Relation missing crosses foreign node a-source',
			'Relation inside-a crosses foreign node a-target',
			'Relation at-root crosses foreign node a-source',
		])
			expect(retryOwnerForIncidentFailure(model, failure)).toBeUndefined();
		expect(regionQualifiedFailure(model, 'Relation at-root crosses foreign node a-source')).toBe(
			'Relation at-root crosses foreign node a-source',
		);
	});
});
