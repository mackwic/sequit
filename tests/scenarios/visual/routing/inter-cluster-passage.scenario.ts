import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { layoutInterClusterPassage } from '../../../support/harnesses/layout-inter-cluster-passage';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

const docxCluster = ['isolated-partner-edits', 'lossless-docx-import', 'docx-oriented-platform'];
const alcoaCluster = ['traceable-edits', 'word-alcoa-question', 'compliance-review'];

export const scenario: LayoutScenario = {
	id: 'inter-cluster-passage',
	label: 'Une relation longue emprunte le corridor entre deux clusters',
	group: 'Rails et ports',
	order: 171,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutInterClusterPassage(direction, bias);
	},
	assert(layout) {
		const check = AssertLayout(layout);
		const axes = axesFor(layout.direction);
		const beforeCluster = layout.envelopeOf(docxCluster);
		check.envelope(alcoaCluster).isAfter(beforeCluster, { direction: 'transverse-positive' });
		check.nodes(['isolated-partner-edits', 'traceable-edits']).haveRank(1);
		check.nodes(['lossless-docx-import', 'word-alcoa-question', 'compliance-review']).haveRank(2);
		check.node('docx-oriented-platform').hasRank(3);
		check
			.node('lossless-docx-import')
			.isAlignedWith('isolated-partner-edits', { by: 'chain' })
			.isAlignedWith('docx-oriented-platform', { by: 'chain' });
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
		for (const id of ['want-to-need', 'solution-to-want'])
			check.route(id).isStraightAlong(axes.primary);
		check
			.trunks(['question-to-traceable', 'review-to-traceable'])
			.haveSharedSegment(axes.primary, 1);
		check
			.route('solution-to-need')
			.usesCorridorBetween(
				layout.getById('lossless-docx-import'),
				layout.getById('word-alcoa-question'),
				{
					axis: axes.transverse,
					clearance: 24,
				},
			)
			.staysWithin(layout.envelopeOf([...docxCluster, ...alcoaCluster]), {
				axis: axes.transverse,
			});
	},
};
