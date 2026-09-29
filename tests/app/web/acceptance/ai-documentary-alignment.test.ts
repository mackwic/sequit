import { expect, it } from 'vitest';

import { openDocument } from '../../../../src/app/web/projection/open-document';
import type { CanvasModel } from '../../../../src/app/web/ui/canvas/canvas-model';
import {
	defined,
	EndpointKind,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { minimumMetric } from '../../../support/assertions/routing-measurements';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import { gapAfter } from '../../../support/harnesses/box-geometry';
import { axesFor } from '../../../support/harnesses/visual-directions';
import { VisualLayout } from '../../../support/harnesses/visual-layout';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

/** Select the actual root component; populated containers in other components are not obstacles. */
function rootComponent(canvas: CanvasModel): VisualLayout {
	const nodes = canvas.nodes.filter(({ navigation }) => navigation?.groupId === undefined);
	const groups = canvas.groups.filter(({ id }) => id === 'data-team');
	const ids = new Set([...nodes, ...groups].map(({ id }) => id));
	return new VisualLayout(
		{
			width: canvas.width,
			height: canvas.height,
			elements: [
				...nodes.map(({ id, bounds }) => ({ id, bounds, kind: EndpointKind.Node })),
				...groups.map(({ id, bounds }) => ({ id, bounds, kind: EndpointKind.Group })),
			],
			relations: canvas.relations.filter(({ from, to }) => ids.has(from) && ids.has(to)),
		},
		new Map(nodes.map(({ id, navigation }) => [id, defined(navigation).rank])),
		defined(canvas.direction),
	);
}

it('centers the AI documentary families through the page projection, with its real Data team group', async () => {
	const opened = openDocument(await aiDocumentaryEffortScenario());
	if (!opened.ok) throw new Error('The example used by the page must open.');
	try {
		const canvas = await opened.value.createCanvasModel(
			layoutMeasurementsForCanvas(opened.value.measurementModel),
		);
		expect(canvas.groups).toHaveLength(2);
		expect(canvas.groups).toContainEqual(
			expect.objectContaining({ id: 'data-team', label: 'Data team' }),
		);
		expect(canvas.nodes.some(({ id }) => id === 'data-team')).toBe(false);
		expect(canvas.nodes.some(({ navigation }) => navigation?.groupId === 'data-team')).toBe(false);
		const layout = rootComponent(canvas);
		const check = AssertLayout(layout);
		check.node('reduce-documentary-effort').hasRank(1);
		check
			.envelope(['alcoa-plus', 'preserve-partner-content'])
			.isCenteredOn('preserve-documentary-guarantees', { axis: 'transverse' });
		check
			.route('docx-word-compatible-to-minimal-workflow-disruption')
			.isStraightAlong(axesFor(layout.direction).primary);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
		check.obstacles().haveClearance(24);
		const row = [
			'alcoa-plus',
			'preserve-partner-content',
			'docx-word-compatible',
			'data-team',
			'prompt-management',
		];
		for (const [index, id] of row.entries()) {
			const previous = row[index - 1];
			if (previous === undefined) continue;
			minimumMetric(
				'Espacement documentaire de la rangée avec Data team',
				gapAfter(layout.getById(id), layout.getById(previous), LayoutDirection.LeftToRight),
				36,
				{ boxes: [previous, id] },
			);
		}
	} finally {
		opened.value.destroy();
	}
});
