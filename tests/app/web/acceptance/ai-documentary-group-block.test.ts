import { expect, it } from 'vitest';

import { openDocument } from '../../../../src/app/web/projection/open-document';
import type { CanvasModel } from '../../../../src/app/web/ui/canvas/canvas-model';
import {
	defined,
	EndpointKind,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import { VisualLayout } from '../../../support/harnesses/visual-layout';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

/** A relation from the root goal into the 'Use cases' group turns the whole example into one component. */
const CROSSING_RELATION = `
[relations.reduce-documentary-effort-to-isolated-partner-edits]
from = "reduce-documentary-effort"
to = "isolated-partner-edits"
`;

/** The whole canvas, groups included, with its document so group membership is observable. */
function canvasLayout(canvas: CanvasModel, document: LogicDocument): VisualLayout {
	return new VisualLayout(
		{
			width: canvas.width,
			height: canvas.height,
			elements: [
				...canvas.nodes.map(({ id, bounds }) => ({ id, bounds, kind: EndpointKind.Node })),
				...canvas.groups.map(({ id, bounds }) => ({ id, bounds, kind: EndpointKind.Group })),
			],
			relations: canvas.relations,
		},
		new Map(canvas.nodes.map(({ id, navigation }) => [id, defined(navigation).rank])),
		defined(canvas.direction),
		undefined,
		document,
	);
}

it('keeps the AI documentary families centered around the Use cases block they relate to', async () => {
	const source = `${await aiDocumentaryEffortScenario()}${CROSSING_RELATION}`;
	const parsed = parseSequitToml(source);
	if (!parsed.ok) throw new Error('The extended example must parse.');
	const opened = openDocument(source);
	if (!opened.ok) throw new Error('The extended example must open.');
	try {
		const canvas = await opened.value.createCanvasModel(
			layoutMeasurementsForCanvas(opened.value.measurementModel),
		);
		expect(canvas.relations.map(({ id }) => id)).toContain(
			'reduce-documentary-effort-to-isolated-partner-edits',
		);
		const check = AssertLayout(canvasLayout(canvas, parsed.value));
		check
			.envelope([
				'ai-content-generation',
				'minimal-workflow-disruption',
				'preserve-documentary-guarantees',
			])
			.isCenteredOn('reduce-documentary-effort', { axis: 'transverse' });
		check
			.envelope(['alcoa-plus', 'preserve-partner-content'])
			.isCenteredOn('preserve-documentary-guarantees', { axis: 'transverse' });
		check
			.envelope(['docx-word-compatible'])
			.isCenteredOn('minimal-workflow-disruption', { axis: 'transverse' });
		check
			.envelope(['data-team', 'prompt-management'])
			.isCenteredOn('ai-content-generation', { axis: 'transverse' });
		check.group('use-cases').isClearOfForeignBoxes({ along: 48, across: 36 });
	} finally {
		opened.value.destroy();
	}
});
