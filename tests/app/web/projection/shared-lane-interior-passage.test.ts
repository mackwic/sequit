import { expect, it } from 'vitest';

import { DocumentProjection } from '../../../../src/app/web/projection/document-projection';
import { interiorPassageDocument } from '../../../lib/core/layout/shared-lane-interior-fixture';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';

it('keeps the interior passage identical after a persisted blocker edit and a cold solve', async () => {
	const free = interiorPassageDocument(false);
	const blocked = interiorPassageDocument(true);
	const projection = new DocumentProjection(free);
	await projection.createCanvasModel(layoutMeasurementsForCanvas(projection.measurementModel));
	expect(projection.update(blocked)).toBe(true);
	const incremental = await projection.createCanvasModel(
		layoutMeasurementsForCanvas(projection.measurementModel),
	);
	const coldBlocked = new DocumentProjection(blocked);
	expect(incremental).toEqual(
		await coldBlocked.createCanvasModel(layoutMeasurementsForCanvas(coldBlocked.measurementModel)),
	);
	expect(projection.update(free)).toBe(true);
	const restored = await projection.createCanvasModel(
		layoutMeasurementsForCanvas(projection.measurementModel),
	);
	const coldFree = new DocumentProjection(free);
	expect(restored).toEqual(
		await coldFree.createCanvasModel(layoutMeasurementsForCanvas(coldFree.measurementModel)),
	);
});
