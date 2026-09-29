import { expect, it } from 'vitest';

import type { LogicRelation } from '../../../../src/lib/core/document/logic-document';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { layoutDocument } from '../../../support/harnesses/layout';
import { VisualLayout } from '../../../support/harnesses/visual-layout';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

/** Links from inside the use cases group to a desirable effect the group never reached. */
const crossComponentLinks = [
	{ id: 'onlyoffice-to-preserve-documentary-guarantees', from: 'onlyoffice' },
	{ id: 'word-ui-options-to-preserve-documentary-guarantees', from: 'word-ui-options' },
].map((link) => ({ ...link, to: 'preserve-documentary-guarantees' }));

async function documentaryEffortLayout(extraRelations: readonly LogicRelation[]) {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('The example used by the page must parse.');
	const { document, ranks, layout } = await layoutDocument({
		...parsed.value,
		relations: [...parsed.value.relations, ...extraRelations],
	});
	return new VisualLayout(
		layout,
		ranks.byEndpointId,
		parsed.value.layout.direction,
		undefined,
		document,
	);
}

/** Every passage must fall inside the transverse span the nodes already occupy. */
function passagesOutsideNodeEnvelope(layout: VisualLayout) {
	const left = Math.min(...layout.elements.map(({ bounds }) => bounds.x));
	const right = Math.max(...layout.elements.map(({ bounds }) => bounds.x + bounds.width));
	return layout.relations
		.filter((route) => route.points.some(({ x }) => x < left || x > right))
		.map((route) => ({
			id: route.id,
			transverse: Math.max(...route.points.map(({ x }) => x)),
		}));
}

it('keeps every relation of the documentary effort inside the node envelope', async () => {
	const layout = await documentaryEffortLayout([]);
	AssertLayout(layout).routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
	expect(passagesOutsideNodeEnvelope(layout)).toEqual([]);
});

it.each(crossComponentLinks)(
	'routes $from straight to its target without detouring past every node',
	async (link) => {
		const layout = await documentaryEffortLayout([link]);
		AssertLayout(layout).routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
		expect(passagesOutsideNodeEnvelope(layout)).toEqual([]);
	},
);
