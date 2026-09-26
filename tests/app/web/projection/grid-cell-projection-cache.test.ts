import { afterEach, expect, it, vi } from 'vitest';

import { DocumentProjection } from '../../../../src/app/web/projection/document-projection';
import {
	defined,
	GRID_REGION_PRESENTATION_SCHEMA,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { persistedGridDocument } from '../../../lib/core/layout/grid-cell-fixture';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';

afterEach(() => vi.restoreAllMocks());

it('keeps grid child layouts local to a projection when group metrics and track minima change', async () => {
	const source = persistedGridDocument();
	const projection = new DocumentProjection(source);
	const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
	const resolver = vi.spyOn(RegionLocalLayoutCache.prototype, 'getOrComputeContract');
	const original = await projection.createCanvasModel(sizes);
	const cache = resolver.mock.contexts[0];
	if (!(cache instanceof RegionLocalLayoutCache)) throw new Error('Missing grid child cache');
	expect(cache.stats).toEqual({ entries: 4, hits: 0, misses: 4, evictions: 0 });

	const groups = new Map(sizes.groups);
	const group = defined(groups.get('oversized'));
	groups.set('oversized', { ...group, minimumWidth: 800 });
	const resized = { ...sizes, groups };
	const incremental = await projection.createCanvasModel(resized);
	expect(cache.stats).toEqual({ entries: 5, hits: 3, misses: 5, evictions: 0 });
	expect(incremental).toEqual(await new DocumentProjection(source).createCanvasModel(resized));
	expect(incremental.regions).not.toEqual(original.regions);

	const presentation = defined(source.regionPresentation);
	if (presentation.schemaVersion !== GRID_REGION_PRESENTATION_SCHEMA)
		throw new Error('Expected a grid presentation');
	const grid = defined(presentation.grid);
	const widenedTracks: LogicDocument = {
		...source,
		regionPresentation: {
			...presentation,
			grid: { ...grid, minimumColumnWidths: [1000, 100] as const },
		},
	};
	expect(projection.update(widenedTracks)).toBe(true);
	const recomposed = await projection.createCanvasModel(resized);
	expect(cache.stats).toEqual({ entries: 5, hits: 7, misses: 5, evictions: 0 });
	expect(recomposed).toEqual(
		await new DocumentProjection(widenedTracks).createCanvasModel(resized),
	);
	expect(recomposed.regions).not.toEqual(incremental.regions);
});
