import { expect, it } from 'vitest';

import {
	defined,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument, depthTwoRegionInput } from './nested-region-fixture';

it('chooses a clear bus side for an internal bottom-to-top disposition', () => {
	const prepared = prepareLayoutDocument(depthTwoRegionDocument());
	const input = depthTwoRegionInput();
	const branchLayout = defined(layoutConfiguration(LayoutDirection.BottomToTop, LayoutBias.Bottom));
	const directed = {
		...input,
		regions: input.regions.map((region) => {
			if (region.id !== 'branch') return region;
			return { ...region, layout: branchLayout };
		}),
	};
	const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, directed);
	expect(attempt.status).toBe(RegionCompositionStatus.Selected);
	if (attempt.status !== RegionCompositionStatus.Selected) return;
	const branch = defined(attempt.regions.find(({ id }) => id === 'branch'));
	expect(branch.localLayout.elements).toHaveLength(4);
	expect(
		attempt.portals
			.filter(({ relationId }) => relationId === 'inside-branch')
			.map(({ side }) => side),
	).toEqual([RegionPortalSide.Bottom, RegionPortalSide.Bottom]);
	const normalized = normalizeRegionCompositionModel(prepared.graph, directed);
	expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
	if (normalized.status !== RegionCompositionModelStatus.Ready) return;
	expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
	expect(validateNestedRegionLeafIncidents(normalized.model, attempt)).toBeUndefined();
});
