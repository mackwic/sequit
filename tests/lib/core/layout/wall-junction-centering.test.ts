import { expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { junctionNetworkDocument } from '../../../support/scenarios/dedicated-channel-witnesses';

it('centers a junction without a child on the parents in its own row', () => {
	const prepared = prepareLayoutDocument(junctionNetworkDocument('junction-anchor'));
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	const bounds = new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
	const center = (id: string): number => {
		const { x, width } = defined(bounds.get(id));
		return x + width / 2;
	};

	expect(center('j')).toBe(center('a'));
	expect(center('k')).toBe((center('a') + center('b')) / 2);
});
