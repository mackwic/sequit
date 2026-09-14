import { layoutGraph } from '../../../src/app/web/projection/layout-graph';
import {
	defined,
	type LayoutBias,
	layoutConfiguration,
	type LayoutDirection,
} from '../../../src/lib/core/document/logic-document';
import { type GroupObstacleMeasurements, wideGroupObstacle } from '../fixtures/routing-obstacles';
import { prepareLayoutDocument } from './layout';
import { defaultBiasFor } from './visual-directions';
import { VisualLayout } from './visual-layout';

export async function layoutWideGroupObstacle(
	direction: LayoutDirection,
	bias: LayoutBias = defaultBiasFor(direction),
	measurements: GroupObstacleMeasurements = {},
): Promise<VisualLayout> {
	const fixture = wideGroupObstacle(defined(layoutConfiguration(direction, bias)), measurements);
	const prepared = prepareLayoutDocument(fixture.document, fixture.measurements);
	const result = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements, {
		inspectRouting: true,
	});
	return new VisualLayout(
		result,
		prepared.ranks.byEndpointId,
		direction,
		undefined,
		fixture.document,
	);
}
