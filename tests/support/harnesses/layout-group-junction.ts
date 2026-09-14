import {
	defined,
	type LayoutBias,
	layoutConfiguration,
	type LayoutDirection,
} from '../../../src/lib/core/document/logic-document';
import { groupJunctionFixture } from '../fixtures/group-junction-fixture';
import { layoutDocument } from './layout';
import { defaultBiasFor } from './visual-directions';
import { VisualLayout } from './visual-layout';

export async function layoutGroupJunction(
	direction: LayoutDirection,
	bias: LayoutBias = defaultBiasFor(direction),
	groupAsTarget = false,
	nested = false,
): Promise<VisualLayout> {
	const configuration = defined(layoutConfiguration(direction, bias));
	const { document, ranks, layout } = await layoutDocument(
		groupJunctionFixture(configuration, groupAsTarget, nested),
	);
	return new VisualLayout(layout, ranks.byEndpointId, direction, undefined, document);
}
