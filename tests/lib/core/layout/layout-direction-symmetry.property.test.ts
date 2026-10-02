import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { routeCrossings } from '../../../support/assertions/route-geometry';
import { acyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { layoutDocument } from '../../../support/harnesses/layout';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 116;
const RUNS = Math.max(300, PROPERTY_PARAMETERS.numRuns);

const configurationByDirection: Record<LayoutDirection, LayoutConfiguration> = {
	[LayoutDirection.TopToBottom]: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	[LayoutDirection.BottomToTop]: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
	[LayoutDirection.LeftToRight]: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	[LayoutDirection.RightToLeft]: { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Left },
};

async function crossingCount(
	document: LogicDocument,
	direction: LayoutDirection,
	size: { readonly width: number; readonly height: number },
): Promise<number> {
	const { layout } = await layoutDocument(
		{ ...document, layout: configurationByDirection[direction] },
		{ nodes: Object.fromEntries(document.nodes.map(({ id }) => [id, size])) },
	);
	return routeCrossings(layout.relations).length;
}

const documents = acyclicLogicDocumentArbitrary({
	minNodes: 4,
	maxNodes: 10,
	minEdges: 3,
	maxEdges: 16,
});

/**
 * D-07, ungrouped documents. Boxes measured with other widths and heights lay out differently
 * along each axis (ports enlarge a box on its face), so a vertical and a horizontal direction are
 * compared only when the box is transposed with the axis. Mirrored directions measure the same
 * boxes and must publish the same number of crossings.
 */
describe('direction symmetry of ungrouped documents', () => {
	it('crosses as often bottom-to-top as top-to-bottom and right-to-left as left-to-right', async () => {
		await fc.assert(
			fc.asyncProperty(documents, async (document) => {
				const size = { width: NODE_WIDTH, height: NODE_HEIGHT };
				const turned = { width: NODE_HEIGHT, height: NODE_WIDTH };
				expect(await crossingCount(document, LayoutDirection.BottomToTop, size)).toBe(
					await crossingCount(document, LayoutDirection.TopToBottom, size),
				);
				expect(await crossingCount(document, LayoutDirection.RightToLeft, turned)).toBe(
					await crossingCount(document, LayoutDirection.LeftToRight, turned),
				);
			}),
			{ ...PROPERTY_PARAMETERS, numRuns: RUNS },
		);
	}, 120_000);

	it('crosses as often along a horizontal axis as along a vertical one once boxes are transposed', async () => {
		await fc.assert(
			fc.asyncProperty(documents, async (document) => {
				const vertical = await crossingCount(document, LayoutDirection.TopToBottom, {
					width: NODE_WIDTH,
					height: NODE_HEIGHT,
				});
				const horizontal = await crossingCount(document, LayoutDirection.LeftToRight, {
					width: NODE_HEIGHT,
					height: NODE_WIDTH,
				});
				expect(horizontal).toBe(vertical);
			}),
			{ ...PROPERTY_PARAMETERS, numRuns: RUNS },
		);
	}, 120_000);
});
